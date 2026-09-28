# Monitorbewerking en lokale self-test

Datum: 18 september 2026. Branch: `codex/watchdog-v0.1`, bestaande PR #1. Geen merge en geen installatie of bediening op live Homey tijdens deze wijziging. De gebruiker meldde eerder een succesvolle development-start op SHS; onderstaande nieuwe functies wachten op handmatige SHS-acceptatie.

## Wijzigingen en grenzen

- Settings: Edit, Save changes en Cancel; ID-behoud, enabled, broncontract en alle evidence/intervalvelden. Bron en device blijven tijdens edit vast. Ontbrekende opgeslagen timestamp-capabilities blijven zichtbaar en worden niet stilzwijgend verwijderd. Statusrefresh bewaart een editconcept; mislukte saves bewaren het concept.
- Core: `reconfigure()` gebruikt de bestaande monitor- en policy-fingerprints. Ongewijzigde detectie behoudt runtime en incident/recovery-identiteit; gewijzigde detectie krijgt nieuwe observatiegrace en geen oude health. Uitgeschakelde monitors tonen DISABLED; inschakelen begint opnieuw. App-restart houdt de eerdere volledige grace-semantiek. Administratief incompatibele incidenten worden zonder recovery-event afgesloten.
- Adapter/service: bestaande timestamplisteners verwijzen na edit naar de actuele engine; reconfiguratie stapelt geen subscriptions. Manual testbewijs gaat door dezelfde `WatchdogService.heartbeat()` als geauthenticeerde API-/Flow-heartbeats, met een aanvullende device/source-identiteitscontrole binnen de servicequeue.
- Eén optioneel SDK-device, vaste pairingidentiteit, standaard single-device pairing en singletonregistratie. Custom `last_test_heartbeat` is een getable, niet-setable string sensor met ISO UTC-tijd als waarde. Geen on/off-capability of statuswrites die Stop tot bewijs zouden maken.
- Lokale broncontroller: Start stuurt direct en vervolgens elke 30 seconden; herhaald Start stapelt geen timers. Stop wacht lopende activiteit af en bevriest daarna de timestamp. Send once stuurt eenmalig, zonder een gestopte bron aan te zetten. Twee opdrachten in dezelfde milliseconde verzinnen geen nieuwere tijd. Cleanup wacht lopende activiteit af; late timercallbacks worden genegeerd.
- Iedere app-/device-initialisatie begint **gestopt**. Alleen de laatste werkelijk gegenereerde capability-timestamp blijft door Homey bewaard. Geen opgeslagen enabled-state. Running/stopped, tijd, interval, native lastSeen-resultaat en aantal geaccepteerde manual heartbeats staan in settings; Refresh status haalt de actuele stand op.
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

Deze stappen voert de gebruiker na eigen installatie van deze branch uit. De agent heeft geen live Homey benaderd. Gebruik uitsluitend de hieronder genoemde simulator. Laat bestaande productie-apparaten, integraties en Flows intact.

