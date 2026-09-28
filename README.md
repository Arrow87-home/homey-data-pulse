# Data Pulse

Lokale watchdog voor aantoonbare datalevering en apparaatactiviteit, met gebundelde storingsmeldingen per bron-app. **Homey Self-Hosted Server is het primaire doelplatform**, naast Homey Pro 2023/mini/2026.

Status: development en voorbereiding van de volgende Test-build. Store-afbeeldingen, iconen en EN/NL Store-copy zijn aanwezig. De Settings-interface en Flow-weergave zijn door de gebruiker live op SHS gecontroleerd. Deze controles betekenen niet dat ieder bron-/platformscenario al end-to-end is gevalideerd. Certificering is nog niet opnieuw ingediend; de publieke release is nog niet goedgekeurd.

Vereist Homey Pro (Early 2023), Homey Pro mini, Homey Pro (2026) of Homey Self-Hosted Server met Homey 12.9.0 of nieuwer. Oudere Homey-modellen (local platform v1) en Homey Cloud worden niet ondersteund. De bestaande runtimecontrole accepteert uitsluitend platform v2. Dit is geen claim dat de Store oudere modellen automatisch blokkeert; de exacte distributiebeperking wordt apart met Athom bevestigd.

Zie [onderzoek en architectuur](docs/architecture.md), [toestandsmodellen](docs/state-machines.md) en de [SHS-acceptatiepunten](docs/shs-compatibility.md).

New to Data Pulse? Start with the [User Guide](docs/user-guide.md). The settings page also includes a built-in **Help** section, available without opening GitHub.

## Bewust geselecteerde bronnen

Data Pulse bewaakt alleen bronnen die je zelf toevoegt. Je kiest per bron expliciet bewijs van apparaatactiviteit, een tijdveld met de laatste gegevensontvangst of een bevestiging na een geslaagde levering. De app combineert samenhangende storingen en bevestigt stabiel herstel voor die geselecteerde bronnen.

Dit is geen automatische bewaking van alle apparaten, batterijniveaus of beschikbaarheid. De focus ligt op de versheid en betrouwbaarheid van data waar je op vertrouwt.

## Wat wordt werkelijk bewaakt?

Een temperatuur die gelijk blijft, is geen bewijs van een defect. De app behandelt `capability.lastChanged` daarom niet als generieke heartbeat. De officiële client kan gelijke waarden met een nieuwe transactietijd doorgeven, maar dat bewijst niet dat alle bron-apps of Homey-versies iedere levering publiceren.

| Strategie              | Bewijs                                                                    | Voorwaarde                                                                                         |
| ---------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `timestamp-capability` | De **waarde** van een expliciete ontvangsttijd-capability schuift vooruit | Bekende bronsemantiek, ISO/epoch seconds/epoch ms; meerdere gekozen capabilities werken als any-of |
| `device-last-seen`     | Het apparaat is door de bron als actief/geantwoord gemarkeerd             | Bron werkt `setLastSeenAt()` daadwerkelijk bij; dit bewijst niet dat elke meting is vernieuwd      |
| `manual`               | Een geautoriseerde bron bevestigt expliciet een succesvolle ontvangst     | Aanroepen na echte ontvangst, nooit alleen vanuit een blinde periodieke timer                      |

Geen geschikte indicator? Laat het apparaat onbewaakt totdat er een betrouwbare bron-heartbeat beschikbaar is. Aanwezigheid, rename, availability, een geslaagde inventarisatie of een draaiende app tellen niet als datalevering. De watchdog kan een bron die oude data onterecht als vers presenteert niet ontmaskeren.

## Lokaal ontwikkelen

Gebruik Node.js **24 LTS** op je ontwikkelcomputer voor Homey CLI 4.5.0. De geproduceerde app richt zich op **Node 22**, Homey >=12.9.0, SDK 3, `local` platform v2. Geen Homey-login of apparaat nodig voor deze controles:

```sh
npm ci
npm test
npm run lint
npm run build
npm run validate
```

`npm run check` voert de volledige controle inclusief formattering uit. `npm run format` formatteert de bron. `npm run manifest` regenereert `app.json` uit `scripts/generate-manifest.mjs`. De normale check gebruikt Homey-validatie op niveau **debug**. Voer voor een releasecandidate daarnaast `npx homey app validate --level publish` uit; dit valideert zonder te publiceren. De brede API-permissie veroorzaakt de verwachte reviewwaarschuwing van Homey.

`app.ts` en `api.ts` compileren naar `.homeybuild/`. `homey` is op het apparaat een SDK-module; de gelijknamige devDependency is de CLI. Installeer de SDK-module niet als gewone productieafhankelijkheid. De lockfile legt de onderzochte API-client en tooling vast.

Pas na expliciete toestemming voor een testinstallatie op de juiste SHS:

```sh
npx homey login
npx homey select
npx homey app install
```

Deze opdrachten veranderen een live Homey en horen niet bij de offline checks. Volg daarna de [geïsoleerde self-testacceptatie](docs/self-test.md#handmatige-shs-acceptatie).

## Configureren

1. Open **Monitor toevoegen** boven de monitorlijst.
2. Kies bij **Controleer via**: **Apparaatactiviteit**, **Laatste gegevens ontvangen** of **Bevestiging via Flow**.
3. Open **Apparaten kiezen**, selecteer één of meer apparaten en bevestig met **Selectie bevestigen**. De picker sluit; **Wijzigen** opent hem opnieuw.
4. Stel één gezamenlijke verwachte updatefrequentie en meldtermijn in.
5. Open alleen indien nodig **Instellingen per apparaat aanpassen**. Met **Afwijkende timing instellen** krijgt één bron eigen tijden; zonder afwijking gelden de gezamenlijke waarden. Voor Laatste gegevens ontvangen kies je hier per apparaat het juiste tijdveld en formaat.
6. Kies **Monitors toevoegen**. Elk apparaat krijgt een afzonderlijke monitor; nieuwe inventarisapparaten worden nooit automatisch bewaakt.

**Laatste gegevens ontvangen** gebruikt uitsluitend een veld waarvan de **waarde zelf** een datum/tijd van gegevensontvangst bevat. Een temperatuur, teller of `capability.lastUpdated` is geen bewijs. De picker biedt passende actuele tijdwaarden aan en toont een preview. Als geen geschikt veld bestaat, kies je een andere methode. Opgeslagen ontbrekende velden blijven bij Bewerken zichtbaar met een waarschuwing.

Open bij een bestaande monitor het **Meer-menu (•••)** voor **Bewerken**, **Uitschakelen/Inschakelen** of **Verwijderen**. **Wijzigingen opslaan** behoudt dezelfde monitor-ID; **Annuleren** verwerpt het concept. Bron en apparaat blijven tijdens Bewerken vast. Detectiewijzigingen starten een nieuwe observatieperiode; een technische notitie is alleen metadata. Verwijderen wist alleen de monitor, niet het Homey-apparaat.

De compacte monitorlijst toont naam, status, methode, meldtermijn en laatste activiteit/ontvangst. Technische gegevens staan in het Meer-menu onder **Technische details**. **Test en diagnostiek** en **Hulp** zijn ingeklapt beschikbaar. Fouten staan bij de relevante invoer; een mislukte save bewaart het concept.

Voor geavanceerde correlatie-instellingen blijft de geauthenticeerde config-API beschikbaar. `PUT` vervangt de volledige configuratie; lees eerst `GET /config`.

## Lokale self-test

Voeg optioneel één **Data Pulse Test Source (simulation)** toe via Homey Devices. De eigen bron genereert iedere 30 seconden een ISO-timestamp, een expliciete native SDK-activiteitsmelding en indien geconfigureerd een manual heartbeat via de bestaande service. Er zijn geen writes naar andere apparaten. Start/stop/send staan in app-settings en als drie Flow-acties. Na iedere app-restart start de bron **gestopt**; de laatste echte timestamp blijft staan.

Volg de [veilige SHS-acceptatietest en beperkingen](docs/self-test.md). Manual en timestamp zijn deterministisch testbaar. `device-last-seen` gebruikt de officiële `Device.setLastSeenAt()`; daadwerkelijke SHS-publicatie en freeze moeten nog handmatig worden bevestigd. Een capability-update alleen wordt niet als automatische lastSeen-garantie beschouwd.

App API-basis: `/api/app/io.github.arrow87-home.datawatchdog`.

| Methode | Route                   | Gebruik                                                               |
| ------- | ----------------------- | --------------------------------------------------------------------- |
| GET     | `/test-source`          | Status van de optionele eigen testbron                                |
| POST    | `/test-source`          | `{ "action": "start" }`, `stop` of `send`; uitsluitend eigen testbron |
| GET     | `/inventory`            | Laatste lokale inventaris, zonder ruwe meetwaarden/credentials        |
| GET     | `/status`               | Observer, monitors en integratiestatus                                |
| GET     | `/config`               | Opgeslagen configuratieschema                                         |
| PUT     | `/config`               | Gevalideerde vervanging van configuratie                              |
| POST    | `/heartbeat/:monitorId` | `{ "deliveredAt": "2026-09-17T16:22:00.000Z" }` voor manual-strategie |

Alle routes vereisen standaard Homey-authenticatie. Er zijn geen publieke routes. Een heartbeat in de toekomst, een replay of een onbekende monitor wordt geweigerd/ignored volgens de API-resultaten. `accepted: false` betekent dat deze timestamp niet als nieuwe levering is opgenomen.

Voorbeeldconfig (device- en app-IDs vervangen door werkelijke inventariswaarden):

```json
{
  "version": 1,
  "policy": {
    "correlationWindowMs": 60000,
    "minStaleDevices": 2,
    "staleFraction": 0.8,
    "recoveryFraction": 0.9,
    "recoveryStabilityMs": 60000
  },
  "monitors": [
    {
      "id": "bedroom",
      "sourceAppId": "example.integration",
      "sourceAppName": "Voorbeeldintegratie",
      "deviceId": "device-id-from-inventory",
      "deviceName": "Slaapkamer",
      "zone": "Boven",
      "strategy": { "kind": "manual" },
      "sourceContract": "De bron bevestigt iedere succesvolle ontvangst na zijn poll van vijf minuten.",
      "expectedIntervalMs": 300000,
      "staleTimeoutMs": 900000,
      "enabled": true
    }
  ]
}
```

IDs en configuratie blijven behouden als een apparaat tijdelijk verdwijnt. Ontbrekende apparaten/capabilities tonen MISSING; dat is geen herstel. Een verandering van bronidentiteit vereist bewuste herconfiguratie. Configuratie en runtime staan apart in `watchdog-config` en `watchdog-runtime`.

## Meldingen via Flow

Triggers: **Bewaakte bron ontvangt geen updates meer**, **Bewaakte bron is hersteld**, **Integratie-incident gestart**, **Integratie-incident hersteld**, **Data Pulse-incident gestart** en **Data Pulse-incident hersteld**. Voorwaarden controleren of een bron/integratie gezond is, een bron geen updates meer ontvangt of een integratie een incident heeft dat op herstel wacht. Acties: **Controleer nu alle bewaakte bronnen**, **Controleer nu een bewaakte bron**, **Bevestig een geslaagde update**, **Start testupdates**, **Stop testupdates** en **Stuur nu een testupdate**. De monitor-check evalueert de gezamenlijke correlatie mee en omzeilt de API-ratelimiet niet.

Alle triggers hebben `source_app`, `source_app_id`, `device`, `device_id`, `zone`, `capability`, `last_delivery`, `age_minutes`, `expected_interval`, `stale_timeout`, `affected_devices`, `affected_count`, `monitored_count`, `recovered_count`, `incident_duration`, `stale_since`, `status`, `incident_id`, `evidence_kind`, `has_delivery`.

- Tijden zijn ISO UTC-strings; intervallen/duur-tokens zijn minuten. `affected_devices` is tekst, geen array-token.
- Onbekende laatste levering: lege string, `has_delivery=false`, `age_minutes=-1`. Toon dan “nog geen bevestigde heartbeat ontvangen”. Integratietriggers hebben geen enkelvoudige last-delivery-tijd en tonen hun incidentstart en aantallen.
- `evidence_kind=device-activity` betekent apparaatactiviteit; gebruik daarbij geen tekst die de versheid van alle meetwaarden claimt.
- Gebruik óf de specifieke triggers óf de algemene Data Pulse-incidenttriggers voor dezelfde melding; beide families worden aangeboden en een dubbele Flow zou twee meldingen veroorzaken.
- Geen rechtstreekse push of self-healing; je bepaalt zelf welke Homey-notificatie/Advanced Flow reageert.

Standaard: 15 minuten timeout in de UI + 1 minuut correlatievertraging + maximaal een schedulerstap. Twee of meer apparaten én >=80% van de geselecteerde integratie, met stale-grenzen binnen één minuut, starten één integratiestoring. Individuele storingen blijven intern zichtbaar. Eén nieuw getroffen apparaat veroorzaakt geen extra integratiemelding.

Herstel: apparaat moet één minuut stabiel zijn; daarna moet >=90% van de oorspronkelijke integratiecohort nog één minuut stabiel blijven. Eén resterend defect wordt apart zichtbaar gemeld bij geaggregeerd herstel. Apparaten die later worden geselecteerd veranderen de oorspronkelijke herstelnoemer niet.

## Betrouwbaarheidsgrenzen

- Een watchdog op SHS kan volledige uitval van diezelfde host niet zelf melden. Een externe MQTT/HTTP-heartbeat is ontworpen als uitbreidingspoort en **nog niet aangesloten**.
- Event delivery naar Flow is niet atomair met instellingenopslag. Checkpoint vóór dispatch voorkomt replay-stormen, maar een crash op precies dat moment kan een melding verliezen. Geen exactly-once-garantie.
- Geen broncontract, geen generieke zekerheid. End-to-end bronlevering en SHS-lifecycle moeten nog op een toegestaan testapparaat worden gevalideerd.
- Obserververlies en lange schedulerpauzes starten een nieuwe observatiegrace; dit verlaagt foutmeldingen maar vertraagt echte detectie tijdens zo'n onderbreking.
- Verwijderen/uitschakelen/wijzigen van incidentleden kan incidenten administratief beëindigen zonder herstelmelding. Opnieuw inschakelen start met grace. Namen en zones veranderen incidentidentiteit niet.
- Geen telemetry, cloud-backend of productieaanpassingen. Homey's eigen platformdiensten blijven van toepassing.

## Bestandsindeling

| Pad                            | Inhoud                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/core/`                    | Gevalideerde modellen, pure state/correlation engine, evidence-strategieën, externe heartbeat-port |
| `src/homey/`                   | Inventarisatie/subscriptions, settings-persistence, scheduler-service, Flow tokens                 |
| `app.ts`, `api.ts`, `app.json` | SDK-entrypoint, geauthenticeerde routes, manifest/Flow cards                                       |
| `settings/`                    | Kleine bron/apparaatselectie en statuspagina                                                       |
| `drivers/test-source/`         | Optionele eigen virtuele simulatiebron, SDK-capability en lifecycle                                |
| `test/`                        | Fake-clock scenario's, officiële clientcontracten, adapter/service-tests                           |
| `docs/`                        | Onderzoek, architectuur, compatibiliteit en overdracht                                             |
