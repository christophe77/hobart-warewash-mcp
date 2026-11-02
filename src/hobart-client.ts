/**
 * A small client for the Hobart Cloud-to-Cloud API (Visiotronic 1.5).
 *
 * Three things matter more here than in a usual REST client, because the caller is an agent
 * that may ask the same question five times in a row:
 *
 * - The token is cached until a minute before it expires, and a 401 refreshes it once.
 * - Reads are cached at least as long as Hobart's documented polling limits (events 30 s,
 *   temperatures 60 s, daily data only changes after power-off or before midnight), so an
 *   eager agent cannot get the account throttled.
 * - Hobart's answers are normalised into one shape, and every result says when it was
 *   fetched, so the agent can tell a fresh reading from a cached one.
 */
import type { HobartConfig } from './config.js';

export type HobartErrorCode =
  | 'NOT_FOUND'
  | 'NOT_BIDIRECTIONAL'
  | 'AUTH_FAILED'
  | 'BAD_REQUEST'
  | 'UPSTREAM';

export class HobartError extends Error {
  constructor(
    readonly code: HobartErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Minimum time between two real calls for the same resource, per Hobart's guidance. */
const TTL_MS = {
  machines: 60_000,
  data: 5 * 60_000,
  events: 30_000,
  temperatures: 60_000,
} as const;

const TOKEN_EXPIRY_BUFFER_MS = 60_000;

export interface Fetched<T> {
  readonly value: T;
  /** ISO time of the real Hobart call this value came from. */
  readonly fetchedAt: string;
  readonly fromCache: boolean;
}

export interface Machine {
  readonly serial: string;
  readonly machineType?: string;
  readonly protocolVersion?: string;
  readonly macAddress?: string;
  readonly machineTime?: string;
  readonly error?: string;
}

export interface MachineData {
  /** Every parameter Hobart returned, by its code (DailyWaterCons, C013, …). */
  readonly parameters: Record<string, unknown>;
  /** Hygiene protocol entries, newest first. */
  readonly hygieneProtocol: readonly { timestamp: string; programCode: string }[];
  readonly error?: string;
}

export interface ActiveError {
  readonly code: string;
  readonly date?: string;
  readonly critical?: boolean;
}

export interface Temperatures {
  /** A270, in °C. */
  readonly washTemperature?: number;
  /** A283, in °C. */
  readonly rinseTemperature?: number;
  readonly lastProgram?: string;
  /** Every field Hobart returned, untouched. */
  readonly raw: Record<string, unknown>;
}

/** Settings by Hobart parameter code. Only the keys present are sent. */
export type SettingsPatch = Partial<Record<SettingCode, number | boolean | string>>;

export const SETTING_CODES = {
  detergentDosage: 'A133',
  rinseAidDosage: 'A134',
  detergentDensity: 'A104',
  rinseAidDensity: 'A105',
  autostartEnable: 'S078',
  autostartTime1: 'A180',
  autostartTime2: 'A181',
  autostartTime3: 'A182',
  autostartTime4: 'A183',
  autostartTime5: 'A184',
  autostartTime6: 'A185',
  autostartTime7: 'A186',
} as const;
export type SettingCode = (typeof SETTING_CODES)[keyof typeof SETTING_CODES];

interface CacheEntry {
  readonly at: number;
  readonly value: unknown;
}

export class HobartClient {
  private token: { value: string; expiresAt: number } | undefined;
  private tokenRequest: Promise<string> | undefined;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(private readonly config: HobartConfig) {}

  async ping(): Promise<{ ok: boolean; status: number }> {
    const response = await this.send('GET', '/ping');
    return { ok: response.ok, status: response.status };
  }

  listMachines(): Promise<Fetched<Machine[]>> {
    return this.cached('machines', TTL_MS.machines, async () => {
      const json = await this.json('GET', '/machines');
      return extractMachineArray(json).map(normaliseMachine).filter((m) => m.serial !== '');
    });
  }

  getMachineData(serial: string): Promise<Fetched<MachineData>> {
    return this.cached(`data:${serial}`, TTL_MS.data, async () => {
      const json = asRecord(await this.json('GET', machinePath(serial, 'data')));
      const content = asRecord(json['content'] ?? json);
      const parameters = asRecord(content['parameter'] ?? {});
      const protocol = asRecord(content['hygiene_protocol'] ?? {});
      const hygieneProtocol = Object.entries(protocol)
        .map(([timestamp, code]) => ({ timestamp, programCode: String(code) }))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      return withOptional({ parameters, hygieneProtocol }, 'error', stringOrUndefined(json['error']));
    });
  }

  getActiveErrors(serial: string): Promise<Fetched<ActiveError[]>> {
    return this.cached(`events:${serial}`, TTL_MS.events, async () => {
      const json = asRecord(await this.json('GET', machinePath(serial, 'event')));
      const content = asRecord(json['content'] ?? json);
      const list = Array.isArray(content['active_errors']) ? content['active_errors'] : [];
      return list.map((item) => {
        const e = asRecord(item);
        let error: ActiveError = { code: String(e['code'] ?? '?') };
        error = withOptional(error, 'date', stringOrUndefined(e['date']));
        if (typeof e['critical'] === 'boolean') error = { ...error, critical: e['critical'] };
        return error;
      });
    });
  }

  getTemperatures(serial: string): Promise<Fetched<Temperatures>> {
    return this.cached(`temperatures:${serial}`, TTL_MS.temperatures, async () => {
      const json = asRecord(await this.json('GET', machinePath(serial, 'temperatures')));
      const raw = asRecord(json['content'] ?? json);
      let result: Temperatures = { raw };
      result = withOptional(result, 'washTemperature', numberOrUndefined(raw['A270']));
      result = withOptional(result, 'rinseTemperature', numberOrUndefined(raw['A283']));
      result = withOptional(result, 'lastProgram', stringOrUndefined(raw['last_program']));
      return result;
    });
  }

  async registerMachine(code: string): Promise<Machine> {
    const json = await this.json('POST', '/machines', { code });
    this.cache.delete('machines');
    return normaliseMachine(json);
  }

  async updateSettings(serial: string, patch: SettingsPatch): Promise<void> {
    await this.json('POST', machinePath(serial, 'settings'), patch);
  }

  // --- plumbing -------------------------------------------------------------------------

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<Fetched<T>> {
    const hit = this.cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < ttlMs) {
      return { value: hit.value as T, fetchedAt: new Date(hit.at).toISOString(), fromCache: true };
    }
    // Two concurrent asks for the same thing make one call.
    let pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending === undefined) {
      pending = load().finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, pending);
    }
    const value = await pending;
    const at = Date.now();
    this.cache.set(key, { at, value });
    return { value, fetchedAt: new Date(at).toISOString(), fromCache: false };
  }

  private async json(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const response = await this.send(method, path, body);
    if (response.ok) {
      const text = await response.text();
      return text.trim() === '' ? {} : (JSON.parse(text) as unknown);
    }
    const detail = (await response.text()).slice(0, 500);
    switch (response.status) {
      case 400:
        throw new HobartError('BAD_REQUEST', `Hobart rejected the request: ${detail}`, 400);
      case 401:
      case 403:
        throw new HobartError('AUTH_FAILED', 'Hobart refused the credentials or the scope.', response.status);
      case 404:
        throw new HobartError('NOT_FOUND', 'Unknown serial number, or machine not registered on this account.', 404);
      case 409:
        throw new HobartError(
          'NOT_BIDIRECTIONAL',
          'This machine does not support bidirectional communication, so its settings cannot be changed remotely.',
          409,
        );
      default:
        throw new HobartError('UPSTREAM', `Hobart answered HTTP ${String(response.status)}: ${detail}`, response.status);
    }
  }

  private async send(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const attempt = async (): Promise<Response> =>
      fetch(this.config.baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${await this.getToken()}`,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
      });

    const response = await attempt();
    if (response.status !== 401) return response;
    this.token = undefined;
    return attempt();
  }

  private getToken(): Promise<string> {
    if (this.token !== undefined && Date.now() < this.token.expiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return Promise.resolve(this.token.value);
    }
    this.tokenRequest ??= this.requestToken().finally(() => {
      this.tokenRequest = undefined;
    });
    return this.tokenRequest;
  }

  private async requestToken(): Promise<string> {
    const response = await fetch(this.config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: this.config.clientId,
        scope: this.config.scope,
        username: this.config.username,
        password: this.config.password,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new HobartError(
        'AUTH_FAILED',
        `Could not obtain a Hobart token (HTTP ${String(response.status)}). Check HOBART_USERNAME and HOBART_PASSWORD.`,
        response.status,
      );
    }
    const body = asRecord(await response.json());
    const accessToken = body['access_token'];
    if (typeof accessToken !== 'string') {
      throw new HobartError('AUTH_FAILED', 'The token endpoint answered without an access_token.');
    }
    const expiresIn = Number(body['expires_in'] ?? 3600);
    this.token = { value: accessToken, expiresAt: Date.now() + expiresIn * 1000 };
    return accessToken;
  }
}

// --- normalisation ----------------------------------------------------------------------

function machinePath(serial: string, resource: string): string {
  return `/machines/${encodeURIComponent(serial)}/${resource}`;
}

/** Hobart has answered with a bare array and with several wrappers; accept all of them. */
function extractMachineArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  const root = asRecord(json);
  for (const key of ['machines', 'data', 'devices', 'items', 'content']) {
    const value = root[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

/** A machine arrives either flat or as `{ header: { … } }`. */
function normaliseMachine(item: unknown): Machine {
  const outer = asRecord(item);
  const m = { ...outer, ...asRecord(outer['header'] ?? {}) };
  let machine: Machine = {
    serial: String(m['serial_number_machine'] ?? m['serialNumberMachine'] ?? m['serial'] ?? ''),
  };
  machine = withOptional(machine, 'machineType', stringOrUndefined(m['machine_type'] ?? m['machineType']));
  machine = withOptional(machine, 'protocolVersion', stringOrUndefined(m['protocol_version'] ?? m['protocolVersion']));
  machine = withOptional(machine, 'macAddress', stringOrUndefined(m['mac_address_hobart']));
  machine = withOptional(machine, 'machineTime', stringOrUndefined(m['machine_time'] ?? m['machineTime']));
  machine = withOptional(machine, 'error', stringOrUndefined(outer['error']));
  return machine;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Adds a key only when it has a value, which `exactOptionalPropertyTypes` requires. */
function withOptional<T extends object, K extends string, V>(
  target: T,
  key: K,
  value: V | undefined,
): T {
  return value === undefined ? target : { ...target, [key]: value };
}
