// E2E 2: one workbook with a tab per cycle (Sheet Contract v2) + PR Ledger records + last score.
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
  const monday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await ctx.addInitScript(({ monday, WB, LED }) => {
    if (!localStorage.getItem('logapp.settings')) {
      localStorage.setItem('logapp.settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', sheetId: WB, tab: 'Cycle 3', coachKey: 'sk-ant-test', cycleStarts: { 'Cycle 3': monday }, ledgerId: LED, autoTab: true, timers: false }));
      localStorage.setItem('logapp.token', JSON.stringify({ t: 'tok', exp: Date.now() + 3600e3 }));
    }
    window.__beeps = []; window.__wl = 0;
    window.AudioContext = class { constructor() { this.state = 'running'; this.t0 = Date.now(); } get currentTime() { return (Date.now() - this.t0) / 1000; } get destination() { return {}; } resume() { return Promise.resolve(); }
      createOscillator() { const o = { frequency: { value: 0 }, type: '', connect() {}, start() { window.__beeps.push(o.frequency.value); }, stop() {} }; return o; }
      createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }; } };
    Object.defineProperty(navigator, 'wakeLock', { value: { request: async () => { window.__wl += 1; return { release: async () => { window.__wl -= 1; }, addEventListener() {} }; } } });
  }, { monday, WB, LED });
  await mockGoogle(ctx);
  const page = await ctx.newPage();
  await page.clock.install();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('text=Cycle 3 · Week 2');
  const beeps = (f) => page.evaluate((f) => window.__beeps.filter((x) => x === f).length, f);
  const txt = (sel) => page.textContent(sel);
  const run = (ms) => page.clock.runFor(ms);

  const sheet = () => books[WB].tabs['Cycle 3'];
  const w2wo = (piece) => sheet().filter((r) => r[1] == 2 && r[2] === 'Wo' && String(r[4]).startsWith(piece));

  // --- readiness
  await page.click('.painbar [data-act="pain-skip"]').catch(() => {});
  assert(await page.locator('.readybar').count() === 1, 'readiness-kaart vandaag');
  assert(await page.locator('.readybar [data-act="ready-save"][disabled]').count() === 1, 'opslaan pas na 3 antwoorden');
  await page.click('.readybar [data-k="sl"][data-v="Goed"]'); await page.click('.readybar [data-k="sp"][data-v="Matig"]'); await page.click('.readybar [data-k="st"][data-v="Laag"]');
  await page.click('.readybar [data-act="ready-save"]');
  await wait(() => sheet()[0].includes('Readiness'), 'kolom Readiness aangemaakt');
  const ci = sheet()[0].indexOf('Readiness');
  await wait(() => w2wo('Back squat')[0][ci] === 'Slaap goed · Spierpijn matig · Stress laag', 'readiness op elke rij van de dag');
  assert(w2wo('Strict press')[0][ci].includes('Stress laag'));
  assert((await txt('.readyline')).includes('Slaap goed'), 'readiness zichtbaar in de dag');
  console.log('ok  readiness: 3 tikken, kolom op aanvraag, op elke rij van de dag');
  assert(sheet()[0].filter((h) => h === 'Readiness').length === 1);

  // --- extra sessie
  const before = sheet().length;
  await page.click('[data-act="extra-open"]');
  await page.screenshot({ path: path.join(OUT, 'extra.png') });
  await page.fill('#x-title', 'CrossFit-les 18u'); await page.fill('#x-actual', 'Fran 5:10'); await page.selectOption('#x-rpe', '9'); await page.fill('#x-dur', '60');
  await page.selectOption('#x-rep', { label: "Strict press 4x6 (15')" });
  await page.click('[data-act="extra-save"]');
  assert((await txt('#app')).includes('Les: CrossFit-les 18u'), 'extra rij meteen zichtbaar');
  await wait(() => sheet().length === before + 1, 'rij toegevoegd in de sheet');
  const ex = sheet().at(-1);
  assert(ex[3] === 'Extra' && ex[4] === 'Les: CrossFit-les 18u' && ex[9] === 'Fran 5:10' && ex[11] === '9' && ex[2] === 'Wo' && ex[1] === '2', 'extra rij klopt: ' + JSON.stringify(ex));
  await wait(() => w2wo('Strict press')[0][9] === 'Vervangen door les', 'geplande piece = Vervangen door les');
  console.log('ok  extra sessie: rij toegevoegd, piece vervangen door les');

  // --- gym-modus
  await page.click('[data-act="gym-open"]');
  assert(await page.locator('#gym:not([hidden])').count() === 1);
  assert((await txt('#gym h1')).includes('Back squat'), 'eerste open onderdeel');
  await page.click('[data-gym="next"]'); assert((await txt('#gym h1')).includes('Strict press'));
  await page.click('[data-gym="prev"]'); await page.screenshot({ path: path.join(OUT, 'gym.png') });
  await page.click('#gym [data-tm="open"]'); assert(await page.locator('#tm:not([hidden])').count() === 1, 'timer vanuit gym-modus');
  await page.click('#tm [data-tm="close"]');
  await page.click('[data-gym="close"]'); assert(await page.locator('#gym:not([hidden])').count() === 0);
  console.log('ok  gym-modus: groot onderdeel, vorige/volgende, timer, sluiten');

  // --- tokens + Haiku in de bevestiging
  await page.click('.seg [data-p="coach"]');
  await page.fill('#cdraft', 'Hoe bouw ik mijn squat op?'); await page.click('[data-act="coach-send"]');
  const ask = await txt('.askmodal');
  assert(/tokens invoer/.test(ask) && ask.includes('claude-haiku-5-5') && /\$0[.,]\d+/.test(ask), 'tokens + haiku in bevestiging: ' + ask);
  await page.click('[data-act="ask-no"]');
  await page.setInputFiles('input[type=file]', { name: 'squat.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') }).catch(() => {});
  await wait(() => page.locator('[data-act="coach-send"]').count(), 'coach-send');
  await page.fill('#cdraft', 'Hoe is mijn squat?'); await page.click('[data-act="coach-send"]');
  const ask2 = await txt('.askmodal');
  assert(ask2.includes('claude-sonnet-5-5') && !ask2.includes('claude-haiku-5-5'), 'met beeld: Sonnet, niet Haiku: ' + ask2);
  await page.click('[data-act="ask-no"]');
  console.log('ok  bevestiging toont tokens, kost en Haiku voor losse vragen');

  // --- CSV
  await page.click('[data-act="settings"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="csv"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  assert(csv.startsWith('﻿Cycle;Week;Dag;') && csv.includes('Les: CrossFit-les 18u') && csv.includes('Readiness'), 'csv inhoud');
  console.log('ok  CSV-export');

  const real = errors.filter((e) => !/ERR_FAILED|status of 400|Failed to load resource/.test(e));
  assert.deepStrictEqual(real, [], 'console errors: ' + real.join(' | '));
  await browser.close(); server.close();
  console.log('\nE2E6 PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
