# Training Log

Mobiele web-app om je trainingen te loggen in je eigen Google Sheet (OPEX-planning).
Geen server, geen build: statische bestanden. Je data gaat alleen tussen je browser en Google.

## Wat doet hij

- **Koppelt je Google Sheet** (plak de link, kies het tabblad). Kolommen worden op *kopnaam* herkend
  (`Cycle · Week · Dag · Focus · Piece · Prescribed · Intent/target · Demo link · Actual · Rep splits · RPE · Bad day · Pain notes · Notes`),
  dus kolomvolgorde maakt niet uit. De cyclus uit de `Cycle`-kolom staat boven de weekkiezer.
- **Dag per dag**: weekkiezer + Ma–Zo. Dagen zonder rijen (zoals maandag) tonen als **Rustdag**. Vr/Zo-"Optioneel" krijgt een badge.
- **Per onderdeel de juiste velden**: warm-up/mobility = één knop *Gedaan* (+ pijn/notitie), WOD = score + rep splits, kracht = gewicht + RPE (splits optioneel), cardio = afstand/tijd. Daarnaast steeds: RPE, slechte dag, pijn/knie, "dag erna" (voor knie-/schouderstukken) en notities.
- **Schrijft naar de juiste cellen** en zet erbij:

  | Kolom (door de app toegevoegd rechts van Notes) | Inhoud |
  |---|---|
  | `Gelogd op` | tijdstip van loggen (`2026-10-26 18:42`) |
  | `Start` / `Einde` / `Duur (min)` | optioneel, per onderdeel |
  | `Sessie start` / `Sessie einde` | optioneel, op alle rijen van die trainingsdag |

- **Timers (optioneel)**: *Start training* voor de hele sessie (die start ook meteen de timer van het eerste onderdeel) en een ⏱ per onderdeel (warm-up, oefening, WOD). Tik op de timer om te **pauzeren** (▶ hervat, de tijd blijft staan; een tik zet nooit terug op nul). **Opslaan** stopt de timer en bewaart start, einde en duur; daarna start de timer van het volgende onderdeel automatisch (uit te zetten in ⚙). Een gelogd onderdeel toont zijn duur, geen startknop meer. Nul zetten kan bewust via *Tijd → Timer op nul zetten*. Tijden achteraf invullen kan ook.
- **Werkt in de gym zonder bereik**: wijzigingen komen in een wachtrij en worden verstuurd zodra je weer verbinding hebt. Het plan blijft offline zichtbaar, en half ingevulde formulieren blijven bewaard.
- **Veilig voor je sheet**: bestaande cellen die jij of de coach tussendoor in de sheet aanpaste worden niet stilletjes overschreven (de app vraagt eerst). Rijen worden bij elk schrijven opnieuw opgezocht op Week + Dag + Piece, dus ingevoegde rijen geven geen verschuiving.

## Sheet-contract v2 (één bestand, een tabblad per cyclus)

Je houdt **één Google Sheet "Training Log"**. Elke cyclus is een eigen tabblad **"Cycle N"** (kopregel in rij 1, geen lege rijen). De app opent standaard het nieuwste cyclus-tabblad en heeft bovenaan een keuzelijst om terug te kijken. Elk tabblad heeft een eigen startdatum (⚙).

Kolommen, op **kopnaam** herkend (volgorde mag afwijken):

`Cycle · Week · Dag · Focus · Piece · Benchmark · Prescribed · Intent/target · Demo link` (coach) ·
`Actual · Rep splits · RPE · Bad day · Pain notes · Notes` (jij, via de app) ·
`Gelogd op · Start · Einde · Duur (min) · Sessie start · Sessie einde` (door de app toegevoegd)

**Benchmark** is een vaste sleutel voor testen en benchmarks, exact zoals in je PR Ledger: `Back Squat 3RM`, `Deadlift 1RM`, `Row 500 m`, `Row 2 km`, `Fran`, `Grace`. Zo weet de app welke vorige score erbij hoort. Leeg laten voor gewone onderdelen. Voor benchmark-namen (Fran, Grace, …) werkt het ook zonder, op basis van de naam in `Piece`.

`Cycle` is het cyclusnummer op elke rij; `Dag` is Ma/Di/Wo/Do/Vr/Za/Zo; een rustdag heeft geen rijen. Een oud tabblad dat afwijkt werkt gewoon door (kleine, wegklikbare melding). Dezelfde afspraak staat in de projectinstructies (v3.1).

## Records en vorige keer

