# Monitorbewerking en lokale self-test

Actuele handleiding voor de lokale self-test op branch `codex/data-pulse-v0.1`. Settings en Flow-weergave zijn door de gebruiker op SHS gecontroleerd; het onderstaande protocol verifieert de volledige incident-/herstelketen van een concrete build. Het oorspronkelijke opleverrapport staat in [self-test-report.md](self-test-report.md).

## Wijzigingen en grenzen

- Settings: Meer (•••) → Bewerken, Wijzigingen opslaan en Annuleren; ID-behoud, enabled, broncontract en alle evidence/intervalvelden. Bron en device blijven tijdens edit vast. Ontbrekende opgeslagen timestamp-capabilities blijven zichtbaar en worden niet stilzwijgend verwijderd. Statusrefresh bewaart een editconcept; mislukte saves bewaren het concept.
- Core: `reconfigure()` gebruikt de bestaande monitor- en policy-fingerprints. Ongewijzigde detectie behoudt runtime en incident/recovery-identiteit; gewijzigde detectie krijgt nieuwe observatiegrace en geen oude health. Uitgeschakelde monitors tonen DISABLED; inschakelen begint opnieuw. App-restart houdt de eerdere volledige grace-semantiek. Administratief incompatibele incidenten worden zonder recovery-event afgesloten.
- Adapter/service: bestaande timestamplisteners verwijzen na edit naar de actuele engine; reconfiguratie stapelt geen subscriptions. Manual testbewijs gaat door dezelfde `WatchdogService.heartbeat()` als geauthenticeerde API-/Flow-heartbeats, met een aanvullende device/source-identiteitscontrole binnen de servicequeue.
- Eén optioneel SDK-device, vaste pairingidentiteit, standaard single-device pairing en singletonregistratie. Custom `last_test_heartbeat` is een getable, niet-setable string sensor met ISO UTC-tijd als waarde. Geen on/off-capability of statuswrites die Stop tot bewijs zouden maken.
- Lokale broncontroller: Start stuurt direct en vervolgens elke 30 seconden; herhaald Start stapelt geen timers. Stop wacht lopende activiteit af en bevriest daarna de timestamp. Send once stuurt eenmalig, zonder een gestopte bron aan te zetten. Twee opdrachten in dezelfde milliseconde verzinnen geen nieuwere tijd. Cleanup wacht lopende activiteit af; late timercallbacks worden genegeerd.
- Iedere app-/device-initialisatie begint **gestopt**. Alleen de laatste werkelijk gegenereerde capability-timestamp blijft door Homey bewaard. Geen opgeslagen enabled-state. Actief/gestopt, tijd, interval, native lastSeen-resultaat en aantal geaccepteerde bevestigingen staan onder Test en diagnostiek; Vernieuwen haalt de actuele stand op.
- De testbron schrijft uitsluitend naar zijn eigen capability en roept zijn eigen native SDK-methode aan. Geen API-devicewrites, andere integraties, cloud/backend, MQTT, self-healing of gewijzigde authenticatie. Alle nieuwe routes zijn `public: false`.

De bestaande incidentengine en Flow-dispatch worden volledig gebruikt. Bestaande `any_incident_started`/`any_incident_recovered`-Flows ontvangen daardoor ook deze geplande simulatie-incidenten. Het doel is juist de bestaande pushketen te testen; er worden geen productie-Flows aangepast. De bron-app-ID is `io.github.arrow87-home.datawatchdog`, het device heet standaard **Data Pulse Test Source (simulation)**. De simulator correleert dus niet met Plugwise of andere bron-apps.

## Evidence en officiële lastSeen-semantiek

| Strategie              | Werking van de testbron                                                                                                                                          | Validatiestatus                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `manual`               | Een werkelijke lokale heartbeat roept bestaande `service.heartbeat()` aan voor alleen een enabled manual monitor van het uniek geïdentificeerde eigen testdevice | Deterministisch; volledige offline stale/recovery- en Flow-keten geslaagd                                             |
| `timestamp-capability` | Eigen SDK `setCapabilityValue('last_test_heartbeat', ISO)`; normale inventory/subscription/snapshot leest de waarde                                              | Deterministisch; volledige offline keten geslaagd; custom capability volgt officiële SDK-definitie                    |
| `device-last-seen`     | Eigen SDK `Device.setLastSeenAt()` **zonder argument** na een heartbeat; Homey bepaalt/bewaart de tijd; normale API-snapshot/detector leest deze                 | Officieel ondersteunde interface; offline grensmock geslaagd. Werkelijke SHS-exposure/freeze nog handmatig bevestigen |

