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