Koppel je **PR Ledger** (⚙ → "Link naar je PR Ledger"). Het bestand moet de tabbladen `PR Ledger`, `Benchmark Tracker - Summary` en `Benchmark Tracker - History` hebben. De app leest ze alleen, hij schrijft er nooit in.

- **Records-pagina**: alle lifts, tests en benchmarks met huidige waarde, datum en leeftijd. Zoeken kan, en het filter *Retest-kandidaten* toont wat weinig betrouwbaar is. Tik een record open voor huidig/geschat/all-time, de redenen achter de betrouwbaarheid en de historiek (ledger + je eigen cyclus-tabbladen).
- **Vorige keer** op een onderdeel (Benchmark-sleutel of naam): laatste resultaat, datum, RPE en of het een goede of slechte dag was, plus je PB.
  *Goede dag* = ≥ 98% van je PB, *redelijk* = 93–98%, *zwakker* = < 93%. Heb je "Slechte dag = Ja" aangeduid, dan telt het als slechte dag en als ondergrens.
- **Betrouwbaarheid (%)** is een indicatie, geen statistiek: start op 100, min 3,5 punt per maand boven de 6 maanden geldigheid, min bij enkel een schatting of all-time waarde, min bij noten als "conditions-limited", plus bij meerdere metingen of een recente bevestiging in training.

## Eenmalig instellen (±5 min)

De app logt in met jouw Google-account. Daarvoor heb je een gratis **client-ID** nodig:

