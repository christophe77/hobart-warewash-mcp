/**
 * The MCP surface over the Hobart client.
 *
 * Six read tools, always present, and two write tools that exist only when
 * HOBART_ALLOW_WRITE=true. An agent cannot call a tool it was never shown, which is a
 * stronger guarantee than asking it nicely not to.
 *
 * Every result carries a short text answer for the model and the same facts as
 * structuredContent for clients that render data.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';
import type { HobartConfig } from './config.js';
import type { Fetched, HobartClient, SettingsPatch } from './hobart-client.js';
import { HobartError, SETTING_CODES } from './hobart-client.js';

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const HINTS: Record<string, string> = {
  NOT_FOUND: 'Call hobart_list_machines to see the serial numbers registered on this account.',
  NOT_BIDIRECTIONAL:
    'This is a property of the machine, not a transient failure: its settings can only be changed on the machine itself.',
  AUTH_FAILED: 'The Hobart account was refused. This needs a configuration change; retrying will not help.',
  BAD_REQUEST: 'Check the values sent against the ranges in the tool description.',
  UPSTREAM: 'The Hobart cloud failed. Retry later; do not loop.',
};

const serialSchema = z
  .string()
  .trim()
  .min(1)
  .describe('Machine serial number, as returned by hobart_list_machines.');

export function createServer(client: HobartClient, config: HobartConfig, version: string): McpServer {
  const server = new McpServer({ name: 'hobart-warewash-mcp', version });

  server.registerTool(
    'hobart_ping',
    {
      title: 'Check the Hobart connection',
      description:
        'Checks that the Hobart Cloud-to-Cloud API is reachable and that the configured account can sign in. Use it only when another tool fails and you need to know whether the problem is the connection.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => {
        const result = await client.ping();
        return answer(
          result.ok ? 'Hobart API reachable, account signed in.' : `Hobart API answered HTTP ${String(result.status)}.`,
          result,
        );
      }),
  );

  server.registerTool(
    'hobart_list_machines',
    {
      title: 'List Hobart machines',
      description:
        'Lists the Hobart dishwashers registered on this account: serial number, machine type, protocol version and the machine clock at last contact. Start here — every other tool needs a serial number.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () =>
      guard(async () => {
        const fetched = await client.listMachines();
        const lines = fetched.value.map(
          (m) =>
            `- ${m.serial} · ${m.machineType ?? 'type unknown'} · protocol ${m.protocolVersion ?? '?'} · last machine time ${m.machineTime ?? '?'}${m.error === undefined ? '' : ` · ⚠ ${m.error}`}`,
        );
        return answer(
          `${String(fetched.value.length)} machine(s)${freshness(fetched)}\n${lines.join('\n')}`,
          { machines: fetched.value, fetchedAt: fetched.fetchedAt },
        );
      }),
  );

  server.registerTool(
    'hobart_machine_overview',
    {
      title: 'Hobart machine overview',
      description:
        'One-call health check of a dishwasher: active errors, last wash/rinse temperatures and the daily consumption figures. Prefer this to calling the three detail tools separately when the question is "how is machine X doing".',
      inputSchema: z.object({ serial: serialSchema }),
      annotations: READ_ONLY,
    },
    async ({ serial }) =>
      guard(async () => {
        const [errors, temps, data] = await Promise.allSettled([
          client.getActiveErrors(serial),
          client.getTemperatures(serial),
          client.getMachineData(serial),
        ]);
        // An unknown serial fails all three the same way: report it once, as an error.
        if (errors.status === 'rejected' && isNotFound(errors.reason)) throw errors.reason;

        const parts: string[] = [`MACHINE ${serial}`];
        const structured: Record<string, unknown> = { serial };

        if (errors.status === 'fulfilled') {
          const list = errors.value.value;
          parts.push(
            list.length === 0
              ? `Active errors: none${freshness(errors.value)}`
              : `Active errors (${String(list.length)})${freshness(errors.value)}:\n${list.map((e) => `  - ${e.code}${e.critical === true ? ' [critical]' : ''}${e.date === undefined ? '' : ` since ${e.date}`}`).join('\n')}`,
          );
          structured['activeErrors'] = list;
        } else {
          parts.push(`Active errors: unavailable (${describe(errors.reason)})`);
        }

        if (temps.status === 'fulfilled') {
          const t = temps.value.value;
          parts.push(
            `Temperatures${freshness(temps.value)}: wash ${fmt(t.washTemperature, '°C')}, rinse ${fmt(t.rinseTemperature, '°C')}, last program ${t.lastProgram ?? '?'}`,
          );
          structured['temperatures'] = t;
        } else {
          parts.push(`Temperatures: unavailable (${describe(temps.reason)})`);
        }

        if (data.status === 'fulfilled') {
          const p = data.value.value.parameters;
          parts.push(
            `Daily consumption${freshness(data.value)}: water ${fmt(p['DailyWaterCons'])}, energy ${fmt(p['DailyEnergyCons'])}, detergent ${fmt(p['DailyDetergentCons'])}, rinse aid ${fmt(p['DailyRinseAidCons'])}`,
          );
          structured['data'] = data.value.value;
        } else {
          parts.push(`Daily data: unavailable (${describe(data.reason)})`);
        }

        return answer(parts.join('\n'), structured);
      }),
  );

  server.registerTool(
    'hobart_get_machine_data',
    {
      title: 'Hobart machine daily data',
      description:
        'Daily data of a dishwasher: consumption (DailyWaterCons, DailyEnergyCons, DailyDetergentCons, DailyRinseAidCons), counters (C0xx codes) and the hygiene protocol (one entry per wash cycle, with its program code). Hobart refreshes this only after the machine is powered off or shortly before midnight, so it describes the last completed day of use, not right now.',
      inputSchema: z.object({ serial: serialSchema }),
      annotations: READ_ONLY,
    },
    async ({ serial }) =>
      guard(async () => {
        const fetched = await client.getMachineData(serial);
        const { parameters, hygieneProtocol } = fetched.value;
        const params = Object.entries(parameters).map(([k, v]) => `  ${k} = ${String(v)}`);
        const cycles = hygieneProtocol
          .slice(0, 20)
          .map((h) => `  ${h.timestamp} · program ${h.programCode}`);
        return answer(
          [
            `DATA ${serial}${freshness(fetched)}`,
            `Parameters:\n${params.join('\n') || '  (none)'}`,
            `Hygiene protocol: ${String(hygieneProtocol.length)} cycle(s)${hygieneProtocol.length > 20 ? ', 20 most recent shown' : ''}\n${cycles.join('\n')}`,
          ].join('\n'),
          { serial, ...fetched.value, fetchedAt: fetched.fetchedAt },
        );
      }),
  );

  server.registerTool(
    'hobart_get_active_errors',
    {
      title: 'Hobart active errors',
      description:
        'Errors currently active on a dishwasher, with their code and since when. An empty list means no active error was reported, not that the machine is running. Hobart allows one real call every 30 seconds per machine; faster calls return the cached answer.',
      inputSchema: z.object({ serial: serialSchema }),
      annotations: READ_ONLY,
    },
    async ({ serial }) =>
      guard(async () => {
        const fetched = await client.getActiveErrors(serial);
        const list = fetched.value;
        return answer(
          list.length === 0
            ? `No active error on ${serial}${freshness(fetched)}.`
            : `${String(list.length)} active error(s) on ${serial}${freshness(fetched)}:\n${list.map((e) => `- ${e.code}${e.critical === true ? ' [critical]' : ''}${e.date === undefined ? '' : ` since ${e.date}`}`).join('\n')}`,
          { serial, activeErrors: list, fetchedAt: fetched.fetchedAt },
        );
      }),
  );

  server.registerTool(
    'hobart_get_temperatures',
    {
      title: 'Hobart temperatures',
      description:
        'Wash tank (A270) and rinse (A283) temperatures in °C, and the last program run. Hobart allows one real call every 60 seconds per machine; faster calls return the cached answer.',
      inputSchema: z.object({ serial: serialSchema }),
      annotations: READ_ONLY,
    },
    async ({ serial }) =>
      guard(async () => {
        const fetched = await client.getTemperatures(serial);
        const t = fetched.value;
        return answer(
          `TEMPERATURES ${serial}${freshness(fetched)}: wash ${fmt(t.washTemperature, '°C')}, rinse ${fmt(t.rinseTemperature, '°C')}, last program ${t.lastProgram ?? '?'}`,
          { serial, ...t, fetchedAt: fetched.fetchedAt },
        );
      }),
  );

  if (config.allowWrite) {
    registerWriteTools(server, client);
  }

  return server;
}

function registerWriteTools(server: McpServer, client: HobartClient): void {
  server.registerTool(
    'hobart_register_machine',
    {
      title: 'Register a Hobart machine',
      description:
        'Adds a dishwasher to this Hobart account using the 6-character registration code shown on the machine. Only call this when the person gives you the code and asks for the registration.',
      inputSchema: z.object({
        code: z
          .string()
          .trim()
          .length(6)
          .describe('The 6-character registration code displayed by the machine.'),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ code }) =>
      guard(async () => {
        const machine = await client.registerMachine(code.toUpperCase());
        return answer(
          `Registered ${machine.serial || '(serial not returned)'} · ${machine.machineType ?? 'type unknown'}.`,
          { machine },
        );
      }),
  );

  // Units are the machine's own: read the current value with hobart_get_machine_data first
  // (a typical AMXXS reports A133=2.3, A134=0.30, A104=1.25, A105=1.00).
  const amount = (what: string): z.ZodOptional<z.ZodNumber> =>
    z.number().positive().optional().describe(what);
  const time = (slot: number): z.ZodOptional<z.ZodString> =>
    z
      .string()
      .regex(/^(([01]\d|2[0-3]):[0-5]\d|--:--)$/, 'Use HH:MM (24-hour), or --:-- to clear the slot.')
      .optional()
      .describe(`Autostart time slot ${String(slot)} (A${String(179 + slot)}): HH:MM 24-hour, or --:-- to clear it.`);

  server.registerTool(
    'hobart_update_settings',
    {
      title: 'Change Hobart machine settings',
      description:
        'Changes settings on a dishwasher remotely. Only the fields you pass are changed. This acts on a real machine in a real kitchen: read the current values with hobart_get_machine_data, state the exact change (old → new) and get the person\'s explicit agreement before calling. Fails with NOT_BIDIRECTIONAL on machines that cannot be configured remotely.',
      inputSchema: z.object({
        serial: serialSchema,
        detergentDosage: amount('Detergent dosage (A133), in the unit the machine reports, e.g. 2.3.'),
        rinseAidDosage: amount('Rinse aid dosage (A134), in the unit the machine reports, e.g. 0.30.'),
        detergentDensity: amount('Detergent density (A104), e.g. 1.25.'),
        rinseAidDensity: amount('Rinse aid density (A105), e.g. 1.00.'),
        autostartEnable: z.boolean().optional().describe('Autostart on/off (S078).'),
        autostartTime1: time(1),
        autostartTime2: time(2),
        autostartTime3: time(3),
        autostartTime4: time(4),
        autostartTime5: time(5),
        autostartTime6: time(6),
        autostartTime7: time(7),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ serial, ...fields }) =>
      guard(async () => {
        const patch: SettingsPatch = {};
        for (const [name, code] of Object.entries(SETTING_CODES)) {
          const value = (fields as Record<string, number | boolean | string | undefined>)[name];
          if (value !== undefined) patch[code] = value;
        }
        if (Object.keys(patch).length === 0) {
          return error('Nothing to change: pass at least one setting.');
        }
        await client.updateSettings(serial, patch);
        const sent = Object.entries(patch).map(([k, v]) => `${k}=${String(v)}`);
        return answer(`Settings sent to ${serial}: ${sent.join(', ')}.`, { serial, sent: patch });
      }),
  );
}

// --- helpers ------------------------------------------------------------------------------

async function guard(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof HobartError) {
      const hint = HINTS[e.code];
      return error(`${e.code}: ${e.message}${hint === undefined ? '' : `\nHint: ${hint}`}`);
    }
    return error(`INTERNAL: ${describe(e)}`);
  }
}

function answer(text: string, structured: object): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: structured as Record<string, unknown>,
  };
}

function error(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function freshness(fetched: Fetched<unknown>): string {
  return fetched.fromCache ? ` (cached, fetched ${fetched.fetchedAt})` : ` (fetched ${fetched.fetchedAt})`;
}

function fmt(value: unknown, unit = ''): string {
  if (value === undefined || value === null || value === '') return '?';
  return unit === '' ? String(value) : `${String(value)} ${unit}`;
}

function isNotFound(reason: unknown): boolean {
  return reason instanceof HobartError && reason.code === 'NOT_FOUND';
}

function describe(reason: unknown): string {
  if (reason instanceof HobartError) return `${reason.code}: ${reason.message}`;
  return reason instanceof Error ? reason.message : String(reason);
}
