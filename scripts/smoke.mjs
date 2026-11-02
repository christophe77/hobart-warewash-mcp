// Smoke test: starts the server over stdio, lists the tools, and calls the read tools
// against the real Hobart API. Usage: node scripts/smoke.mjs [serial]
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const transport = new StdioClientTransport({ command: process.execPath, args: [bin], stderr: 'inherit' });
const client = new Client({ name: 'smoke', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log('TOOLS:', tools.map((t) => t.name).join(', '));

const show = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  console.log(`\n=== ${name} ${JSON.stringify(args)}${r.isError ? ' [ERROR]' : ''}\n${r.content.map((c) => c.text).join('\n')}`);
  return r;
};

await show('hobart_ping');
const list = await show('hobart_list_machines');
const serial = process.argv[2] ?? list.structuredContent?.machines?.[0]?.serial;
if (serial) {
  await show('hobart_machine_overview', { serial });
  await show('hobart_get_active_errors', { serial }); // second call: must come from cache
}
await show('hobart_get_temperatures', { serial: 'DOES-NOT-EXIST' });
await client.close();
