# Changelog

## 0.1.0 (2026-11-02)

First release.

- MCP server for Hobart commercial dishwashers over the Hobart Cloud-to-Cloud API
  (Visiotronic 1.5), stdio and Streamable HTTP transports.
- Read tools: `hobart_list_machines`, `hobart_machine_overview`, `hobart_get_machine_data`,
  `hobart_get_active_errors`, `hobart_get_temperatures`, `hobart_ping`.
- Opt-in write tools (`HOBART_ALLOW_WRITE=true`): `hobart_register_machine`,
  `hobart_update_settings`.
- Caching that respects Hobart's polling limits; every answer states when it was fetched.
- Claude Code plugin and the `hobart-dishwashers` skill.
