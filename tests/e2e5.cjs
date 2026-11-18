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
      localStorage.setItem('logapp.settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', sheetId: WB, tab: 'Cycle 3', cycleStarts: { 'Cycle 3': monday }, ledgerId: LED, autoTab: true, timers: false }));
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
  // --- vorige keer (zonder record) + gepland tegenover echt
  await page.click('[data-act="toggle"]:has-text("Back squat")').catch(() => {});
  assert((await txt('main, #app')).includes('Vorige keer'), 'vorige keer getoond');
  assert((await txt('#app')).includes('110×5'), 'laatste keer = 110×5 (niet 100×5)');
  console.log('ok  vorige keer bij een onderdeel zonder record');

  // --- pijncheck de dag erna
  assert(await page.locator('.painbar:not(.readybar)').count() === 1, 'pijnbalk na een squat-sessie gisteren');
  await page.click('.painbar [data-v="Knie"]'); await page.screenshot({ path: path.join(OUT, 'painbar.png') }); await page.click('.painbar [data-act="pain-score"][data-v="2"]');
  await page.click('.painbar [data-act="pain-save"]');
  await wait(() => (books[WB].tabs['Cycle 3'].find((r) => r[1] == 1 && r[2] === 'Zo' && String(r[4]).startsWith('Back squat'))[13] || '').includes('Dag erna: Knie 2/10'), 'pijn naar de sheet');
  assert(await page.locator('.painbar:not(.readybar)').count() === 0, 'balk weg na antwoord');
  console.log('ok  pijncheck: antwoord komt als "Dag erna" in Pain notes');

  // --- weekoverzicht
  await page.click('.seg [data-p="week"]'); await page.click('[data-act="week"][data-d="-1"]');
  const wk = await txt('#app');
  assert(wk.includes('Week 1') && wk.includes('Sessies') && wk.includes('78'), 'week 1: sessies en echte tijd (78 min)');
  assert(wk.includes('gepland 35') || wk.includes("35'"), 'gepland 35 min');
  await page.click('.wkday:has-text("Zo")'); await page.waitForSelector('.dayhead');
  assert((await txt('.dayhead')).includes('gepland 35') && (await txt('.dayhead')).includes('echt 78'), 'dag: gepland tegenover echt');
  console.log('ok  weekoverzicht + gepland tegenover echt');

  // --- trends
  await page.click('.seg [data-p="records"]'); await page.waitForSelector('details.trends');
  await page.click('details.trends summary');
  assert((await txt('details.trends')).includes('Back squat'), 'e1RM-lijn voor back squat');
  console.log('ok  trends: geschatte 1RM en sessies per week');
  await page.screenshot({ path: path.join(OUT, 'trends.png') });
  await page.click('.seg [data-p="week"]'); await page.screenshot({ path: path.join(OUT, 'week.png') });

  const real = errors.filter((e) => !/ERR_FAILED|status of 400/.test(e));
  assert.deepStrictEqual(real, [], 'console errors: ' + real.join(' | '));
  await browser.close(); server.close();
  console.log('\nE2E5 PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
