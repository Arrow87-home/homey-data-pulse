# Settings UX, validation and compatibility polish

18 september 2026 — dezelfde branch `codex/watchdog-v0.1` en draft PR #1. Geen merge, geen live Homey benaderd of geïnstalleerd. De bestaande testbron kan blijven staan. Engine-evaluatie, detectors, simulator, timers, heartbeatservice, API-routes en Flow-dispatch zijn niet herschreven.

## Oorzaak van het Add-probleem

De code van de vorige commit `96a074d` is lokaal opnieuw uitgevoerd voor schema-validatie. De oude multiselect gebruikte alleen `selectedOptions`; het zichtbaar zijn van de ene capability betekende niet dat deze geselecteerd was. De UI selecteerde niets automatisch. Daarnaast eiste het oude schema **minimaal tien tekens** in `sourceContract`.

| Gereproduceerde aanvraag aan het oude schema                                           | Werkelijke afwijzing                                                              |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Lege notitie, geen capability geselecteerd                                             | `monitors[0].sourceContract` én `monitors[0].strategy.capabilities`               |
| Notitie van minstens tien tekens ingevuld, nog geen capability geselecteerd            | Alleen `monitors[0].strategy.capabilities`: array moet minstens één item bevatten |
| Geldige notitie én `last_test_heartbeat` geselecteerd; interval 0.5 min, timeout 3 min | Geaccepteerd                                                                      |
| Capability geselecteerd, maar notitie slechts `test`                                   | `sourceContract`: minder dan tien tekens                                          |

Dit verklaart het beschreven patroon: alleen de notitie invullen kon de tweede validatiefout niet oplossen. Stoppen van de simulator voorkomt toevoegen niet; een ontbrekende eerste timestamp wordt door de engine opgevangen met WARMING_UP. Het device kan dus veilig gestopt blijven tijdens configuratie.

**Grens van de conclusie:** de oorspronkelijke live POST/PUT-payload en foutresponse zijn niet aangeleverd. Daarom is niet bewijsbaar welke tweede fout precies in die live klik aanwezig was. Een lege capabilityselectie is de lokaal aangetoonde verklaring voor het genoemde pad; een ingevulde maar te korte notitie of ongeldige timing kan dezelfde indruk hebben gegeven. Dit rapport claimt geen uitgelezen live logs. De oude fout werd alleen in `#message` bovenaan gezet, zonder focus, scroll of inline veldmelding; daardoor kon deze buiten de viewport blijven.

De regressietest voert nu het concrete pad uit: timestamp uitvinken → Add → zichtbare capabilityfout en geen write → notitie invullen → nog steeds duidelijke capabilityfout → capability aanvinken → opslaan en zichtbare monitor. De normale route met één automatisch aangevinkte capability en lege notitie slaagt direct.

## UX en validatie

- Compacte monitorkaarten met integratie/device, statusbadge, menselijk methodenaam, laatste levering en timeout; ID's, exacte ISO-tijd, strategy/evidence-kind en notitie onder Technical details.
- Formulier: Integration → Device → How should freshness be checked? → Timing → Advanced. Bron en device blijven bij Edit vast. Save changes behoudt ID; Cancel schrijft niets; remove/enable/disable zijn geblokkeerd tijdens edit. Savefouten bewaren het concept.
- Radiokeuzes Device activity / Delivery timestamp / Explicit heartbeat; interne waarden blijven `device-last-seen`, `timestamp-capability`, `manual`. Alleen Delivery timestamp toont timestampvelden en encoding.
- Expliciete checkboxen met prominente titel en secundaire technische ID. Ondersteunde waardetypen: string/number, plus onbekend type voor oudere inventarisvormen. Bij één veld wordt het vooraf aangevinkt; bij meerdere kiest de gebruiker zelf. Een opgeslagen capability-array wordt exact overgenomen, inclusief tijdelijk ontbrekende velden. Boolean/enumvelden worden niet als nieuwe timestampkeuze aangeboden.
- De UI kan de betekenis van een willekeurig numeriek/stringveld niet bewijzen. De helpertekst vraagt expliciet om een echte levertijd, geen meting; typecompatibiliteit is geen garantie van versheid. Geen detector/businesslogica is hiervoor gewijzigd.
- Clientvalidatie vóór PUT: device/source, dubbele devicekeuze, strategy, 1–16 timestampvelden, encoding, positieve timing in gehele milliseconden, maximaal één jaar, timeout ≥ interval, en voor geobserveerde strategieën de bestaande minimumtimeout van 2 minuten. Interval 0.5 minuut blijft geldig. Schema/service blijven de serverveiligheidslaag.
- Fouten staan bij het veld én de actie, met focus/scroll naar het eerste probleem. Correctie wist opgeloste veldfouten. Zod-issues en bekende backendfouten worden vertaald naar begrijpelijke Engelse UI-copy; onbekende fouten geven een zichtbare retrymelding met behoud van concept en ruwe details onder Error details.
- Een bevestigde PUT wordt direct in de monitorlijst verwerkt. Als alleen het daaropvolgende ophalen van status faalt, meldt de UI **Monitor saved** plus de verversingsfout; dit wordt niet ten onrechte als mislukte save voorgesteld.
- Self-test is een eigen kaart: RUNNING/STOPPED, interval en tijd; native lastSeen/manual-aantallen onder Technical details. Zonder pairing alleen uitleg, geen nutteloze knoppen. Acties blijven exact dezelfde bestaande endpoints/controller gebruiken.
- Observerstatus is leesbaar (Connected, dispatch failures, restore, integraties); volledige JSON blijft onder Diagnostics. Status verversen blijft handmatig en voegt geen UI-pollingtimers toe.
- Lichtgewicht HTML/CSS/JS, semantisch formulier met labels, fieldsets, live feedback, toetsenbordfocus, flexibele mobiele layout en lichte/donkere kleuren. Geen framework of dependency toegevoegd. Dynamische copy is gecentraliseerd; volledige Homey-i18n is nog niet ingevoerd. UI blijft consequent Engels.

