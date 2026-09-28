# Opleverrapport: editing en geïsoleerde self-test

> Historisch rapport van vóór de naamswijziging. De huidige productnaam is Data Pulse; oorspronkelijke productnamen en testresultaten hieronder zijn behouden.

Uitbreiding van `codex/watchdog-v0.1`, bestaande draft PR #1; geen merge. Er is geen live Homey benaderd, geïnstalleerd of gewijzigd. Dependencies en lockfile zijn ongewijzigd.

## Resultaat

- Monitors hebben Edit / Save changes / Cancel, behouden dezelfde ID en kunnen alle detectievelden inclusief enabled en broncontract bewerken.
- Bestaande fingerprints bepalen runtimecompatibiliteit: detectiewijziging krijgt een veilige nieuwe observatieperiode; metadata en ongewijzigde monitors behouden hun runtime, inclusief passende incident- en herstelstabiliteit.
- Eén optioneel **Data Watchdog Test Source (simulation)**, volledig lokaal, met Start / Stop / Send now als settingsknoppen en Flow-acties. Vast interval 30 s; altijd gestopt na restart; timestamp blijft na Stop exact staan. Geen writes naar andere devices/integraties.
- Testbewijs loopt via de bestaande adapters/service/core/Flow-dispatch. Er worden geen incidenten geïnjecteerd. De externe heartbeatpoort blijft beschikbaar als uitbreidingspunt.

## Geraakte onderdelen

| Onderdeel                                      | Bestanden                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Dunne settings-UI                              | `settings/index.html`, `settings/settings.js`                                                                             |
| Pure core, bestaande fingerprints              | `src/core/engine.ts` (`reconfigure`); model/detectors blijven ongewijzigd                                                 |
| Homey-adapter/service                          | `src/homey/api-adapter.ts`, `inventory.ts`, `service.ts`                                                                  |
| Lokale simulator en Flow-port                  | `src/homey/test-source.ts`, `flows.ts`                                                                                    |
| SDK-device/pairing                             | `drivers/test-source/device.ts`, `driver.ts`, `assets/icon.svg`                                                           |
| Registratie, geauthenticeerde routes, manifest | `app.ts`, `api.ts`, `app.json`, `scripts/generate-manifest.mjs`                                                           |
| Build                                          | `tsconfig.json`, `scripts/copy-assets.mjs`                                                                                |
| Tests                                          | uitgebreide `test/adapter.test.ts`; nieuwe `editing.test.ts`, `settings.test.ts`, `test-source.test.ts`, `driver.test.ts` |
| Documentatie                                   | `README.md`, `docs/self-test.md`, dit rapport                                                                             |

## Testresultaten

Volledige lokale controle via `npm run check` op Node 24.19.0; aanvullend test-TypeScriptcheck en de gehele suite onder doelruntime Node 22.23.2:

| Gate                                                 | Resultaat                                          |
| ---------------------------------------------------- | -------------------------------------------------- |
| Bestaande suite                                      | **35/35 geslaagd**                                 |
| Nieuwe tests                                         | **27/27 geslaagd**                                 |
| Totaal `npm test`, inclusief test-TypeScriptcheck    | **62/62 geslaagd**, 0 failures/skips               |
| Node 22.23.2: test-TypeScriptcheck + volledige suite | **62/62 geslaagd**                                 |
| `npm run lint`                                       | Geslaagd, 0 warnings                               |
| `npm run build`                                      | Geslaagd, inclusief driver/device-output en assets |
| `npm run format:check`                               | Geslaagd                                           |
| `npm run validate`                                   | Officiële Homey CLI debug-validatie geslaagd       |
| `git diff --check`                                   | Geslaagd                                           |

Nieuwe dekking: werkelijke UI-buttonhandlers voor edit/save/cancel, ID-behoud, refresh en afgewezen save; strategie/capabilities/encoding/interval/timeout/enabled/contract/source-wijzigingen; behoud van ongewijzigde monitor en metadata-only device/integration recovery; listenerhergebruik; echte driver-pairing en device-init/reinit/delete/uninit met SDK-boundary mock; timerdeduplicatie, lopende writes, late callbacks, timestampfreeze, restartbeleid en cleanup; ontbrekende/falende native lastSeen; scopecontrole voor manual heartbeats. Voor iedere evidence-strategie loopt een offline scenario van eigen bronactiviteit via echte adapter/service/engine naar de gewone specifieke én `any_incident_*` Flow-dispatch met dezelfde incident-ID bij herstel.

GitHub CI draait op de bijgewerkte PR; de actuele status is zichtbaar bij de commitchecks. Een groene offline suite of CLI-validatie is geen live SHS-acceptatie of bewijs van een ontvangen Homey-push.

## Drie strategieën en beperkingen

**Manual en timestamp-capability zijn deterministisch testbaar.** Manual gebruikt dezelfde productie-heartbeatservice. Timestamp gebruikt een officieel ondersteunde read-only string sensor; gewone inventory, listeners en snapshots consumeren deze capability.

**Device-last-seen heeft een officiële native route, maar live SHS-verificatie staat open.** De bron roept haar eigen `Device.setLastSeenAt()` zonder timestampargument aan. Homey levert de tijd. Volgens de [officiële SDK](https://apps-sdk-v3.developer.homey.app/Device.html#setLastSeenAt) is dit sinds 12.6.1 bedoeld voor bekende apparaat-activiteit. Automatische lastSeen-updates door willekeurige capability-events worden niet gegarandeerd en niet aangenomen. Een ontbrekende/falende methode wordt zichtbaar gemaakt; geen fake enginewaarde of workaround. De offline test mockt alleen de SDK-grens en bewijst niet dat jouw SHS de property correct publiceert of bevriest.

Eén monitor per device blijft de bestaande regel: test de drie strategieën achtereenvolgens door dezelfde monitor te editen. Stop/Start kan bewust bestaande notificatieflows laten vuren via de gewone watchdogtriggers. Productieflows worden niet gewijzigd. Een bestaande pushfilter kan testmeldingen uitsluiten; dat is zichtbaar te onderscheiden van app-dispatch.

## Veilige SHS-acceptatie

De exacte configuratie, wachttijden, verwachte tokens/statussen en aparte manual/lastSeen/restart/cleanup-controles staan in [het handmatige stappenplan](self-test.md#handmatige-shs-acceptatie). Kern: alleen testdevice toevoegen → timestamp-monitor met ISO, 0.5 min interval en 3 min timeout → Start/HEALTHY → Stop/freeze → na ongeveer 4 min DEVICE_STALE + bestaande push → Start/RECOVERING/HEALTHY + recovery-push. Daarna dezelfde monitor achtereenvolgens naar manual en device-last-seen editen. Voor lastSeen daadwerkelijk vooruitlopen én stilstaan van de via Homey gelezen last-delivery-tijd bevestigen. Rond af door alleen de testmonitor uit te schakelen en de simulator te stoppen.
