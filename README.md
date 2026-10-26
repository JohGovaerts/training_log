# Training Log

Mobiele web-app om je trainingen te loggen in je eigen Google Sheet (OPEX-planning).
Geen server, geen build: statische bestanden. Je data gaat alleen tussen je browser en Google.

## Wat doet hij

- **Koppelt je Google Sheet** (plak de link, kies het tabblad). Kolommen worden op *kopnaam* herkend
  (`Week · Dag · Focus · Piece · Prescribed · Intent/target · Demo link · Actual · Rep splits · RPE · Bad day · Pain notes · Notes`),
  dus kolomvolgorde maakt niet uit.
- **Dag per dag**: weekkiezer + Ma–Zo. Dagen zonder rijen (zoals maandag) tonen als **Rustdag**. Vr/Zo-"Optioneel" krijgt een badge.
- **Per onderdeel de juiste velden**: warm-up/mobility = één knop *Gedaan* (+ pijn/notitie), WOD = score + rep splits, kracht = gewicht + RPE (splits optioneel), cardio = afstand/tijd. Daarnaast steeds: RPE, slechte dag, pijn/knie, "dag erna" (voor knie-/schouderstukken) en notities.
- **Schrijft naar de juiste cellen** en zet erbij:

  | Kolom (door de app toegevoegd rechts van Notes) | Inhoud |
  |---|---|
  | `Gelogd op` | tijdstip van loggen (`2026-10-26 18:42`) |
  | `Start` / `Einde` / `Duur (min)` | optioneel, per onderdeel |
  | `Sessie start` / `Sessie einde` | optioneel, op alle rijen van die trainingsdag |

- **Timers (optioneel)**: *Start training* voor de hele sessie en een ⏱ per onderdeel (warm-up, oefening, WOD). Of vul tijden achteraf in. Uitzetten kan in Instellingen.
- **Werkt in de gym zonder bereik**: wijzigingen komen in een wachtrij en worden verstuurd zodra je weer verbinding hebt. Het plan blijft offline zichtbaar, en half ingevulde formulieren blijven bewaard.
- **Veilig voor je sheet**: bestaande cellen die jij of de coach tussendoor in de sheet aanpaste worden niet stilletjes overschreven (de app vraagt eerst). Rijen worden bij elk schrijven opnieuw opgezocht op Week + Dag + Piece, dus ingevoegde rijen geven geen verschuiving.

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

1. Eerste start: client-ID + sheet-link → **Verbinden met Google** → tabblad kiezen → **Maandag van week 1** invullen (zodat "vandaag" automatisch opent) → Opslaan.
2. Tik een onderdeel open, vul in, **Opslaan**. Onderdeel overgeslagen? **Skip**.
3. Nieuwe cyclus of nieuwe sheetversie: Instellingen (⚙) → andere link plakken → Verbinden.

## Goed om te weten

- Het sheet-token verloopt na ±1 uur. Bij het opslaan vernieuwt de app het stilletjes; lukt dat niet, dan staat je invoer veilig in de wachtrij en tik je op **Inloggen**.
- Waarden worden als tekst geschreven (`RAW`), zodat Google "8-9" niet als datum omzet.
- iOS: als inloggen in de beginscherm-app niet terugkeert, open de app dan eens in een gewoon Safari-tabblad.
- Rijen met een onbekende dag-afkorting (geen Ma/Di/Wo/Do/Vr/Za/Zo) worden niet getoond.

## Ontwikkelen / testen

```
node --test tests/sheet.test.mjs   # logica (parsen, celplanning, tijden, datums)
node tests/e2e.cjs                 # echte browser + gemockte Google/Sheets-API
```
Bestanden: `js/sheet.js` (pure logica) · `js/api.js` (Google-login + Sheets) · `js/app.js` (UI) · `sw.js` (offline shell).