1. [console.cloud.google.com](https://console.cloud.google.com) → nieuw project → *APIs & Services* → **Google Sheets API** inschakelen.
2. *OAuth consent screen*: type **Extern**, naam "Training Log", status **Testing**, voeg **je eigen Google-account** toe als testgebruiker. Scope: `.../auth/spreadsheets`.
3. *Credentials* → **Create credentials → OAuth client ID → Web application**.
   Bij *Authorised JavaScript origins* zet je het adres waar de app draait, bv. `https://<jouw-gebruikersnaam>.github.io` (en `http://localhost:8080` om lokaal te testen).
4. Kopieer de client-ID. Plak hem in de app bij de eerste start, of zet hem in `config.js`.

Google toont bij het inloggen "app niet geverifieerd": dat is normaal voor je eigen app. Kies *Geavanceerd → doorgaan*.

## Hosten

Het makkelijkst via **GitHub Pages**: zet deze map in een repo, *Settings → Pages → Deploy from branch*. Daarna op je telefoon/iPad openen en *Zet op beginscherm* kiezen.
Lokaal proberen: `python3 -m http.server 8080` en open `http://localhost:8080`.

## Gebruik

1. Eerste start: client-ID + sheet-link → **Verbinden met Google** → tabblad kiezen → **Maandag van week 1** (per tabblad) invullen (zodat "vandaag" automatisch opent) → Opslaan.
2. Tik een onderdeel open, vul in, **Opslaan**. Onderdeel overgeslagen? **Skip**.
3. Nieuwe cyclus: Claude voegt een tabblad "Cycle N" toe in dezelfde sheet. De app opent het automatisch; vul in ⚙ de startdatum (maandag van week 1) voor dat tabblad in.
4. Records: tab *Records* bovenaan, na het koppelen van je ledger.

## Goed om te weten

- Het sheet-token verloopt na ±1 uur. Bij het opslaan vernieuwt de app het stilletjes; lukt dat niet, dan staat je invoer veilig in de wachtrij en tik je op **Inloggen**.
- Waarden worden als tekst geschreven (`RAW`), zodat Google "8-9" niet als datum omzet.
- iOS: als inloggen in de beginscherm-app niet terugkeert, open de app dan eens in een gewoon Safari-tabblad.
- Rijen met een onbekende dag-afkorting (geen Ma/Di/Wo/Do/Vr/Za/Zo) worden niet getoond.

## Ontwikkelen / testen

```
node --test tests/sheet.test.mjs tests/records.test.mjs   # logica (parsen, celplanning, records, oordeel, betrouwbaarheid)
node tests/e2e.cjs                 # echte browser + gemockte Google/Sheets-API
node tests/e2e2.cjs                # tabs per cyclus, Records, vorige keer
```
Bestanden: `js/sheet.js` (pure logica) · `js/records.js` (ledger, oordeel, betrouwbaarheid) · `js/api.js` (Google-login + Sheets) · `js/app.js` (UI) · `sw.js` (offline shell).

## Gewichten uitrekenen
Staat in "Prescribed" of "Intent/target" iets als `3x3 @ 90% van wk 1 triple`, dan zoekt de app hetzelfde onderdeel in week 1 van dit tabblad, neemt het zwaarste gelogde gewicht, rekent het percentage uit, rondt af op 1 kg en toont de plaatjes per kant (voor stangoefeningen). De stang (20 of 15 kg) stel je in via ⚙. Regels:
- Alleen met een weekverwijzing (`wk 1`, `week 1`). `-10%` (t.o.v. je top van vandaag) en `@168kg (80%)` (kg staat er al) worden genegeerd.
- Is die week niet gelogd, dan zie je een melding in plaats van een gewicht.
- Beschikbare plaatjes: 25, 20, 15, 10, 5, 2,5, 2, 1,5, 1,25, 1 en 0,5 kg (aanpasbaar in `js/loading.js`).

Ook bij vaste gewichten (`@ 95 kg`, `(120-125 kg)`) en bij ramps (`60×5, 80×3, 100×2`) toont de app voor stangoefeningen de plaatjes per kant. `+20 kg` (extra gewicht), `van 160 kg` (basis) en oefeningen met dumbbell/kettlebell (Bulgarian split squat, goblet, lunge) worden overgeslagen.

## Coach (optioneel)
Zonder sleutel werkt de app volledig. Twee niveaus:

- **Zonder sleutel**: *Deel met coach* (Coach-tab of onderaan een dag) kopieert je sessie/week als tekst (op mobiel opent het deelmenu); plak het in je coach-project. *🏋 Opbouw* bij een barbell-oefening met een streefgewicht toont een opbouwreeks met plaatjes per kant.
- **Met eigen Anthropic API-sleutel** (⚙ → Coach): automatische coach-reactie na een afgeronde sessie, chat met geschiedenis, *💬 Vraag coach* per oefening, weekoverzicht + geheugenvoorstel, profiel, kostenteller en eigen maandlimiet.

Sleutel: maak er een in console.anthropic.com → API keys, laad tegoed op en stel een maandlimiet in. De sleutel blijft in de browser van dit toestel en gaat alleen naar api.anthropic.com. Het geheugen staat in je eigen workbook (tabs `Coach profiel` en `Coach geheugen`, worden door de app aangemaakt); de coach doet voorstellen en past nooit zelf iets aan in je planning.
Fouten (tegoed op, ongeldige sleutel, snelheidslimiet, overbelast, offline, eigen limiet) tonen een banner met uitleg; de coachknoppen worden dan grijs, loggen en records blijven werken.

### Foto's, video en voorstellen
- **📎 Foto of video** (Coach-tab): foto's worden verkleind (max 1024 px), een video wordt in de browser omgezet naar 8 frames (768 px) met tijdstip. Niets verlaat je toestel tot je op Stuur tikt. De coach ziet posities, geen snelheid; dat zegt hij erbij. Beelden zitten alleen bij de vraag zelf, niet in de chatgeschiedenis (houdt kosten laag).
- **Voorstellen**: de coach kan een nieuw plan (kolom Prescribed) voorstellen voor een onderdeel dat nog niet gelogd is. Jij tikt Toepassen of Weigeren. Bij Toepassen leest de app eerst de sheet opnieuw: is het plan intussen veranderd of al gelogd, dan gebeurt er niets. *Ongedaan maken* zet de oude tekst terug zolang niemand het plan daarna wijzigde. De app schrijft nooit in de resultaatkolommen.
- **Prompt caching** staat aan op de vaste coachcontext: opeenvolgende vragen binnen ±5 minuten kosten minder (gecachete invoer kost 10%). De kostenteller rekent dat mee.

### Coach log
Elke coach-reactie, elk weekoverzicht en elke toegepaste of teruggedraaide planwijziging komt als rij in het tabblad **Coach log** van je workbook (Datum, Soort, Over, Vraag, Antwoord, Voorstellen, Model). Je Claude-project kan die tab lezen, zodat wat in de app besproken is ook daar terug te vinden is. Offline of niet ingelogd: de rijen wachten op het toestel en worden later weggeschreven. Uit te zetten in ⚙ → Coach. De losse chatvragen worden niet gelogd.


### Bevestiging bij elke coach-aanvraag
Elke aanvraag aan de coach (reactie op de training, weekoverzicht, vraag) toont eerst een korte uitleg met aantal aanvragen en model. Pas na **Verstuur** gaat er iets naar de API; **Annuleer** verstuurt niets. Ook de automatische reactie na een afgeronde sessie vraagt eerst bevestiging.


## Interval-timer (EMOM, AMRAP, For Time, werk/rust, rust na een set)
Elk onderdeel heeft een knop **⏲** (bv. "⏲ EMOM 10'"). De app leest de timer uit *Prescribed* (formaat: zie de projectinstructies, "Timer notation"); lukt dat niet, dan stel je hem met een paar velden zelf in.
- Je start altijd zelf. Daarna loopt eerst 10 seconden af, met pieptonen in de laatste 3.
- Signaal 10 seconden voor het einde van elk interval en een ander signaal bij het begin van het volgende. Bij For Time klinkt een signaal bij het target en een eindsignaal bij de time cap.
- Fasebalk groen (werk) / rood (rust); bij een EMOM staat de beweging van het huidige interval op het scherm. Portrait en landscape.
- AMRAP: **+1 ronde** (en −1). Na afloop kun je rondes en extra reps nog aanpassen. For Time: **Klaar** geeft de eindtijd, ook aanpasbaar.
- Stop of einde: **Bewaar in Actual** zet het resultaat in je logveld (jij tikt daarna zelf op Opslaan).
- Onderdelen met "rust 2'30": tik **✓ Set klaar** en de rust start automatisch (teller 2/5).
- In ⚙ Interval-timer: geluid, volume, schermflits. Het scherm blijft aan (Wake Lock) zolang de timer loopt. Een lopende timer overleeft een herstart van de app; geluid moet je dan opnieuw aanzetten met één tik.
- **Losse timer:** tik op ⏲ bovenaan (naast ↻). Je stelt type en duur in, zonder onderdeel en zonder iets in je log te schrijven. Handig om te testen of voor je klassen.
- **Vergrendelen:** 🔓 onderaan blokkeert Pauze, Stop en Klaar tegen per ongeluk aanraken (+1 ronde blijft werken). Ontgrendelen doe je door de knop 1 seconde ingedrukt te houden.
- Op iOS kan geluid stoppen als het toestel vergrendelt of de app naar de achtergrond gaat; test dit eenmalig met een timer van 10 minuten. Zonder geluid op het lockscreen of met een andere app vooraan: houd de app open op het scherm (het scherm blijft vanzelf aan).


## Ronde 2 (v5.0)
- **Vorige keer** bij elk onderdeel: de app zoekt de laatste eerdere keer met dezelfde bewegingsnaam (sets, reps en minuten tellen niet mee), ook uit vorige cycli. Bij onderdelen met een record blijft de recordvergelijking staan.
- **Gepland tegenover echt**: de geplande minuten staan in de Piece-naam, de echte tijd komt uit je sessietijden (of de som van de onderdeel-duur). Groen binnen 10%, oranje tot 25% erover, rood daarboven.
- **Pijncheck de dag erna**: na een sessie met pijnmelding of kniebelastende bewegingen (squat, lunge, spring, loop, box, thruster, wall ball, burpee) vraagt de app de dag erna (tot 2 dagen later) "Hoe voelt het vandaag?". Het antwoord komt als "Dag erna: Knie 2/10" in Pain notes van het laatste onderdeel van die sessie. Je kunt overslaan.
- **Week** (nieuw tabblad): sessies, onderdelen, tijd, gemiddelde RPE, indicatief volume en dagen met pijn of een slechte dag. Tik op een dag om er naartoe te gaan.
- **Trends** (in Records): geschatte 1RM per lift (Brzycki, beste set per sessie) en sessies plus gemiddelde RPE per week.


## Ronde 3 (v6.0)
- **Readiness-check**: op de dag van vandaag, voor je iets logt, vraagt de app slaap, spierpijn en stress (3 tikken, overslaan kan). Het komt als tekst op elke rij van die dag in een kolom **Readiness**, die de app pas toevoegt als je hem voor het eerst gebruikt. De coach in de app leest het mee.
- **Extra sessie of les** (knop bovenaan elke dag): titel, resultaat, RPE en duur. De app voegt een rij toe met Focus "Extra" en Piece "Les: titel". Kies je een gepland onderdeel dat het vervangt, dan krijgt dat "Vervangen door les".
- **Gym-modus** (knop bovenaan elke dag): groot onderdeel met doel, plaatjes per kant, vorige keer en de timerknoppen. Vorige en Volgende bladeren door de sessie, Loggen brengt je naar het invulveld. Het scherm blijft aan.
- **Coach-bevestiging** toont nu een schatting van de tokens en de kost. Losse vragen zonder beeld gaan standaard naar Haiku (uit te zetten in ⚙ Coach); vragen met foto of video, reacties en weekoverzicht gebruiken je gekozen model.
- **CSV-back-up**: ⚙ → "Logboek van dit tabblad exporteren (CSV)". Puntkomma-gescheiden, opent goed in Excel.
- **Eerste keer**: de instellingen tonen nu 3 stappen bovenaan. Een Engelse interface is niet gebouwd.


## Polar (v7.0 en v7.1, optioneel)
- Zonder Worker-adres en code in ⚙ → Polar verandert er niets. Eerst de Worker uitrollen (zie `polar-worker-v1.zip`).
- Op een dag (vandaag of eerder) komt een knop **⌚ Polar-gegevens ophalen**. De app vraagt je Worker om het herstel van die ochtend (Nightly Recharge, ANS charge, HRV, slaapscore) en kiest de training die overlapt met je sessietijden (±10 min). Zonder sessietijden pakt hij de langste training van die dag.
- Het resultaat komt als één tekst op elke rij van die dag, in een kolom **Polar** (pas toegevoegd bij het eerste gebruik), bv. `Recharge 5/6 · ANS -0,4 · HRV 71 · Slaap 81 (7u04) · Training gem HR 142, max 171, load 38,4`. De coach in de app leest het mee.
- Staat de training er nog niet: sync je horloge met Polar Flow en tik **↻**. Het herstel wordt dan meteen bewaard, de training volgt bij de volgende keer.
- RPE uit Polar komt alleen mee als die al op het horloge is ingevuld vóór de eerste sync; je eigen RPE in de app blijft de bron.
- De toegangscode blijft op dit toestel en gaat enkel als header naar je eigen Worker.

### v7.1: automatisch en herstelkaart
- **Automatisch ophalen**: na elke geslaagde sync (max. 1× per 3 min) haalt de app het herstel van vandaag op en bewaart het in de kolom Polar, zonder tikken. Is er al een sessie afgerond, dan koppelt hij ook de training zodra Polar die heeft.
- **Na het einde van een training** probeert de app het nog 3× (na 1,5, 4 en 8 minuten), omdat het horloge even nodig heeft om naar Polar Flow te synchroniseren. Is de app dan dicht, dan gebeurt het bij de volgende keer openen.
- **Herstelkaart** bovenaan vandaag. Bij normaal herstel dat al bewaard is verschijnt er niets. Is Recharge ≤3, de ANS ver onder je norm of de slaapscore onder 50, dan toont de kaart oranje met een zachte hint ("overweeg lager volume of een lager RPE-doel"), zolang je nog niets gelogd hebt. Het plan zelf verandert niet; jij beslist.
- De knop ⌚/↻ blijft bestaan voor handmatig bijwerken.

### v7.2: slaap uit Polar
- Is Polar ingesteld en is er slaapdata van deze nacht, dan vraagt de readiness-check de slaap niet meer: de app zet hem zelf (slaapscore ≥70 = Goed, 50–69 = Ok, <50 = Slecht) en toont "Goed (Polar 81)". Je beantwoordt alleen nog spierpijn en stress.
- Ontbreekt de slaapdata (horloge niet gedragen, nog niet gesynct), dan blijft de slaapvraag gewoon staan.
- Spierpijn en stress blijven je eigen antwoord: Polar meet die niet direct.

### v7.3: duidelijkere herstelkaart met kleur
- De kaart bovenaan vandaag is nu altijd zichtbaar (als Polar ingesteld is en er data is): grote kleurbalk, een stip, "Herstel vandaag: goed / matig / laag" en tegels voor Recharge, ANS charge, HRV en slaap.
- **Groen** = goed. **Oranje** = matig (1 aandachtspunt). **Rood** = laag (een duidelijk slecht cijfer of 2 aandachtspunten).
  - Rood: Recharge ≤2, ANS ver onder je norm, of slaapscore <45.
  - Oranje: Recharge 3, ANS onder je norm, slaapscore 45–59.
  - Je eigen readiness-antwoorden tellen mee: "spierpijn veel", "stress hoog" (en "slaap slecht" als Polar geen slaap heeft) zijn elk een aandachtspunt.
- Bij oranje of rood, zolang je nog niets gelogd hebt, staat er een zachte hint (lager volume of RPE-doel). Het plan verandert niet.
