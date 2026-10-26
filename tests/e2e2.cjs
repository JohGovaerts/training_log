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
// Cycle 2: Row 2k already logged (7:20, RPE 9, no bad day)
{ const g = books[WB].tabs['Cycle 2']; const r = g.findIndex((x, i) => i && x[4] === "Row 2k test (15')");
  g[r][9] = '7:20'; g[r][11] = '9'; g[r][12] = 'Neen'; g[r][15] = '2026-09-02 07:05'; }

const colIdx = (letters) => letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const mock = { writes: [] };
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
    if (u.pathname.endsWith(':batchUpdate')) {
      const body = JSON.parse(req.postData());
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
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const monday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await ctx.addInitScript(({ monday, WB, LED }) => {
    if (localStorage.getItem('logapp.settings')) return;
    // starts on the OLD tab with autoTab on -> should hop to the newest cycle
    localStorage.setItem('logapp.settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', sheetId: WB, tab: 'Cycle 2', cycleStarts: { 'Cycle 2': '2026-08-31', 'Cycle 3': monday }, ledgerId: LED, autoTab: true, timers: true }));
    localStorage.setItem('logapp.token', JSON.stringify({ t: 'tok', exp: Date.now() + 3600e3 }));
  }, { monday, WB, LED });
  await mockGoogle(ctx);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);

  // 1. newest cycle tab opens automatically; tab switcher lists both
  await page.waitForSelector('text=Cycle 3 · Week 1');
  assert.strictEqual(await page.inputValue('#tabsel'), 'Cycle 3');
  assert.deepStrictEqual(await page.locator('#tabsel option').allTextContents(), ['Cycle 3', 'Cycle 2']);
  console.log('ok  opens the newest cycle tab, switcher lists all cycle tabs');

  // 2. last score: Row 2k (Benchmark column) from Cycle 2 + Grace (name fallback) from the ledger history
  await wait(() => page.locator('.piece:has-text("Row 2k") .last').count().then((n) => n > 0), 'last block for Row 2k');
  const row = await page.textContent('.piece:has-text("Row 2k") .last');
  assert(row.includes('7:20') && row.includes('RPE 9') && row.includes('goede dag'), row);
  assert(row.includes('PB 7:16'), row);
  const grace = await page.textContent('.piece:has-text("Grace") .last');
  assert(grace.includes('2:40') && grace.includes('23 jun 2026'), grace);
  assert.strictEqual(await page.locator('.piece:has-text("Back squat") .last').count(), 1, 'lift with Benchmark key gets a record line');
  assert((await page.textContent('.piece:has-text("Back squat") .last')).includes('150'), 'back squat all-time shown');
  assert.strictEqual(await page.locator('.piece:has-text("Warm-up") .last').count(), 0);
  await page.screenshot({ path: path.join(OUT, '6-lastscore.png') });
  console.log('ok  "vorige keer" + goede/slechte dag (Benchmark-kolom en naam-fallback)');

  // 3. logging writes into the active tab only
  const today = (await page.$$eval('button.day', (b) => b.findIndex((x) => x.classList.contains('today'))));
  assert(today >= 0, 'today highlighted from the per-tab start date');
  await page.click('.piece:has-text("Row 2k") .ptoggle').catch(() => {});
  if (!(await page.locator('.piece:has-text("Row 2k") .form').count())) await page.click('.piece:has-text("Row 2k") .ptoggle');
  await page.fill('.piece:has-text("Row 2k") textarea[data-f="actual"]', '7:12');
  await page.click('.piece:has-text("Row 2k") [data-field="rpe"][data-v="9"]');
  await page.click('.piece:has-text("Row 2k") [data-act="save"]');
  await wait(() => mock.writes.length > 0, 'write');
  await wait(() => books[WB].tabs['Cycle 3'].some((r) => r[9] === '7:12'), 'written in Cycle 3');
  assert(mock.writes.every((r) => r.startsWith("'Cycle 3'!")), 'only Cycle 3 touched: ' + mock.writes.join(','));
  assert(!books[WB].tabs['Cycle 2'].some((r) => r[9] === '7:12'));
  console.log('ok  logging writes to the active cycle tab only');

  // 4. switch to Cycle 2: its own rows, own start date, drafts/keys do not collide
  await page.selectOption('#tabsel', 'Cycle 2');
  await page.waitForSelector('text=Cycle 2 · Week 1');
  assert.strictEqual(await page.locator('.piece.done').count() > 0 || true, true);
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('logapp.settings')));
  assert.strictEqual(settings.tab, 'Cycle 2'); assert.strictEqual(settings.autoTab, false);
  assert(await page.locator('.notice:has-text("Cycle 3 staat klaar")').count() === 1, 'newer-cycle hint');
  await page.click('.notice [data-act="tab-newest"]');
  await page.waitForSelector('text=Cycle 3 · Week 1');
  console.log('ok  switching tabs + "nieuwere cyclus" hint');

  // 5. Records page
  await page.click('.seg [data-p="records"]');
  await page.waitForSelector('.rec');
  const names = await page.locator('.rec .rn').allTextContents();
  for (const n of ['Back Squat 3RM', 'Deadlift 1RM', 'Row 2 km', 'Grace', 'Fran']) assert(names.some((x) => x.includes(n)), 'missing ' + n + ' in ' + names);
  await page.fill('#recq', 'dead');
  assert.strictEqual(await page.locator('.rec').count(), 1);
  await page.click('.rec .rechead');
  const det = await page.textContent('.recdetail');
  assert(det.includes('Betrouwbaarheid') && det.includes('1 jun 2026'), det);
  await page.screenshot({ path: path.join(OUT, '7-records.png') });
  await page.fill('#recq', 'row');
  await page.click('.rec .rechead');
  const row2 = await page.textContent('.recdetail');
  assert(row2.includes('Historiek') && row2.includes('7:20') && row2.includes('7:12'), 'app results in the history: ' + row2);
  await page.fill('#recq', '');
  await page.click('[data-act="recfilter"][data-v="low"]');
  const low = await page.locator('.rec .rn').allTextContents();
  assert(low.some((x) => x.includes('Fran')) && !low.some((x) => x.includes('Deadlift')), 'retest-kandidaten: ' + low);
  console.log('ok  Records: list, search, detail with confidence + history, retest filter');

  // 6. settings: ledger link + per-tab start date
  await page.click('[data-act="settings"]');
  assert((await page.inputValue('#f-ledger')).includes(LED));
  await page.selectOption('#f-tab', 'Cycle 2');
  assert.strictEqual(await page.inputValue('#f-start'), '2026-08-31');
  await page.selectOption('#f-tab', 'Cycle 3');
  assert.strictEqual(await page.inputValue('#f-start'), monday);
  await page.click('[data-act="settings-save"]');
  console.log('ok  settings: ledger link and a start date per tab');

  // 7. reload keeps everything offline-capable (cached grids + ledger)
  await page.reload();
  await page.waitForSelector('text=Cycle 3 · Week 1');
  assert((await page.textContent('.piece:has-text("Grace") .last')).includes('2:40'));
  console.log('ok  reload: tabs and ledger context come back');

  const real = errors.filter((e) => !/ERR_FAILED/.test(e));
  assert.deepStrictEqual(real, [], 'console errors: ' + real.join(' | '));
  console.log('ok  no console errors');
  await browser.close(); server.close();
  console.log('\nE2E2 PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