De settings-UI is inmiddels gepolijst; zie ook [de vervolgacceptatie](ui-polish-report.md#veilige-vervolgacceptatie). De bestaande testbron hoeft niet opnieuw gepaird te worden.

### Timestamp: volledige incident- en pushketen

1. Noteer SHS-versie en branchcommit. Installeer de bijgewerkte development-app via jullie bestaande werkwijze. De testbron is optioneel en wordt niet automatisch gepaird. De gebruikelijke app-restart herstart de observatiegrace van alle monitors; doe installatie dus op een bewust gekozen moment.
2. Homey **Devices → Add device → Data Pulse → Data Pulse Test Source (simulation)**. Voeg één apparaat toe. Laat de herkenbare simulatienaam staan. Een tweede pairing hoort geen extra testbron aan te bieden.
3. Open Data Pulse **Settings**, klik **Refresh status**. Inventarisatie haalt devices ongeveer eenmaal per minuut op; wacht indien nodig tot de testbron onder Data Pulse verschijnt. De lokale testsectie toont `stopped`, interval 30 s, timestamp nog onbekend. Er hoort geen nieuwe heartbeat te ontstaan zolang je niets start/verstuurt.
4. Maak uitsluitend op dit testdevice een enabled monitor met:
   - Freshness check: **Delivery timestamp** (`timestamp-capability`);
   - capability: **Last test heartbeat (`last_test_heartbeat`)**;
   - encoding: **ISO date with timezone**;
   - expected interval: **0.5 minuut**;
   - stale timeout: **3 minuten**;
   - optionele technische notitie onder Advanced: `Lokale simulatie schrijft elke 30 seconden een nieuwe ISO-timestamp zolang heartbeat running is; Stop bevriest deze waarde.`
5. Bewaar. Klik **Start heartbeat** in settings. Dit is dezelfde controlleractie als de Flow-actie **Start testupdates** (**Start test updates** in het Engels). Binnen een schedulerstap (normaal 10 s) hoort de monitor HEALTHY te worden; bij snapshotfallback kan dit tot ongeveer 60 s duren. Refresh na 30–60 s: `last generated` en `last delivery` lopen vooruit.
6. Klik **Stop**. Controleer `stopped`, noteer de laatste timestamp en controleer na 60–90 s dat deze exact gelijk blijft. Klik tijdens de stopfase niet op Send once.
7. Wacht gerekend vanaf de laatste levering ongeveer **3 minuten timeout + 1 minuut correlatievenster + maximaal 10 s schedulerstap**. Eerst kan SUSPECTED_STALE zichtbaar zijn, daarna DEVICE_STALE. Bij obserververlies/grace duurt dit langer: controleer dat observer `observing` is.
8. Verifieer één `device_stale` en één `any_incident_started`-dispatch voor deze simulator. Jullie bestaande pushflow op `any_incident_started` hoort de melding te ontvangen, voor zover bestaande filters de simulator toelaten. Controleer bron/device/incident-ID en `evidence_kind`. Pas de productieflow voor deze test niet aan; een bestaand uitsluitfilter is een verklaarbare beperking van de pushacceptatie.
9. Klik **Start heartbeat**. Controleer RECOVERING, daarna HEALTHY na **60 s stabiel herstel**, eventueel plus snapshot-/schedulervertraging. De reguliere `device_recovered` en `any_incident_recovered` horen éénmaal met hetzelfde incident-ID te verschijnen; controleer jullie bestaande recovery-pushflow. Geen nieuwe startmelding tijdens dit herstel.
10. Stop na het afronden van de test en schakel alleen de **testmonitor** uit om een volgende geplande stale-melding te voorkomen. Een enkele testmonitor veroorzaakt DEVICE_STALE, geen INTEGRATION_STALE (minimaal twee stale devices vereist).

De drie Flow-actions kunnen afzonderlijk worden geprobeerd via Homey's Flow-card testfunctie, indien beschikbaar, zonder bestaande Flows op te slaan/wijzigen. Ze hebben geen doelapparaatargument: alleen de gepairde eigen simulator kan geraakt worden. De settingsknoppen zijn het eenvoudige alternatief wanneer je geen Flow-editor wilt gebruiken.

### Manual op hetzelfde device

1. Laat de heartbeat gestopt en kies **Edit** op dezelfde testmonitor. Wijzig Freshness check naar **Explicit heartbeat** (`manual`), houd interval 0.5 min en timeout 3 min en vul desgewenst als technische notitie in: `Een gegenereerde lokale testheartbeat wordt via de bestaande geauthenticeerde heartbeatservice bevestigd.` Schakel enabled weer in en kies **Save changes**.
2. Controleer hetzelfde monitor-ID, precies één monitor voor dit device en nieuwe WARMING_UP. Dit kan via geauthenticeerd `GET /config` worden vergeleken; de UI zelf creëert geen nieuw ID bij Edit.
3. Klik **Send once**. `stopped` blijft staan, er is één nieuwe timestamp en bij een aanwezige enabled manual monitor hoort `Manual deliveries on last heartbeat: 1`. De monitor wordt HEALTHY. Een getal 0 betekent bijvoorbeeld dat de inventarisatie/monitor nog niet gereed is; refresh en herhaal met een echt later tijdstip.
4. Gebruik Start/Stop/Start en stappen 5–10 hierboven voor dezelfde stale/recovery- en pushketen. De API `/heartbeat/:id` en bestaande `record_heartbeat`-actie blijven ongewijzigd geauthenticeerd en beschikbaar; de testbron dupliceert hun evaluatielogica niet.

### Device-last-seen: native SHS-semantiek bevestigen

1. Stop de testheartbeat en edit dezelfde testmonitor naar **Device activity** (`device-last-seen`). Optionele technische notitie: `Alleen een gegenereerde lokale testheartbeat meldt het eigen virtuele device actief via Device.setLastSeenAt(); Homey levert lastSeenAt.` Sla enabled op.
2. Start. Controleer `Native lastSeenAt: sent`. Kijk bij de monitor naar **last delivery**: bij deze strategie komt deze tijd uitsluitend uit de echte Homey API `lastSeenAt`. De snapshot wordt circa iedere 60 s opgehaald, dus deze regel loopt niet noodzakelijk elke 30 s mee. Hij moet binnen circa 60–70 s vooruitgaan en HEALTHY opleveren.
3. Stop. Na maximaal één nog in te lezen snapshot moet **last delivery** exact blijven staan. De timestamp-capability moet ook stilstaan. Wacht vervolgens de volledige staleperiode af en voer Start/recovery zoals hierboven uit.
4. Noteer SHS-versie, laatste native aanroep, geobserveerde last-delivery-tijden en incident/recovery-resultaat. Bij `unavailable`/`failed`, ontbrekende/vaste lastSeen tijdens running, of doorlopende lastSeen tijdens stopped: **niet geslaagd voor de derde strategie**. Gebruik manual/timestamp, leg de platformuitkomst vast, en laat echte productiebronnen ongemoeid. Zonder deze live bevestiging claimen we geen bewezen SHS-end-to-end voor lastSeen.

### Edit, cancel, restart en cleanup

- Edit de testmonitor, wijzig timeout naar 4 minuten, klik Cancel. Geen configwrite, oorspronkelijke timeout blijft 3 minuten. Edit opnieuw en Save changes: dezelfde ID, geen duplicaat, nieuwe grace. Test naar wens ook encoding/capability en enabled; herstel daarna de correcte testconfig voordat je bewijs verwacht. Een onjuiste capability geeft MISSING en is geen herstel.
- Een wijziging van alleen de technische notitie (`sourceContract`) behoudt runtime en incident/herstelvoortgang zonder nieuwe grace. Metadata-only wijzigingen behouden in-process compatibele runtime; automatische namen/zoneverversing verandert geen detectie. Coretests controleren ook dat een edit van monitor A monitor B niet herstart.
- Na een door jullie bewust gekozen latere app-restart moet de testbron **stopped** zijn, met de laatste werkelijk opgeslagen timestamp en zonder nieuwe activiteit/timer. Restart zelf is geen heartbeat. De watchdog gebruikt de bestaande restartgrace. Dit is een aparte lifecyclecontrole; een app-restart is niet nodig om een productiebron stale te maken.
- Verwijder eventueel alleen het testdevice. Timers en registratie worden opgeruimd; de behouden testmonitor wordt bij de volgende snapshot MISSING, zonder fictieve recovery. Verwijder daarna desgewenst alleen de testmonitor. Een opnieuw toegevoegd testdevice kan een nieuwe Homey device-ID hebben en vraagt dan een nieuwe bewuste monitorselectie.

## Offline validatie

De volledige suite bevat de 35 bestaande tests plus nieuwe tests voor UI-edit/save/cancel en savefouten; ID-behoud; detectievelden/reset en metadata/recoverybehoud; listenerhergebruik; start/stop/send; stilstaande timestamps; restart, late callbacks en cleanup; falende/ontbrekende native methode; identiteitsafscherming; en de echte service/adapter/core/Flow-dispatchketen voor elke strategie. SDK- en Flow-grenzen zijn mocks; er wordt geen echte push ontvangen in deze tests.

Zie [opleverrapport van deze uitbreiding](self-test-report.md) voor de exacte aantallen en gate-resultaten. Dependencies en lockfile zijn ongewijzigd. De externe heartbeat-uitbreidingspoort is intact.
