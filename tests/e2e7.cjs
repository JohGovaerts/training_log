// E2E 7: optionele Polar-koppeling (eigen Worker, gemockt).
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const WB = 'WORKBOOK12345678901234567', LED = 'LEDGER123456789012345678';
const OUT = process.env.SHOTS || path.join(ROOT, 'tests', 'shots'); fs.mkdirSync(OUT, { recursive: true });

const CH = ['Cycle', 'Week', 'Dag', 'Focus', 'Piece', 'Benchmark', 'Prescribed', 'Intent/target', 'Demo link', 'Actual', 'Rep splits', 'RPE', 'Bad day', 'Pain notes', 'Notes', 'Gelogd op', 'Start', 'Einde', 'Duur (min)', 'Sessie start', 'Sessie einde'];
const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const mk = (cycle, extra = {}) => [CH, ...DAYS.flatMap((d) => [
  [cycle, 1, d, 'Engine', "Row 2k test (15')", 'Row 2k', '2 km all-out', 'Grind', '', '', '', '', '', '', '', ''],
  [cycle, 1, d, 'Engine', "Grace (10')", '', '30 C&J 60kg', 'Sprint', '', '', '', '', '', '', '', ''],
  [cycle, 1, d, 'Kracht', "Back squat 3RM (20')", 'Back Squat 3RM', 'ramp naar 3RM', 'Spotter', '', '', '', '', '', '', '', ''],
  [cycle, 1, d, 'Kracht', "Warm-up 10'", '', 'x', 'y', '', '', '', '', '', '', '', ''],
])];
const books = {
  [WB]: { title: 'Training Log', tabs: { 'Cycle 2': mk(2), 'Cycle 3': mk(3) } },
  [LED]: {
    title: 'PR Ledger v2',
    tabs: {
      'PR Ledger': [
        ['Sectie', 'Item', 'Rep/Afstand', 'Current PB', 'Current datum', 'Geschatte PB', 'All-time PB', 'All-time datum', 'Δ abs (cur-AT)', 'Δ % (cur-AT)', 'Noot'],
        ['Main Lifts (kg)', 'Back Squat', '3RM', '—', '', '', '150', '11-7-2023'],
        ['Main Lifts (kg)', 'Deadlift', '1RM', '210', '1-6-2026', '217.5 (met chalk)', '215.5', '31-5-2025'],
        ['Monostructural', 'Row', '2 km', '7:16', '1-6-2026', '', '7:08', '9-11-2023', '+8 s', '1,90%', 'assessment 7:16 conditions-limited'],
      ],
      'Benchmark Tracker - Summary': [
        ['Categorie', 'Workout', 'Current', 'Current datum', 'Rx/Sc', 'All-time best', 'All-time datum', 'Δ abs (cur-AT)', 'Δ % (cur-AT)', 'Noot'],
        ['Olympic', 'Grace', '0:02:40', '2026-06-23', 'Rx', '0:02:40', '2026-06-23', '0 s', '0%', ''],
        ['Light', 'Fran', '0:04:56', '2022-08-27', 'Rx', '0:04:56', '2022-08-27', '0 s', '0%', ''],
      ],
      'Benchmark Tracker - History': [
        ['Categorie', 'Workout', 'Resultaat', 'Rx/Scaled', 'Datum', 'Noot'],
        ['Olympic', 'Grace', '2 mins 57 secs', 'Rx', '2022-08-27'],
        ['Olympic', 'Grace', '2 mins 40 secs', 'Rx', '2026-06-23', 'meest recent / beste'],
      ],
    },
  },
};
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
{ const rows = [CH];
  for (const w of [1, 2]) for (const dd of DAYS) rows.push([3, w, dd, dd === 'Wo' ? 'Optioneel conditioning' : 'Kracht', "Back squat 5x5 (20')", '', '5×5 @ 100 kg', 'Spotter', '', '', '', '', '', '', '', ''], [3, w, dd, dd === 'Wo' ? 'Optioneel conditioning' : 'Kracht', "Strict press 4x6 (15')", '', '4×6', 'x', '', '', '', '', '', '', '', '']);
  const row = (w, dd, piece) => rows.find((r) => r[1] === w && r[2] === dd && r[4].startsWith(piece));
  let r = row(1, 'Za', 'Back squat'); r[9] = '100×5, 100×5'; r[11] = '7'; r[15] = `${iso(dAgo(2))} 18:00`;
  r = row(1, 'Zo', 'Back squat'); r[9] = '110×5, 110×5'; r[11] = '8'; r[15] = `${iso(dAgo(1))} 18:30`; r[19] = '18:00'; r[20] = '19:18';
  row(1, 'Zo', 'Strict press')[19] = '18:00'; row(1, 'Zo', 'Strict press')[20] = '19:18';
  books[WB].tabs['Cycle 3'] = rows; }
