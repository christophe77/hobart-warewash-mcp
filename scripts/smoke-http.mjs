// Smoke test over HTTP: node scripts/smoke-http.mjs <url> [serial]
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const client = new Client({ name: 'smoke-http', version: '0.0.0' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.argv[2])));
console.log('TOOLS:', (await client.listTools()).tools.map((t) => t.name).join(', '));
const serial = process.argv[3];
if (serial) {
  const r = await client.callTool({ name: 'hobart_get_machine_data', arguments: { serial } });
  console.log(r.content.map((c) => c.text).join('\n').slice(0, 1500));
}
await client.close();