De officiële [Device SDK-documentatie](https://apps-sdk-v3.developer.homey.app/Device.html#setLastSeenAt) beschrijft `setLastSeenAt()` sinds Homey 12.6.1 voor een device waarvan bekend is dat het actief en bereikbaar is. Het appminimum blijft Homey 12.9.0. De SDK documenteert bij `setCapabilityValue()` geen algemene garantie dat lastSeenAt automatisch opschuift. Daarom vertrouwen we daar niet op: de simulatie meldt haar eigen activiteit expliciet via die native methode. Nergens schrijft de watchdog-engine een fake lastSeenAt of wordt een administratieve update als levering geïnjecteerd.

De bestaande typepackage mist de methode nog. Een kleine lokale optionele typeverfijning en runtimeguard voorkomen een dependency-upgrade. Als de methode ontbreekt of faalt, toont settings `unavailable` of `failed`; manual en timestamp blijven werken. `sent` betekent dat de native aanroep slaagde, **niet** dat een API-snapshot op deze SHS de property al heeft bevestigd. Als de property ontbreekt, niet vooruitloopt of autonoom blijft bewegen na Stop, keur de derde strategie voor dit device af; pas geen enginehack toe. De echte device-last-seen-functionaliteit voor bestaande bronnen blijft ongewijzigd.

De [officiële custom-capabilitydocumentatie](https://apps.developer.homey.app/the-basics/devices/capabilities) ondersteunt de gebruikte string/sensor/getable/niet-setable configuratie. Er wordt geen alarm/motion/contact/onoff-capability gebruikt. Pairing gebruikt de [officiële standaard device-list](https://apps.developer.homey.app/the-basics/devices/pairing/system-views/devices-list), geen eigen pairing-backend.

## Handmatige SHS-acceptatie

Voer deze stappen zelf uit op een ondersteunde Homey: Homey Pro (Early 2023), Homey Pro mini, Homey Pro (2026) of Homey Self-Hosted Server met Homey 12.9.0 of nieuwer. Oudere platform-v1-modellen en Homey Cloud worden niet ondersteund. De runtimeguard blijft actief; automatische uitsluiting door de Store is niet bevestigd.

De Settings-interface en Flow-weergave zijn door de gebruiker live op SHS gecontroleerd. Onderstaand protocol blijft de controle voor de exacte volgende Test-build, de gekozen bewakingsmethode en herstartgedrag. Deze documentatie-update installeert niets. Gebruik alleen de lokale testbron en laat productieapparaten, integraties en bestaande Flows intact. Een app-update/herstart begint wel een nieuwe observatieperiode voor monitors: kies daarvoor zelf een geschikt moment.

### Laatste gegevens ontvangen: incident en herstel

1. Noteer Homey-versie en build/commit. Voeg zo nodig via Homey Apparaten **Data Pulse → Data Pulse Testbron (simulatie)** toe. Gebruik een reeds gekoppelde testbron opnieuw; een tweede pairing hoort geen extra bron aan te bieden.
2. Open Data Pulse Settings en kies **Vernieuwen**. Nieuwe apparaten verschijnen uiterlijk bij een volgende inventarisatie, doorgaans binnen circa één minuut. Onder **Test en diagnostiek → Lokale test** staat de bron **Gestopt**. Er ontstaan geen nieuwe bevestigingen zolang je niet start of eenmalig verstuurt.
3. Kies **Monitor toevoegen → Laatste gegevens ontvangen → Apparaten kiezen**. Selecteer alleen de testbron en kies **Selectie bevestigen**. Bestaat zijn monitor al, gebruik dan **Meer (•••) → Bewerken** in plaats van een nieuwe monitor.
4. Stel de gezamenlijke timing in op **0,5 minuut** verwacht en **3 minuten** meldtermijn. Open **Instellingen per apparaat aanpassen** en controleer het veld **Laatste testbevestiging** (`last_test_heartbeat`) met ISO-formaat. In het Engels heet dit veld **Last test heartbeat**. De WAARDE moet zelf een tijdstip bevatten; een meetwaarde of `capability.lastUpdated` telt niet. In Bewerken staan tijdveld en timing direct in het individuele formulier.
5. Kies **Monitors toevoegen** of **Wijzigingen opslaan**. Klik vervolgens **Test starten** onder Lokale test. De Flow-actie **Start testupdates** doet hetzelfde. De monitor hoort **Gezond** te worden; gebruik **Vernieuwen** om de laatste activiteit/ontvangst te zien. Snapshotreconciliatie kan circa 60 seconden duren.
6. Klik **Stoppen**. Noteer de laatste tijd en controleer na 60–90 seconden dat deze niet verandert. Klik tijdens deze stopfase niet op **Eenmalig sturen**.
7. Wacht circa **3 minuten meldtermijn + 1 minuut correlatievenster + maximaal 10 seconden schedulervertraging** vanaf de laatste bevestiging. De monitor gaat via **Update vertraagd** naar **Geen gegevens**. Onderbreking van de bewaking kan dit vertragen; controleer de verbinding onder Test en diagnostiek.
8. Verwacht de triggers **Bewaakte bron ontvangt geen updates meer** (`device_stale`) en **Data Pulse-incident gestart** (`any_incident_started`). Een bestaande meldingsflow ontvangt het event als zijn filters de testbron toelaten. Gebruik voor dezelfde notificatie één triggerfamilie om dubbele pushmeldingen te voorkomen. De agent wijzigt geen productieflow.
9. Klik **Test starten**. Na stabiele bevestigingen volgt **Herstelt**, daarna **Gezond**. Verwacht na minimaal 60 seconden stabiel herstel **Bewaakte bron is hersteld** (`device_recovered`) en **Data Pulse-incident hersteld** (`any_incident_recovered`) met hetzelfde incident-ID. Houd rekening met snapshot-/schedulervertraging.
10. Stop de simulator na afloop en kies **Meer (•••) → Uitschakelen** voor alleen de testmonitor. Eén testmonitor kan geen integratie-incident vormen; daarvoor zijn meerdere getroffen monitors nodig.

De Flow-acties **Start testupdates**, **Stop testupdates** en **Stuur nu een testupdate** bedienen uitsluitend de eigen gekoppelde testbron. Je kunt ze apart met de Homey Flow-testfunctie controleren zonder bestaande Flows te wijzigen. In de Engelse editor heten ze **Start test updates**, **Stop test updates** en **Send a test update now**.

### Bevestiging via Flow op hetzelfde apparaat

1. Stop de test en open **Meer (•••) → Bewerken** bij dezelfde monitor. Kies **Bevestiging via Flow**, behoud 0,5 / 3 minuten, schakel bewaking in en kies **Wijzigingen opslaan**.
2. Controleer dat het monitor-ID behouden is en er precies één monitor voor dit apparaat bestaat. **Opstarten** is verwacht na een methodewijziging.
3. Klik **Eenmalig sturen**. De simulator blijft **Gestopt**, maar genereert één nieuwe timestamp en bevestigt die via de bestaande manual-service aan zijn eigen monitor. In de technische testdetails hoort **Bevestigde leveringen: 1** te staan. Bij 0: controleer of inventarisatie en monitor gereed zijn, vernieuw en herhaal met een later tijdstip.
4. Doorloop Start/Stop/Start voor dezelfde incident-/herstelketen. De API `/heartbeat/:id` en de Flow-actie **Bevestig een geslaagde update** (`record_heartbeat`) houden hun bestaande semantiek. Productiebevestigingen moeten volgen op werkelijk geslaagde updates, nooit op een blinde timer.

### Apparaatactiviteit: native lastSeenAt controleren

1. Stop de test, open **Meer (•••) → Bewerken**, kies **Apparaatactiviteit** en sla op met dezelfde tijden.
2. Start de test. Controleer in de technische testdetails of **Homey lastSeenAt: Verstuurd** verschijnt. Kijk bij de monitor naar **Laatste activiteit**: dit komt uitsluitend uit Homey's echte `lastSeenAt`, niet uit het eigen tijdveld. Verwacht binnen circa 60–70 seconden een vooruitgaand tijdstip en **Gezond**.
3. Stop. Na maximaal één nog te verwerken snapshot moeten zowel Laatste activiteit als het testtijdveld exact blijven staan. Doorloop de volledige meldtermijn en Start/herstel.
4. Noteer firmware en resultaat. Een geslaagde native aanroep is geen bewijs dat SHS de tijd ook via de API publiceert. Ontbreekt die tijd, staat hij stil tijdens de test of loopt hij door na Stoppen, dan is deze strategie op dat platform niet aangetoond. Gebruik Bevestiging via Flow of Laatste gegevens ontvangen; fabriceer geen lastSeenAt.

### Bewerken, annuleren, herstart en verwijderen

- Open **Meer (•••) → Bewerken**, verander een tijd en kies **Annuleren**: er mag niets worden opgeslagen. **Wijzigingen opslaan** behoudt het ID; detectiewijzigingen starten een nieuwe observatieperiode.
- Een technische notitie onder **Meer opties** is metadata. Wijzigen daarvan behoudt compatibele runtime en herstelvoortgang.
- Nieuwe monitors gebruiken standaard gezamenlijke tijden. **Instellingen per apparaat aanpassen → Afwijkende timing instellen** wijzigt alleen de gekozen bron; na opslaan zijn het zelfstandige monitors, zonder opgeslagen groep.
- Een bewust uitgevoerde app-herstart moet de testbron **Gestopt** laten beginnen, met de vorige timestamp en zonder automatische timer. De monitor wacht op nieuw bewijs; een herstart is geen bevestiging.
- Verwijderen van uitsluitend het testdevice ruimt zijn timers op. Zijn monitor blijft behouden en wordt **Ontbreekt**, zonder herstelmelding. **Meer (•••) → Verwijderen** verwijdert alleen die monitor. Een opnieuw gekoppeld device kan een nieuwe Homey-ID hebben.

## Offline validatie

De volledige suite bevat regressietests voor UI-edit/save/cancel en savefouten; ID-behoud; detectievelden/reset en metadata/recoverybehoud; listenerhergebruik; start/stop/send; stilstaande timestamps; restart, late callbacks en cleanup; falende/ontbrekende native methode; identiteitsafscherming; en de echte service/adapter/core/Flow-dispatchketen voor elke strategie. SDK- en Flow-grenzen zijn mocks; er wordt geen echte push ontvangen in deze tests.

Zie [opleverrapport van deze uitbreiding](self-test-report.md) voor de exacte aantallen en gate-resultaten. Dependencies en lockfile zijn ongewijzigd. De externe heartbeat-uitbreidingspoort is intact.
