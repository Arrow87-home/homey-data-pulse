# Compatibility and acceptance gate

Evidence levels: **documented** = official interface/product table; **client verified** = inspected official package code and offline contract test; **pending live** = not exercised on either physical Homey. No live configuration changed.

| Feature                     | Homey Pro 2023/mini/2026               | Homey SHS                                         | Chosen implementation                                   |
| --------------------------- | -------------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| SDK 3/local platform        | Documented local/v2                    | Explicitly documented local/v2                    | One app, platform local                                 |
| Node.js/TypeScript          | Node 22 at Homey >=12.9                | Same SDK baseline; installed version pending live | TS to CommonJS, no native binaries                      |
| API permission              | Documented                             | Same local platform path; acceptance pending      | Only homey:manager:api                                  |
| API bootstrap               | Client verified local/v2 branch        | Same documented platform branch                   | createAppAPI, local URL/token                           |
| ManagerDevices              | Local API schema/client verified       | Same local client; pending live                   | getDevices and selected subscriptions                   |
| ManagerApps/ManagerZones    | Local API schema/client verified       | Same local client; pending live                   | Metadata inventory; name fallback on optional failure   |
| Realtime subscriptions      | Client supports capability + CRUD      | Same client; emission semantics pending live      | Timestamp values only; periodic snapshot reconciliation |
| Same-value capability event | Client accepts newer transaction times | Same client behavior                              | No universal delivery inference                         |
| lastSeenAt                  | SDK >=12.6.1, source-maintained        | Same SDK; source support pending                  | Explicit activity contract only                         |
| Settings/persistence        | SDK documented                         | Shared SDK; volume/restart test pending           | Versioned config + runtime settings                     |
| Flow cards                  | SDK documented                         | Product supports Flow/Advanced Flow               | Own SDK cards, primitive tokens                         |
| Timers/lifecycle            | SDK documented                         | Shared SDK; process lifecycle pending             | One Homey scheduler, cleanup, checkpoints               |
| Radios                      | Not needed                             | Not needed                                        | No Bridge dependency                                    |
| Host power loss             | App cannot observe itself              | App cannot observe itself                         | Future external heartbeat sink                          |

Pro 2016–2019 local/v1 is not the acceptance target of this first implementation; adapter refuses unsupported platform generations clearly. This does not restrict the user's Pro 2023. Homey Cloud is excluded because the needed permission is prohibited there.

## Authorized next experiment (not run)

Use an isolated test app/device on SHS first, then Pro. Installation and source writes require explicit permission.

1. Record firmware, SDK platform/version and source app versions.
2. Verify inventory, owner URI/driver identity, settings and all Flow tokens.
3. Source reports identical 21.3 values every interval; log source receipt, SDK call and third-party event separately. Check lastUpdated, lastChanged and lastSeenAt independently.
4. Contrast successful report, cached replay, command write, no source response and app stopped. Do not infer attribution from a generic capability update.
5. Use an explicit heartbeat timestamp/lastSeenAt implementation with a known source contract; stop one source, then several devices; inspect suppression and recovery.
6. Restart watchdog during an open incident; interrupt its observation socket; verify no duplicate starts or invented recovery.
7. Rename/remove/re-add a device; confirm selections and missing status.
8. Validate SHS persistent volume survival after container restart. Check app-level persistence separately from host backup strategy.

The generic same-value question is resolved as a **documented limitation with working explicit strategies**, not as a universal guarantee awaiting optimistic deployment.
