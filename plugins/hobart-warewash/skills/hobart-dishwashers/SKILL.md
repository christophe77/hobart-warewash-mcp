---
name: hobart-dishwashers
description: How to answer questions about Hobart commercial dishwashers with the hobart_* MCP tools: which machines exist, whether one is healthy, what its errors, temperatures, consumption and hygiene protocol say, and how to change its settings safely. Use this whenever the conversation mentions Hobart, a dishwasher or warewasher serial number, SmartConnect, Visiotronic, or any hobart_* tool, even for a narrow question like "is the dishwasher OK". The freshness and code-meaning traps below are where confident wrong answers come from.
---

# Working with Hobart dishwashers

The tools read the Hobart Cloud-to-Cloud API (Visiotronic 1.5) for the machines registered
on one Hobart account.

| Tool                       | Answers                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `hobart_list_machines`     | Which machines, which type, when each last talked to cloud  |
| `hobart_machine_overview`  | Errors + temperatures + daily consumption, in one call      |
| `hobart_get_active_errors` | Errors active right now                                     |
| `hobart_get_temperatures`  | Wash (A270) and rinse (A283) temperature, last program      |
| `hobart_get_machine_data`  | Every parameter, counters, hygiene protocol (cycle log)     |
| `hobart_ping`              | Is the API reachable and the account accepted               |
| `hobart_register_machine`  | _Write, only if enabled._ Add a machine with its 6-char code |
| `hobart_update_settings`   | _Write, only if enabled._ Change dosage, density, autostart |

If the write tools are not in your tool list, the server is read-only: say so instead of
suggesting a workaround.

## Ladder

1. `hobart_list_machines`: get serials. Never guess a serial.
2. `hobart_machine_overview` for "how is it doing".
3. A detail tool only when the question needs it (full parameters, cycle log).

## Freshness: the trap that matters most

- **`machineTime` in the machine list is the machine's clock at its last contact.** If it is
  days or weeks old, the machine is off, unplugged or offline, and every reading you get is
  from that date. Say so first, before quoting any number.
- **Daily data is not live.** Hobart refreshes it after the machine is powered off or shortly
  before midnight. It describes the last completed day of use.
- **Every result states `fetched …` and whether it is cached.** The server caches errors
  30 s, temperatures 60 s, daily data 5 min, to respect Hobart's polling limits. Calling
  again sooner returns the same answer; do not loop to "refresh".
- "No active error" means none was reported, not that the machine is running.

## What the codes mean, and what is not known

Known from the API and the machine itself:

| Code                    | Meaning                                              |
| ----------------------- | ---------------------------------------------------- |
| `DailyWaterCons`        | Water consumed over the day                          |
| `DailyEnergyCons`       | Energy consumed over the day                         |
| `DailyDetergentCons`    | Detergent consumed over the day                      |
| `DailyRinseAidCons`     | Rinse aid consumed over the day                      |
| `A270` / `A283`         | Wash tank / rinse temperature, °C                    |
| `A133` / `A134`         | Detergent / rinse aid dosage (e.g. 2.3 / 0.30)       |
| `A104` / `A105`         | Detergent / rinse aid density (e.g. 1.25 / 1.00)     |
| `S078`                  | Autostart enabled                                    |
| `A180`–`A186`           | Autostart time slots 1–7, `HH:MM`; `--:--` = empty   |
| `A117` / `A118`         | Machine type / serial number                         |
| `last_program`, hygiene `programCode` | Program number run for that cycle      |

The API does not return units for the daily consumption figures, and the many other `A0xx`
(set-points) and `C0xx` (counters) codes are not documented here. When asked about one:
quote the value and say its exact meaning is not documented. Do not invent one. Comparing
the same code across machines or across days is fine and often useful.

## Changing settings (only when the write tools exist)

This changes a real machine in a real kitchen.

1. Read the current values with `hobart_get_machine_data`.
2. Tell the person exactly what will change, old → new, on which serial.
3. Call `hobart_update_settings` only after an explicit yes, with only the fields that change.
4. `NOT_BIDIRECTIONAL` means the machine cannot be configured remotely at all. It is not a
   transient failure; do not retry.

Never change a setting because a reading "looks wrong": report it and let the person decide.

## Errors

- `NOT_FOUND`: the serial is not on this account. List the machines.
- `AUTH_FAILED`: configuration problem on the server side; retrying will not help.
- `UPSTREAM`: the Hobart cloud failed; try once more later, not in a loop.
