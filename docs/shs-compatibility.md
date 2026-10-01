# Local Homey compatibility and acceptance

Data Pulse requires a local Homey running Homey 12.9.0 or later. Homey Cloud is not supported.

The manifest retains `platforms: ["local"]`, `compatibility: ">=12.9.0"`, SDK 3 and `homey:manager:api`. Athom clarified during app review that Store compatibility follows the local/cloud platform selection and Homey version requirement. Data Pulse therefore checks only `homey.platform === 'local'`; it does not impose an additional hardware-generation restriction or maintain its own supported-model list.

## API compatibility findings

The pinned `homey-api@3.20.0` package was inspected. No hard dependency on the second local platform generation was found in Data Pulse's adapter, inventory, service, API routes or test-source code.

| Boundary                | Evidence and unchanged behaviour                                                                                                                                                                                                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HomeyAPI.createAppAPI` | Selects `HomeyAPIV2` for local `platformVersion: 1` and `HomeyAPIV3Local` for local `platformVersion: 2`. Both obtain the local URL and owner API token through the SDK. The version numbers select client implementations, not Data Pulse's acceptance policy.                                |
| Devices and realtime    | Both clients provide `devices.getDevices`, manager `connect`/`disconnect`/`isConnected`, CRUD events, `device.connect` and `makeCapabilityInstance`. The older client inherits the shared manager/device implementation.                                                                       |
| Device values           | `capabilitiesObj` is preserved; timestamp monitoring reads the selected capability's value. No measurement or `capability.lastUpdated` is promoted to delivery evidence.                                                                                                                       |
| Device identity         | The older client normalizes `driverUri` plus a short driver ID into a qualified driver ID. `identifySource()` also retains owner URI, modern qualified IDs, legacy own-data `driverUri`, short/local IDs and conflict handling.                                                                |
| `lastSeenAt`            | Read only when supplied by the source. Its availability and progression require source-specific live validation; no synthetic fallback is introduced. The optional test source already tolerates a missing/failing native `setLastSeenAt()` while keeping timestamp/manual evidence available. |
| Apps and zones          | `apps.getApps` and `zones.getZones` exist in both clients. Optional metadata failures keep the existing name/zone fallbacks.                                                                                                                                                                   |
| Flow and Settings       | The app uses SDK Flow cards and Settings get/set, with unchanged card IDs, tokens, config schema and persistence keys. Neither boundary uses a hardware-generation check.                                                                                                                      |
| Runtime and lifecycle   | Existing scheduler, observation grace, checkpointing and cleanup remain unchanged. No radio, Bridge or native binary dependency is added.                                                                                                                                                      |

The upstream factory still rejects missing or unknown platform-version values because it cannot select a client. Removing Data Pulse's extra guard does not bypass or modify that upstream validation. Tests distinguish reaching the factory from successfully constructing a supported local client.

Official references: [API factory](https://athombv.github.io/node-homey-api/HomeyAPI.html), [older local client](https://athombv.github.io/node-homey-api/HomeyAPIV2.html), [manifest](https://apps.developer.homey.app/the-basics/app/manifest).

## Verification scope

Offline tests cover startup acceptance/rejection, both real local API factory branches and their required method/data contracts, existing device-identity fallbacks, config/runtime compatibility and Flow contracts. SDK/server boundaries are mocked; this is not a claim of end-to-end operation on every Homey model. The user has previously checked the Settings interface and Flow display on SHS.

## Manual acceptance on local hardware

No deployment or live Homey access is part of this correction. When separately authorized, test an isolated source on the intended Homey, including older hardware offered the app by the Store:

1. Record firmware, source-app versions and the API-client variant selected at startup.
2. Verify inventory, owner/driver identity, optional app/zone metadata, Settings persistence and Flow tokens.
3. Verify selected timestamp values, realtime subscriptions and snapshot reconciliation. A constant ordinary measurement is not evidence of failure.
4. For Device activity, confirm that the source supplies a meaningful `lastSeenAt` that advances on activity and freezes when that activity stops. If unavailable, choose another supported evidence method.
5. Use the [local self-test protocol](self-test.md) to check stale detection, grouped incidents where applicable and stable recovery without altering production integrations.
6. Restart during an incident and interrupt/reconnect observation. Check persistence, fresh-evidence grace, cleanup and absence of duplicate incident starts.
7. Check device rename/removal/re-addition and missing-source behaviour. On SHS, separately verify persistent-volume survival.

Actual event delivery, reconnect behaviour, optional native last-seen support and resource use on older hardware remain live acceptance points. The app cannot report a complete outage of its own host while stopped.
