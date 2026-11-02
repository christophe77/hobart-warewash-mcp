# Hobart Warewash MCP

**English** | [Français](README.fr.md)

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
![Node.js >= 22.12](https://img.shields.io/badge/node-%3E%3D22.12-339933)
![MCP](https://img.shields.io/badge/MCP-stdio%20%2B%20Streamable%20HTTP-6f42c1)
![Unofficial](https://img.shields.io/badge/Hobart-unofficial-lightgrey)

A **Hobart dishwasher MCP server** for **Hobart commercial dishwashers
(warewashers)** connected to **Hobart SmartConnect**. It gives AI
assistants such as **Claude** and **ChatGPT** structured access to your
machines through the **Hobart Cloud-to-Cloud (C2C) API, Visiotronic 1.5**:

- the machines registered on your account, and when each last reported
- active errors
- wash tank and rinse temperatures, last program run
- daily water, energy, detergent and rinse-aid consumption
- the **hygiene protocol**: one entry per wash cycle, with its program
- optional: register a machine, change dosage, density and autostart
  times, only if you enable it, and only after you confirm

It is **read-only by default**. Write tools do not even exist unless you
set `HOBART_ALLOW_WRITE=true`.

> **Unofficial.** Independent personal project, not affiliated with,
> endorsed or sponsored by Hobart or ITW Food Equipment Group. You need
> your own Hobart Cloud-to-Cloud API credentials.

> **Status: early release (0.1.0).** Validated against the real Hobart
> C2C API on Hobart AMXXS-B-SEF machines. Feedback and machine reports are
> welcome.

## Why this project?

A connected Hobart dishwasher records useful data (temperatures, errors,
consumption, every wash cycle), but it sits in the Hobart SmartConnect
app, where you can look at it, not ask questions about it.

This server is a small bridge between the Hobart C2C API and any
[Model Context Protocol](https://modelcontextprotocol.io) client. Ask in
plain language, _"Did the dishwasher in the main kitchen reach its rinse
temperature today?"_, and the assistant calls a precise tool and answers
from your machine's data instead of guessing.

As of November 2026 there was no other public MCP server, plugin or SDK
for the Hobart C2C / SmartConnect API (searched: MCP registries, GitHub,
npm, PyPI).

## Features

- **6 read tools**, designed for questions people actually ask, including
  a one-call health check (`hobart_machine_overview`).
- **Respects Hobart's polling limits** (errors 30 s, temperatures 60 s):
  answers are cached, and every answer says when it was fetched and
  whether it came from the cache, so the assistant never confuses an old
  reading with a live one.
- **Read-only by default**, opt-in write tools with explicit confirmation.
- **Works locally (stdio) and remotely (Streamable HTTP)**, so it plugs
  into Claude Code, Claude Desktop, claude.ai and ChatGPT.
- **Claude Code plugin + Agent Skill** (`hobart-dishwashers`): teaches the
  model the traps: stale data from offline machines, daily data that only
  refreshes overnight, undocumented parameter codes.
- Token caching and refresh for the Hobart OAuth2 login; clear, actionable
  errors (`NOT_FOUND`, `NOT_BIDIRECTIONAL`, `AUTH_FAILED`, …).

## Quick start

### 1. Store your Hobart credentials

Create `~/.config/hobart-warewash-mcp/.env` (on Windows
`%USERPROFILE%\.config\hobart-warewash-mcp\.env`):

```bash
HOBART_USERNAME=you@example.com
HOBART_PASSWORD=your-password
# HOBART_ALLOW_WRITE=true   # only if you want the write tools
```

Environment variables, when set, always win over this file.

### 2. Connect your AI assistant

**Claude Code: plugin (MCP server + skill)**

```bash
claude plugin marketplace add christophe77/hobart-warewash-mcp
claude plugin install hobart-warewash@hobart-warewash-mcp
```

**Claude Desktop, Cursor, VS Code, Windsurf, Cline… (local stdio)**

```json
{
  "mcpServers": {
    "hobart-warewash": {
      "command": "npx",
      "args": ["-y", "hobart-warewash-mcp@0.1.0"]
    }
  }
}
```

For the skill in Claude Desktop / claude.ai, zip
`plugins/hobart-warewash/skills/hobart-dishwashers` and upload it in
Settings → Capabilities → Skills.

### From source

```bash
git clone https://github.com/christophe77/hobart-warewash-mcp.git
cd hobart-warewash-mcp
npm install
npm run build
cp .env.example .env    # fill HOBART_USERNAME and HOBART_PASSWORD
node scripts/smoke.mjs  # calls every read tool against the real API
```

A clone reads `.env` from the current folder, then the user file above,
then its own folder.

### ChatGPT and claude.ai (remote connector)

Web and mobile assistants only accept remote MCP servers over HTTPS. Run
the HTTP mode and expose it, for example with a tunnel:

```bash
npx -y hobart-warewash-mcp@0.1.0 --http         # http://127.0.0.1:3333/mcp
cloudflared tunnel --url http://localhost:3333  # or: ngrok http 3333
```

Connector URL: `https://<your-host>/mcp/<MCP_HTTP_SECRET>`. ChatGPT and
claude.ai cannot send custom headers, so the secret travels in the path;
`Authorization: Bearer <secret>` works for clients that can. Without
`MCP_HTTP_SECRET` the server only answers on localhost.

- **ChatGPT**: Settings → Apps & Connectors → Advanced → Developer mode →
  Create; paste the URL; authentication "No authentication". Paste
  `plugins/hobart-warewash/skills/hobart-dishwashers/SKILL.md` into a project's instructions for
  the same domain knowledge.
- **claude.ai**: Settings → Connectors → Add custom connector; paste the URL.

## Example questions

- "List my Hobart dishwashers and tell me which ones haven't reported for a week."
- "Is the dishwasher 867237207 OK right now?"
- "What were the wash and rinse temperatures on the last cycle?"
- "How much water and energy did each machine use yesterday?"
- "Show me today's hygiene protocol: how many cycles, which programs?"
- "Any active errors on any machine?"
- With write mode: "Set autostart slot 1 to 06:30 on 867237207". The
  assistant reads the current value, shows old → new, and waits for your yes.

## Available MCP tools

| Tool                       | What it answers                                              | Access |
| -------------------------- | ------------------------------------------------------------ | ------ |
| `hobart_list_machines`     | Machines on the account, type, protocol, last contact time   | read   |
| `hobart_machine_overview`  | Active errors + temperatures + daily consumption, one call   | read   |
| `hobart_get_machine_data`  | All parameters, counters, hygiene protocol (cycle log)       | read   |
| `hobart_get_active_errors` | Errors active now (cached 30 s, Hobart's limit)              | read   |
| `hobart_get_temperatures`  | Wash (A270) / rinse (A283) °C, last program (cached 60 s)    | read   |
| `hobart_ping`              | API reachable, account accepted                              | read   |
| `hobart_register_machine`  | Register a machine with its 6-character code                 | write  |
| `hobart_update_settings`   | Detergent / rinse-aid dosage and density, autostart on/off and times | write  |

Settings map to Hobart parameter codes: A133 / A134 (dosage), A104 / A105
(density), S078 (autostart), A180–A186 (autostart time slots, `HH:MM`).
Machines without bidirectional communication refuse settings changes
(`NOT_BIDIRECTIONAL`, HTTP 409).

## Configuration

| Variable              | Default                     | Purpose                                    |
| --------------------- | --------------------------- | ------------------------------------------ |
| `HOBART_USERNAME`     | (none)                      | Hobart C2C account (required)              |
| `HOBART_PASSWORD`     | (none)                      | Hobart C2C password (required)             |
| `HOBART_ALLOW_WRITE`  | `false`                     | Expose the write tools                     |
| `PORT` / `HOST`       | `3333` / `127.0.0.1`        | HTTP mode listen address                   |
| `MCP_HTTP_SECRET`     | (none)                      | Secret guarding the HTTP endpoint          |
| `HOBART_BASE_URL`, `HOBART_TOKEN_ENDPOINT`, `HOBART_CLIENT_ID`, `HOBART_SCOPE` | production Hobart values | Overrides |

## FAQ

**Is there an official Hobart MCP server or API for AI assistants?**
Not that we could find. Hobart exposes a Cloud-to-Cloud REST API for
partners; this project wraps it as an MCP server. It is unofficial.

**Which Hobart machines are supported?**
Any machine your Hobart C2C account can see, i.e. Hobart dishwashers
connected through SmartConnect. Tested on AMXXS-B-SEF.

**Does it work with ChatGPT?**
Yes, as a remote connector (developer mode), through the HTTP mode.
It also works with Claude (Desktop, Code, claude.ai) and any MCP client.

**Can the AI change my machine's settings by itself?**
No. Write tools are off by default; when enabled, the tool descriptions
and the skill require showing the change and getting your explicit
agreement first. Clients like Claude also ask before calling a
destructive tool.

**Is the data live?**
Errors and temperatures are near-live (within Hobart's 30 s / 60 s
limits). Daily data refreshes only after power-off or shortly before
midnight. If a machine is offline, its last contact time in the machine
list tells you how old everything is.

**Can it help with HACCP or hygiene records?**
It exposes the hygiene protocol (one entry per wash cycle with its
program) and temperatures, which an assistant can summarise. It does not
replace your official HACCP records.

## Privacy & security

- Runs on your machine (or your own server); talks only to Hobart's
  official endpoints. No telemetry.
- Credentials stay in your `.env` or environment, never in tool output.
- One shared Hobart account: whoever can reach an HTTP deployment acts as
  that account. The path secret is fine for personal use; a multi-user
  deployment needs OAuth in front.

## Limitations

- The API returns no units for daily consumption figures, and most
  `A0xx` / `C0xx` codes are undocumented: the server returns them as-is
  and the skill tells the model not to invent meanings.
- The default token scope is `Machines.Read`; whether settings writes are
  accepted depends on your account and machine.

## License

[Apache-2.0](LICENSE)

## Disclaimer

This is an independent open-source project. It is not affiliated with,
endorsed by or sponsored by Hobart or ITW Food Equipment Group. "Hobart"
and "SmartConnect" are trademarks of their owners and are used here only
to describe compatibility. Use at your own risk; food safety must never
depend on an AI assistant.