const colIdx = (letters) => letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const mock = { writes: [], added: [], api: [] };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
});
async function wait(fn, msg, ms = 7000) { const t = Date.now(); while (Date.now() - t < ms) { try { if (await fn()) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 80)); } throw new Error('Timeout waiting for: ' + msg); }

async function mockGoogle(ctx) {
  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c.callback({access_token:'tok',expires_in:3600})}),revoke(){}}}};" }));
  await ctx.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request(); const u = new URL(req.url());
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    const m = /\/spreadsheets\/([^/:?]+)(\/values\/([^?]+)|\/values:batchUpdate)?/.exec(u.pathname);
    const book = books[m[1]]; if (!book) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":{"message":"nope"}}' });
    if (u.pathname.endsWith(':batchUpdate') && !u.pathname.includes('/values:')) {
      const body = JSON.parse(req.postData()); const t = body.requests[0].addSheet.properties.title;
      assert(!book.tabs[t], 'tab exists'); book.tabs[t] = []; mock.added.push(t); return json({});
    }
    if (u.pathname.endsWith(':append')) {
      const t = decodeURIComponent(u.pathname.split('/values/')[1]).replace(/!A1:append$/, '').replace(/^'|'$/g, '');
      assert(book.tabs[t], 'append to unknown tab ' + t); book.tabs[t].push(...JSON.parse(req.postData()).values); mock.appends = (mock.appends || 0) + 1; return json({});
    }
    if (u.pathname.endsWith(':clear')) { const t = decodeURIComponent(u.pathname.split('/values/')[1].replace(':clear', '')).replace(/^'|'$/g, ''); book.tabs[t] = []; return json({}); }
    if (u.pathname.endsWith(':batchUpdate')) {
      const body = JSON.parse(req.postData());
      for (const { range, values } of body.data) {
        const mm = /^'(.+)'!A1$/.exec(range);
        if (mm && values.length > 1) { book.tabs[mm[1]] = values.map((r) => r.slice()); mock.writes.push(range); }
      }
      body.data = body.data.filter((d) => !(/!A1$/.test(d.range) && d.values.length > 1));
      for (const { range, values } of body.data) {
        const mm = /^'(.+)'!([A-Z]+)(\d+)$/.exec(range); assert(mm, 'bad range ' + range);
        const g = book.tabs[mm[1]]; assert(g, 'unknown tab ' + mm[1]);
        const row = +mm[3], col = colIdx(mm[2]);
        while (g.length < row) g.push([]); while (g[row - 1].length <= col) g[row - 1].push('');
        g[row - 1][col] = values[0][0]; mock.writes.push(range);
      }
      return json({});
    }
    if (m[3]) {
      const tab = decodeURIComponent(m[3]).replace(/^'|'$/g, '').replace(/''/g, "'");
      const g = book.tabs[tab]; if (!g) return route.fulfill({ status: 400, contentType: 'application/json', body: '{"error":{"message":"Unable to parse range"}}' });
      return json({ values: g.map((r) => { const x = r.map(String); while (x.length && x[x.length - 1] === '') x.pop(); return x; }) });
    }
    return json({ properties: { title: book.title }, sheets: Object.keys(book.tabs).map((t, i) => ({ properties: { sheetId: i, title: t } })) });
  });
}




