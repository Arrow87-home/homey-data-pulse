# Opleverrapport — 17 september 2026

> Historisch rapport van vóór de naamswijziging. De huidige productnaam is Data Pulse; oorspronkelijke productnamen en testresultaten hieronder zijn behouden.

## Resultaat

Fasen A–E zijn uitgewerkt als v0.1 ontwikkelbasis. De app is klaar voor code-review en een expliciet goedgekeurde SHS-testinstallatie. Er zijn geen live Homey-wijzigingen, app-restarts bij andere integraties of App Store-publicaties uitgevoerd.

## Bewezen en nog open

- **SHS-platformbasis onderbouwd:** de officiële SDK classificeert SHS en Pro 2023 als local/platformVersion 2. De echte `homey-api@3.20.0` factory kiest in een offline contracttest dezelfde lokale API-implementatie. Dit is geen live SHS-integratietest.
- **Same-value beperking opgelost in het ontwerp:** de officiële client accepteert gelijke capabilitywaarden met nieuwere transactietijden, maar generieke bronlevering is daarmee niet bewezen. Gewone capability-events en lastChanged tellen niet als heartbeat. Expliciete timestampwaarden, bronondersteund lastSeenAt en geauthenticeerde delivery-attestaties zijn geïmplementeerd.
- **Kern gebouwd:** gevalideerde configuratie/runtime, toestandsmodellen, centrale stale-evaluatie, correlatie, incidentonderdrukking, stabiel herstel, resterende defecten, restartgrace, injecteerbare klok en gescheiden persistence.
- **Homey-laag gebouwd:** lokale bootstrap, inventaris van apps/devices/zones/capabilities, bronidentiteit, geselecteerde listeners, begrensde snapshotpolling, kleine instellingenpagina, geauthenticeerde API en zes triggers/vier conditions/drie actions.
- **Nog onzeker:** werkelijk bronrapportagegedrag per integratie, permissies en sockets op de geïnstalleerde SHS-firmware, Homey-instellingenflush bij harde uitval en echte Flow-uitvoering. Instellingenpagina en live installatie zijn niet op Homey visueel/functioneel getest.
- **Externe hostbewaking:** transportinterface en MQTT/HTTP-ontwerp aanwezig; nog geen actieve externe heartbeat. Een watchdog op dezelfde host kan totale hostuitval niet zelf melden.

## Validatie

| Controle                        | Resultaat                                                        |
| ------------------------------- | ---------------------------------------------------------------- |
| `npm test`                      | 35/35 tests geslaagd; testcode ook door TypeScript gecontroleerd |
| Dezelfde 35 tests onder Node 22 | Geslaagd, naast ontwikkelruntime Node 24                         |
| `npm run lint`                  | Geslaagd met ESLint 10, nul waarschuwingen/fouten                |
| `npm run build`                 | Geslaagd; CommonJS-app in `.homeybuild/`                         |
| `npm run format:check`          | Geslaagd                                                         |
| `npm run validate`              | Officiële Homey CLI-validatie op niveau debug geslaagd           |
| Live SHS / Pro, Homey App Store | Niet uitgevoerd                                                  |

De tests omvatten onafhankelijke storingen, geaggregeerde uitval, later getroffen devices, volledig/gedeeltelijk herstel, flapping, incidentherstel na restart, obserververlies, ontbrekende devices/capabilities, wijzigingen in selectie/metadata, replay/toekomstige timestamps, officiële API-clientsemantiek, listenercleanup, API-callcoalescing, Flow-tokencontracten en een mislukte runtime-checkpoint zonder alsnog notificaties te versturen.

## Belangrijkste keuzes

App-ID `io.github.arrow87-home.datawatchdog`, SDK 3, Homey >=12.9, Node 22 runtime en Node 24 ontwikkeltooling. Eén monitor per device; meerdere timestamp-capabilities zijn any-of. Standaard aggregatie bij >=2 devices en >=80% binnen één minuut. Herstel bij >=90% van de oorspronkelijke cohort met stabilisatie. Monitors zonder bewijs starten onbepaald; obserververlies wordt geen bronstoring. Flow-dispatch is at-most-once per verwerkte transition met een gedocumenteerd crashvenster, geen exactly-once-garantie.

Een native lastSeenAt bewijst activiteit, niet automatisch verse meetdata. Beide systemen delen hiervoor dezelfde SDK-beperking; dit is geen specifiek SHS-tekort. SHS vereist daarnaast blijvende opslag van zijn containerdata. De externe monitor moet ook broker-/hostuitval kunnen detecteren.

## Bestanden en wijzigingen

`docs/architecture.md`, `docs/state-machines.md`, `docs/shs-compatibility.md`, dit rapport, `README.md`, SDK-entrypoints/manifest, `src/core/`, `src/homey/`, `settings/`, `test/`, build/lint/formatter-configuratie, dependency-lockfile en GitHub Actions-validatie. De oorspronkelijke Node `.gitignore` is behouden en uitgebreid met Homey-specifieke paden.

Repository: [Arrow87-home/homey-data-watchdog](https://github.com/Arrow87-home/homey-data-watchdog). Initialisatiecommit: `f738f7b`. De volledige implementatie wordt als afzonderlijke commit op `codex/watchdog-v0.1` aangeboden in een concept-PR; de PR bevat de exacte commit en diff. Er wordt niets gemerged.

## Concrete volgende stap

Review de PR. Geef daarna expliciet toestemming voor één geïsoleerde testinstallatie op SHS en een gecontroleerde testbron. Begin met het rapportagecontract van één integratie, bijvoorbeeld Plugwise. Controleer verse ontvangst met gelijkblijvende waarden en een stop/herstelcyclus voordat je normale notificatie-Flows of meer devices inschakelt. Het volledige protocol staat in `docs/shs-compatibility.md`.