## Technische notitie en backwards compatibility

`sourceContract` accepteert leeg en ontbrekend (default `''`), behoudt bestaande tekst en de bovengrens van 2000 tekens. De API-veldnaam en configuratieversie blijven gelijk. In de UI heet het **Technical note (optional)** onder Advanced.

De notitie is verwijderd uit `detectionFingerprint` en dus uit de bestaande per-monitor fingerprint. Notitie-only edits behouden exact runtime, grace, incident-ID en device/integration-herstelvoortgang. Strategie, capability-array, encoding, interval, timeout, enabled en identiteiten blijven detectierelevant.

Oude snapshots worden niet ineens incompatibel: de leescompatibiliteit verwijdert uitsluitend het voormalige `sourceContract`-veld uit een oude per-monitor fingerprint en vergelijkt vervolgens alle resterende inhoud exact. Onbekende extra velden, andere detectieregels of malformed fingerprints worden niet geaccepteerd. Nieuwe snapshots schrijven de huidige fingerprint. Bestaande manual-, lastSeen- en timestampconfiguraties inclusief capability-arrays zijn getest. De normale restartgrace blijft bewust intact: snapshotcompatibiliteit behoudt incidentidentiteit, maar een app-restart adverteert geen oud HEALTHY of oude herstelstabiliteit als nieuwe observatie.

## driverId en driverUri

De geïnstalleerde officiële `homey-api@3.20.0` bevat in `HomeyAPIV3/ManagerDevices/Device.js` een `driverUri`-getter die een deprecationwarning geeft en altijd `undefined` retourneert. Dat is geen bruikbare compatibilitybron.

`identifySource()` herkent nu gekwalificeerde `driverId`-vormen voor apps én ingebouwde managers. Op die route wordt `driverUri` niet bekeken. Alleen zonder gekwalificeerde ID wordt een **eigen data-property** met legacy `driverUri` gelezen via zijn descriptor. Accessors worden nooit uitgevoerd. Zo behouden oudere gewone API-records hun fallback zonder de moderne warninggetter te activeren. Korte lokale driver-ID's gebruiken owneridentiteit, met conflictcontrole wanneer echte legacy data aanwezig is. Owner/driver-conflicten blijven unresolved.

Test-sourceherkenning gebruikt de opgeloste bronidentiteit, vaste pairingdata en volledige of lokale driver-ID; geen tweede `driverUri`-lezing. Tests dekken representatieve Plugwise/MQTT/Tibber-appidentiteiten, built-in managers, lokale ID's, ontbrekende ID, legacy fallback, conflicten en de simulator met een getter die bij toegang direct zou falen.

## Geraakte onderdelen en controles

Productiecode: `settings/index.html`, `settings/settings.js`, nieuwe `settings/settings.css`; `src/core/model.ts` (optionele notitie/fingerprint), `src/core/engine.ts` (alleen aanroep van fingerprintcompatibiliteit bij restore), `src/homey/inventory.ts`. Tests: `test/settings.test.ts`, `test/editing.test.ts`, nieuw `test/compatibility.test.ts`. README, architectuur en self-testinstructies zijn bijgewerkt. Geen dependency-, lockfile-, API-route-, simulator- of Flow-wijzigingen.

