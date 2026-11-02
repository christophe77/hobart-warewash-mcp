# hobart-warewash-mcp

> **Unofficial.** Personal project, not affiliated with or endorsed by Hobart or ITW Food
> Equipment Group. "Hobart" and "SmartConnect" are trademarks of their owners. You need your
> own Hobart Cloud-to-Cloud API account.

MCP server for Hobart commercial dishwashers, through the Hobart Cloud-to-Cloud API (Visiotronic 1.5).
One server, three ways to use it: Claude Code (plugin + skill), Claude Desktop / claude.ai,
and ChatGPT.

Read-only by default. The write tools (`hobart_register_machine`, `hobart_update_settings`)
only exist when `HOBART_ALLOW_WRITE=true`.

## Tools

| Tool                       | What it does                                              |
| -------------------------- | --------------------------------------------------------- |
| `hobart_ping`              | API reachable, account accepted                           |
| `hobart_list_machines`     | Machines on the account, with last contact time           |
| `hobart_machine_overview`  | Errors + temperatures + daily consumption in one call     |
| `hobart_get_machine_data`  | All parameters, counters, hygiene protocol                |
| `hobart_get_active_errors` | Active errors (cached 30 s — Hobart's limit)              |
| `hobart_get_temperatures`  | Wash/rinse °C and last program (cached 60 s)              |
| `hobart_register_machine`  | _write_ — register with the 6-character code              |
| `hobart_update_settings`   | _write_ — dosage, density, autostart                      |

## Setup

```bash
npm install
npm run build
cp .env.example .env   # then fill HOBART_USERNAME / HOBART_PASSWORD
node scripts/smoke.mjs # calls every read tool against the real API
```

The server reads `.env` from the current folder, then from this package's folder, so it
works whatever folder the client starts it from. Real environment variables always win.

## Claude Code — plugin (MCP server + skill)

From the folder that contains your clone, after `npm run build`:

```bash
claude plugin marketplace add ./hobart-warewash-mcp
claude plugin install hobart-warewash@hobart-warewash-mcp
```

The plugin starts `dist/bin.js` over stdio and adds the `hobart-dishwashers` skill
(freshness traps, code meanings, safe settings changes).

## Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hobart-warewash": {
      "command": "node",
      "args": ["/path/to/hobart-warewash-mcp/dist/bin.js"]
    }
  }
}
```

For the skill, zip `skills/hobart-dishwashers` and upload it in Settings → Capabilities → Skills.

## ChatGPT and claude.ai — remote connector

Both need an HTTPS URL. Run the HTTP mode and expose it with a tunnel:

```bash
npm run start:http                       # http://127.0.0.1:3333/mcp
cloudflared tunnel --url http://localhost:3333   # or: ngrok http 3333
```

The connector URL is `https://<tunnel-host>/mcp/<MCP_HTTP_SECRET>`. Neither client can send a
custom header, so the secret travels in the path; `Authorization: Bearer <secret>` also works
for clients that can. Without `MCP_HTTP_SECRET` the server only answers on localhost.

- **ChatGPT**: Settings → Apps & Connectors → Advanced → Developer mode, then Create, paste
  the URL, authentication "No authentication". Paste the body of `SKILL.md` into the
  conversation or a project's instructions to give it the same domain knowledge.
- **claude.ai**: Settings → Connectors → Add custom connector, paste the URL.

## Limits to know

- One shared Hobart account: whoever reaches the connector acts as that account. The path
  secret is fine for a demo; a real multi-user deployment needs OAuth in front.
- Daily data only refreshes after power-off or before midnight; `machineTime` in the machine
  list shows when a machine last talked to the cloud.
- The token scope is `Machines.Read`; whether `settings` writes are accepted for this
  account has not been verified yet.

## License

[Apache-2.0](LICENSE)