(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });
  const d = new Date(); d.setDate(d.getDate() - 7);
  const monday = iso(d);
  const todayIdx = (new Date().getDay() + 6) % 7, todayDag = DAYS[todayIdx], todayIso = iso(new Date());
  // sessie van vandaag al ingevuld: 14:00-15:00
  for (const r of books[WB].tabs['Cycle 3']) if (r[1] == 2 && r[2] === todayDag) { r[19] = '14:00'; r[20] = '15:00'; }
  await ctx.addInitScript(({ monday, WB, LED, withPolar }) => {
    if (!localStorage.getItem('logapp.settings')) {
      localStorage.setItem('logapp.settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', sheetId: WB, tab: 'Cycle 3', cycleStarts: { 'Cycle 3': monday }, ledgerId: LED, autoTab: true, timers: false, readiness: false, ...(withPolar ? { polarUrl: 'https://polar.test.workers.dev/', polarKey: 'geheim-code' } : {}) }));
      localStorage.setItem('logapp.token', JSON.stringify({ t: 'tok', exp: Date.now() + 3600e3 }));
    }
  }, { monday, WB, LED, withPolar: true });
  await mockGoogle(ctx);
  const calls = [];
  let exercises = [];
  let sleep = { score: 81, asleepMin: 424 };
  let recharge = { status: 5, ansCharge: -0.4, ansStatus: 3, hrv: 71, restHr: 48, breathing: 13.9 };
  await ctx.route('https://polar.test.workers.dev/**', async (route) => {
    const req = route.request(); const u = new URL(req.url());
    calls.push({ path: u.pathname + u.search, key: req.headers()['x-app-key'] });
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-App-Key' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (req.headers()['x-app-key'] !== 'geheim-code') return route.fulfill({ status: 401, headers: cors, contentType: 'application/json', body: '{"error":"ongeldige code"}' });
    if (u.pathname === '/api/ping') return route.fulfill({ headers: cors, contentType: 'application/json', body: '{"ok":true}' });
    return route.fulfill({ headers: cors, contentType: 'application/json', body: JSON.stringify({ date: u.searchParams.get('date'),
      recharge,
      sleep, activity: { steps: 1402 }, cardioLoad: null, exercises, errors: {} }) });
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('text=Cycle 3 · Week 2');
  const txt = (sel) => page.textContent(sel);
  const sheet = () => books[WB].tabs['Cycle 3'];
  const today = () => sheet().filter((r) => r[1] == 2 && r[2] === todayDag);

  // --- test-verbinding in ⚙
  await page.click('[data-act="settings"]');
  assert(await page.locator('#f-purl').inputValue() === 'https://polar.test.workers.dev/');
  await page.click('[data-act="polar-test"]');
  await wait(async () => (await txt('#toast')).includes('bereikbaar'), 'test-verbinding geslaagd');
  assert(calls.some((c) => c.path === '/api/ping' && c.key === 'geheim-code'), 'ping met code');
  await page.click('[data-act="settings-close"]');
  console.log('ok  instellingen: test verbinding met code in header');

  // --- automatisch: herstel van vandaag wordt bewaard zonder te tikken
  await wait(() => sheet()[0].includes('Polar'), 'kolom Polar aangemaakt (automatisch)');
  const ci = sheet()[0].indexOf('Polar');
  await wait(() => String(today()[0][ci]).startsWith('Recharge 5/6'), 'herstel automatisch opgeslagen');
  assert(!String(today()[0][ci]).includes('Training'), 'nog geen training');
  assert(calls.some((c) => c.path === `/api/day?date=${todayIso}`), 'juiste datum opgevraagd: ' + JSON.stringify(calls));
  await page.waitForSelector('.polarcard.ok');
  const okCard = await txt('.polarcard');
  assert(okCard.includes('Herstel vandaag: goed') && okCard.includes('5/6') && okCard.includes('-0,4') && okCard.includes('81') && okCard.includes('7u04'), 'groene kaart met cijfers: ' + okCard);
  assert(!okCard.includes('Overweeg'), 'geen hint bij goed herstel');
  await page.screenshot({ path: path.join(OUT, 'polar-ok.png') });
  console.log('ok  Polar automatisch: herstel bewaard zonder tikken, groene kaart');

  // --- met twee trainingen: de juiste (overlap met 14:00-15:00) wordt gekozen
  exercises = [
    { id: 'a', start: `${todayIso}T09:08:18`, offsetMin: 60, durationMin: 3.2, avgHr: 85, maxHr: 110, cardioLoad: 0.7, rpe: null },
    { id: 'b', start: `${todayIso}T14:05:00`, offsetMin: 60, durationMin: 52, avgHr: 142, maxHr: 171, cardioLoad: 38.4, rpe: null },
  ];
  await page.click('[data-act="polar-fetch"]');
  await wait(() => String(today()[0][ci]).includes('Training'), 'training toegevoegd');
  const v = String(today()[0][ci]);
  assert(v === 'Recharge 5/6 · ANS -0,4 · HRV 71 · Slaap 81 (7u04) · Training gem HR 142, max 171, load 38,4', 'tekst: ' + v);
  for (const r of today()) assert(r[ci] === v, 'op elke rij van de dag');
  assert((await txt('.readyline')).includes('gem HR 142'), 'zichtbaar in de dag');
  assert((await txt('.polarline')).includes('opnieuw'), 'knop wordt opnieuw');
  console.log('ok  Polar: juiste training gekozen, tekst op elke rij van de dag');

  // --- automatisch: training wordt gekoppeld na herladen (sessie 14:00-15:00 bestaat), herstel was al bewaard
  for (const r of today()) r[ci] = 'Recharge 5/6 · ANS -0,4 · HRV 71 · Slaap 81 (7u04)';
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 2');
  await wait(() => String(today()[0][ci]).includes('Training gem HR 142'), 'training automatisch gekoppeld');
  console.log('ok  Polar automatisch: training gekoppeld zonder tikken');

  // --- laag herstel: kaart met zachte hint
  recharge = { status: 3, ansCharge: -6, ansStatus: 2, hrv: 40, restHr: 55, breathing: 14 };
  await page.reload(); await page.waitForSelector('.polarcard');
  const card = await txt('.polarcard');
  assert(card.includes('Herstel vandaag: laag') && card.includes('Herstel onder je norm') && card.includes('Recharge 3/6') && card.includes('lager volume'), 'hint: ' + card);
  assert(await page.locator('.polarcard.low').count() === 1);
  await page.screenshot({ path: path.join(OUT, 'polar-low.png') });
  console.log('ok  Polar: laag herstel toont kaart met zachte hint');

  // --- readiness: slaap komt uit Polar, de vraag blijft bij ontbrekende data
  const setS = (o) => page.evaluate((o) => { const x = JSON.parse(localStorage.getItem('logapp.settings')); Object.assign(x, o); localStorage.setItem('logapp.settings', JSON.stringify(x)); }, o);
  recharge = { status: 5, ansCharge: -0.4, ansStatus: 3, hrv: 71, restHr: 48, breathing: 13.9 };
  for (const r of today()) r[sheet()[0].indexOf('Polar')] = '';
  await setS({ readiness: true });
  await page.reload(); await page.waitForSelector('.readybar');
  await wait(async () => (await txt('.readybar')).includes('Polar 81'), 'slaap uit Polar getoond');
  assert(await page.locator('.readybar [data-k="sl"]').count() === 0, 'geen slaapknoppen als Polar het weet');
  assert((await txt('.readybar')).includes('2 tikken'));
  await page.click('.readybar [data-k="sp"][data-v="Matig"]'); await page.click('.readybar [data-k="st"][data-v="Laag"]');
  await page.click('.readybar [data-act="ready-save"]');
  await wait(() => sheet()[0].includes('Readiness'), 'kolom Readiness');
  const ri = sheet()[0].indexOf('Readiness');
  await wait(() => today()[0][ri] === 'Slaap goed · Spierpijn matig · Stress laag', 'readiness met slaap uit Polar: ' + today()[0][ri]);
  console.log('ok  readiness: slaap uit Polar, 2 tikken');

  // zonder slaapdata van deze nacht: de vraag blijft
  for (const r of today()) r[ri] = '';
  sleep = null;
  await page.reload(); await page.waitForSelector('.readybar');
  await new Promise((r) => setTimeout(r, 600));
  assert(await page.locator('.readybar [data-k="sl"]').count() === 3, 'slaapvraag blijft zonder Polar-slaap');
  assert((await txt('.readybar')).includes('3 tikken'));
  console.log('ok  readiness: zonder slaapdata blijft de slaapvraag staan');
  await setS({ readiness: false });

  // --- verkeerde code → duidelijke fout
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('logapp.settings')); s.polarKey = 'fout'; localStorage.setItem('logapp.settings', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('[data-act="polar-fetch"]');
  await page.click('[data-act="polar-fetch"]');
  await wait(async () => (await txt('#toast')).includes('ongeldige code'), 'foutmelding bij verkeerde code');
  console.log('ok  Polar: verkeerde code geeft duidelijke melding');

  // --- zonder instellingen: geen Polar-UI
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('logapp.settings')); s.polarUrl = ''; s.polarKey = ''; localStorage.setItem('logapp.settings', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 2');
  assert(await page.locator('[data-act="polar-fetch"]').count() === 0, 'geen Polar-knop zonder instellingen');
  console.log('ok  Polar: zonder instellingen geen knop');

  const real = errors.filter((e) => !/ERR_FAILED|status of 400|status of 401|Failed to load resource/.test(e));
  assert.deepStrictEqual(real, [], 'console errors: ' + real.join(' | '));
  await browser.close(); server.close();
  console.log('\nE2E7 PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