| Controle                                          | Resultaat                          |
| ------------------------------------------------- | ---------------------------------- |
| Volledige suite op Node 24                        | 85/85 geslaagd                     |
| Volledige suite + test-TypeScriptcheck op Node 22 | 85/85 geslaagd                     |
| `npm run lint`                                    | Geslaagd, 0 warnings               |
| `npm run build`                                   | Geslaagd                           |
| `npm run format:check`                            | Geslaagd                           |
| `npm run validate`                                | Homey CLI debug-validatie geslaagd |
| `npm run check`                                   | Geslaagd                           |
| `git diff --check`                                | Geslaagd                           |

De eerdere 62 tests zijn behouden of logisch aangepast: de oude verwachting dat een notitie-edit runtime reset is vervangen door expliciet behoud; de drie UI-tests gebruiken de nieuwe bediening; metadata/recoverytests blijven bestaan en zijn uitgebreid. Netto 23 extra tests, met behoud van stale/recovery, alle strategieën, simulator, lifecycle/timercleanup en Flow-dispatch.

**Weergavebeperking:** de echte JS-buttonhandlers zijn lokaal getest met een DOM-boundary, maar er is geen visuele browser-/Homey-webviewacceptatie uitgevoerd. De beschikbare Playwright-tooling had geen browserbinary; de download liep op netwerk-timeouts en is gestopt. Mobiele/webview-layout, native Homey-errorserialisatie en focus/scroll in het Homey-settingsframe moeten dus nog in onderstaande handmatige acceptatie worden bevestigd. Dit is geen App Store-publicatiegoedkeuring.

## Veilige vervolgacceptatie

1. Installeer zelf de bijgewerkte branch via jullie bestaande developmentwerkwijze op een gekozen moment. De normale app-restart herstart observatiegrace; de simulator begint gestopt. **Pair niet opnieuw:** gebruik de bestaande Data Watchdog Test Source (simulation).
2. Heropen settings. Gebruik Refresh status; inventarisatie kan circa een minuut achterlopen. Controleer monitorkaarten, Connected, self-test STOPPED en de bestaande productieconfiguratie zonder deze te wijzigen.
3. Als de simulator nog geen monitor heeft: kies Data Watchdog en het testdevice. Kies **Delivery timestamp**, controleer het aangevinkte **Last test heartbeat** (`last_test_heartbeat`) en ISO. Vul expected **0.5 min**, consider stale after **3 min** in. Laat Advanced/notitie leeg. Add monitor moet een zichtbare kaart opleveren. Bestaat de testmonitor al, gebruik **Edit** om duplicatie te vermijden.
4. Controleer desgewenst eerst validatie: vink de timestamp uit en klik Add/Save → inline fout + focus + geen write. Alleen een notitie typen lost die fout niet op. Vink opnieuw aan → fout verdwijnt. Zet timeout lager dan interval → timingfout. Herstel de waarden en sla op.
5. Start heartbeat → HEALTHY (normaal binnen 10 s, snapshotfallback tot circa 60 s). Open daarna Edit, wijzig uitsluitend Technical note, Save changes → geen nieuwe WARMING_UP, zelfde monitor-ID onder Technical details. Edit opnieuw en Cancel → geen wijziging. Controleer dat destructive knoppen tijdens Edit uitgeschakeld zijn.
6. Stop → timestamp blijft staan. Na circa **3 min timeout + 1 min correlatievenster + maximaal 10 s schedulerstap**: DEVICE_STALE en de bestaande `any_incident_started`-pushketen. Start → RECOVERING en na 60 s stabiel herstel HEALTHY + `any_incident_recovered`, met dezelfde incident-ID. Dit gebruikt uitsluitend het testdevice en bestaande Flows.
7. Test dezelfde monitor via Edit achtereenvolgens met **Explicit heartbeat** en **Device activity**. Timestampvelden moeten verdwijnen. Noteer dat een strategiewijziging wél nieuwe grace geeft. Native lastSeen-validatie blijft zoals beschreven in [self-test.md](self-test.md): bij running vooruitlopen via de echte API, bij stopped stilstaan; geen live garantie uit offline tests afleiden.
8. Controleer alleen de logs van jullie eigen testinstallatie op afwezigheid van de herhaalde `Device.driverUri`-warning. Controleer settings ook op mobiel: geen horizontale overflow, knoppen bereikbaar, foutfocus zichtbaar. Bij een backendfout blijft het concept staan en is feedback bij Save zichtbaar.
9. Rond af door alleen de **testmonitor** uit te schakelen en de simulator te stoppen. Wijzig geen productie-Flows, apparaten of externe integraties.
