// End-to-end test: real app in headless Chromium, mocked Google sign-in + Sheets API.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const SHEET_ID = 'SHEET1234567890123456789';
const TAB = 'Training';
const OUT = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const H = ['Week', 'Dag', 'Focus', 'Piece', 'Prescribed', 'Intent/target', 'Demo link', 'Actual', 'Rep splits', 'RPE', 'Bad day', 'Pain notes', 'Notes'];
const SQ = 'Squat + explosief + snatch-cycling', BMU = 'Strict BMU + press + gym';
const di = (w) => [
  [w, 'Di', SQ, "Warm-up 10'", 'Schouder/elleboog: band pull-apart 2x15, ext. rotatie 2x12. Knie: Spanish squat iso 2x30s', 'Schouder pijnvrij vóór je start; knie-check', ''],
  [w, 'Di', SQ, "Explosief (10')", 'Rot. MB throw 3x6/kant (40lbs) + laterale bound & stick 3x5/kant', 'Fris, max intent. Log RPE + knie', ''],
  [w, 'Di', SQ, "Back squat full depth (20')", 'Ramp naar top-3, doel 140-142,5 kg @RPE8 dan 3x3 @ 126kg', 'Spotter arms. Pijn tijdens rep = stop → box. Log top + knie tijdens/dag erna', 'https://www.youtube.com/watch?v=abc'],
  [w, 'Di', SQ, "Snatch cycling TnG (12')", '5x6 TnG @50kg', 'Cue: bovenbeen raken tot heup gestrekt. Elke set UB', ''],
  [w, 'Di', SQ, 'WOD', "AMRAP 9': 8 power snatch 45kg / 10 box step-up 50cm / 12 cal row", 'Grind. Snatches 8 UB, row rustig. 4+ rondes', ''],
];
const wo = (w) => [
  [w, 'Wo', BMU, "Warm-up 10'", 'Schouder/elleboog prehab + scap pull-ups 2x8', 'Elleboog rustig?', ''],
  [w, 'Wo', BMU, "Strict press (12')", '5x5 @60kg', 'Pinch links = stop set. Log RPE', ''],
];
const rest = (w) => [
  [w, 'Do', 'Mobility + run/walk', 'Run/walk #1', "5' wandel + 12x(1'/1'), Z2", 'Knie volgende dag = go/no-go', ''],
  [w, 'Vr', "Optioneel vóór les (15')", 'BMU mini', '3x3 leg-assisted strict BMU', 'Enkel als elleboog rustig', ''],
  [w, 'Zo', 'Optioneel: engine + HS walk (of les)', 'Aerobe basis (20-25\')', "BikeERG/row afwisselend: 5x(3' Z2 / 1' easy)", 'Neus-ademen', ''],
];
const grid = [H, ...[1, 2].flatMap((w) => [...di(w), ...wo(w), ...rest(w)])];
grid[2][7] = '140kg'; grid[2][9] = '8'; // week 1 already logged by hand (row 3)

const rowOf = (w, dag, piece) => grid.findIndex((r) => r[0] === w && r[1] === dag && r[3] === piece) + 1;
const cell = (row, col) => (grid[row - 1] || [])[col] ?? '';
const colIdx = (letters) => letters.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1;
const mock = { fail: false, writes: 0, calls: [] };

function mime(f) { return { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' }[path.extname(f)] || 'application/octet-stream'; }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': mime(f) }); fs.createReadStream(f).pipe(res);
});

let page;
async function openPiece(text) {
  const loc = page.locator(`.piece:has-text("${text}")`);
  if (!(await loc.locator('.form').count())) await loc.locator('.ptoggle').click();
  await loc.locator('.form').waitFor();
}
async function wait(fn, msg, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) { try { if (await fn()) return; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 80)); }
  throw new Error('Timeout waiting for: ' + msg);
}

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block' });

  // Monday of last week => "today" falls in week 2
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) - 7);
  const cycleStart = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await ctx.addInitScript(({ cycleStart, SHEET_ID, TAB }) => {
    if (localStorage.getItem('logapp.settings')) return;
    localStorage.setItem('logapp.settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', sheetId: SHEET_ID, sheetTitle: 'Cycle 2 — Training Log', tab: TAB, cycleStart, timers: true }));
    localStorage.setItem('logapp.token', JSON.stringify({ t: 'tok', exp: Date.now() + 3600e3 }));
  }, { cycleStart, SHEET_ID, TAB });

  await ctx.route('https://accounts.google.com/gsi/client', (r) => r.fulfill({ contentType: 'text/javascript', body:
    "window.google={accounts:{oauth2:{initTokenClient:(c)=>({requestAccessToken:()=>c.callback({access_token:'tok',expires_in:3600})}),revoke(){}}}};" }));
  await ctx.route('https://sheets.googleapis.com/**', async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (mock.fail) return route.abort('failed');
    const json = (o) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (req.headers()['authorization'] !== 'Bearer tok') return route.fulfill({ status: 401, body: '{"error":{"message":"no"}}' });
    if (u.pathname.endsWith(':batchUpdate')) {
      const body = JSON.parse(req.postData());
      assert.strictEqual(body.valueInputOption, 'RAW');
      mock.writes++;
      for (const { range, values } of body.data) {
        const m = /^'(.+)'!([A-Z]+)(\d+)$/.exec(range); assert(m, 'bad range ' + range);
        const row = +m[3], col = colIdx(m[2]);
        while (grid.length < row) grid.push([]);
        while (grid[row - 1].length <= col) grid[row - 1].push('');
        grid[row - 1][col] = values[0][0];
      }
      return json({ totalUpdatedCells: body.data.length });
    }
    if (u.pathname.includes('/values/')) {
      mock.calls.push('GET values');
      const trimmed = grid.map((r) => { const x = r.map((v) => String(v)); while (x.length && x[x.length - 1] === '') x.pop(); return x; });
      return json({ range: TAB, majorDimension: 'ROWS', values: trimmed });
    }
    return json({ properties: { title: 'Cycle 2 — Training Log' }, sheets: [{ properties: { sheetId: 0, title: TAB } }] });
  });

  page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);

  // 1. loads plan, lands on today's week, adds app columns
  await page.waitForSelector('text=Week 2');
  await wait(() => grid[0][13] === 'Gelogd op', 'headers appended');
  assert.deepStrictEqual(grid[0].slice(13), ['Gelogd op', 'Start', 'Einde', 'Duur (min)', 'Sessie start', 'Sessie einde']);
  console.log('ok  loads plan + appends tracking columns');

  // 2. rest day (Monday has no rows) and day tabs
  await page.click('button.day[data-i="0"]');
  assert((await page.textContent('.rest')).includes('Rustdag'));
  await page.screenshot({ path: path.join(OUT, '1-restday.png') });
  console.log('ok  rest day shown');

  // 3. Tuesday: 5 pieces, log back squat
  await page.click('button.day[data-i="1"]');
  assert.strictEqual(await page.locator('.piece').count(), 5);
  await openPiece('Back squat');
  await page.screenshot({ path: path.join(OUT, '2-form.png') });
  const sqRow = rowOf(2, 'Di', "Back squat full depth (20')");
  await page.fill('.piece:has-text("Back squat") textarea[data-f="actual"]', '145kg');
  await page.click('.piece:has-text("Back squat") [data-field="rpe"][data-v="8"]');
  await page.click('.piece:has-text("Back squat") [data-field="badDay"][data-v="Neen"]');
  await page.click('.piece:has-text("Back squat") [data-field="pain"][data-v="Geen pijn"]');
  await page.fill('.piece:has-text("Back squat") input[data-f="after"]', 'licht stijf');
  await page.click('.piece:has-text("Back squat") [data-act="save"]');
  await wait(() => cell(sqRow, 7) === '145kg', 'squat written');
  assert.strictEqual(cell(sqRow, 9), '8'); assert.strictEqual(cell(sqRow, 10), 'Neen');
  assert.strictEqual(cell(sqRow, 11), 'Geen pijn | Dag erna: licht stijf');
  assert.match(cell(sqRow, 13), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.strictEqual(cell(sqRow - 1, 7), '', 'neighbour row untouched');
  assert.strictEqual(cell(3, 7), '140kg', 'hand-logged week 1 untouched');
  console.log('ok  back squat -> correct cells + timestamp');

  // 4. part timer -> start/end/duur
  const snRow = rowOf(2, 'Di', "Snatch cycling TnG (12')");
  await page.click('.piece:has-text("Snatch cycling") [data-act="ptimer"]');
  await page.waitForTimeout(1300);
  await page.click('.piece:has-text("Snatch cycling") [data-act="ptimer"]');
  await page.fill('.piece:has-text("Snatch cycling") textarea[data-f="actual"]', '5x6@50kg');
  await page.click('.piece:has-text("Snatch cycling") [data-act="save"]');
  await wait(() => cell(snRow, 7) === '5x6@50kg', 'snatch written');
  assert.match(cell(snRow, 14), /^\d\d:\d\d$/); assert.match(cell(snRow, 15), /^\d\d:\d\d$/);
  assert(Number(cell(snRow, 16)) >= 0 && cell(snRow, 16) !== '', 'duur numeric');
  assert.strictEqual(cell(snRow, 12), '', 'notes untouched');
  console.log('ok  per-part timer -> start/einde/duur');

  // 5. warm-up quick log
  const wuRow = rowOf(2, 'Di', "Warm-up 10'");
  await openPiece('Warm-up');
  await page.click('.piece:has-text("Warm-up") [data-act="quick"]');
  await wait(() => cell(wuRow, 7) === 'Gedaan', 'warmup written');
  assert.strictEqual(cell(wuRow, 9), '', 'no RPE column written for warm-up');
  console.log('ok  warm-up quick log');

  // 6. session timer -> all rows of the day
  await page.click('[data-act="sess-start"]');
  await page.waitForSelector('.banner');
  await page.waitForTimeout(1100);
  await page.click('.banner [data-act="sess-end"]');
  await wait(() => cell(rowOf(2, 'Di', 'WOD'), 18) !== '', 'session end written');
  for (const p of ["Warm-up 10'", "Explosief (10')", 'WOD']) {
    const r = rowOf(2, 'Di', p); assert.match(cell(r, 17), /^\d\d:\d\d$/); assert.match(cell(r, 18), /^\d\d:\d\d$/);
  }
  assert.strictEqual(cell(rowOf(2, 'Wo', "Strict press (12')"), 17), '', 'other day untouched');
  console.log('ok  session start/end -> every row of that day');

  // 7. offline: queue, then flush on reconnect
  const wodRow = rowOf(2, 'Di', 'WOD');
  mock.fail = true;
  await openPiece('WOD');
  await page.fill('.piece:has-text("WOD") textarea[data-f="actual"]', '5+3');
  await page.fill('.piece:has-text("WOD") textarea[data-f="splits"]', '8/8/7');
  await page.click('.piece:has-text("WOD") [data-act="save"]');
  await wait(async () => /wachtrij|Offline/.test(await page.textContent('#chip')), 'queued chip');
  assert.strictEqual(cell(wodRow, 7), '', 'nothing written while offline');
  assert((await page.textContent('.piece:has-text("WOD")')).includes('wacht op sync'));
  await page.screenshot({ path: path.join(OUT, '3-queued.png') });
  mock.fail = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await wait(() => cell(wodRow, 7) === '5+3' && cell(wodRow, 8) === '8/8/7', 'queue flushed');
  console.log('ok  offline queue flushes on reconnect');

  // 8. conflict: sheet edited elsewhere after form was opened
  const prRow = rowOf(2, 'Wo', "Strict press (12')");
  await page.click('button.day[data-i="2"]');
  await openPiece('Strict press');
  grid[prRow - 1][7] = 'extern aangepast';
  await page.fill('.piece:has-text("Strict press") textarea[data-f="actual"]', '5x5@60kg');
  page.once('dialog', (dlg) => { assert(dlg.message().includes('aangepast')); dlg.dismiss(); });
  await page.click('.piece:has-text("Strict press") [data-act="save"]');
  await wait(() => mock.calls.length > 0 && true, 'sync ran'); await page.waitForTimeout(600);
  assert.strictEqual(cell(prRow, 7), 'extern aangepast', 'dismissed overwrite keeps other edit');
  console.log('ok  conflict warning protects edits made elsewhere');

  // 9. draft survives reload
  await openPiece('Strict press');
  await page.fill('.piece:has-text("Strict press") textarea[data-f="actual"]', 'half getypt');
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('text=Week 2');
  await page.click('button.day[data-i="2"]');
  await openPiece('Strict press');
  assert.strictEqual(await page.inputValue('.piece:has-text("Strict press") textarea[data-f="actual"]'), 'half getypt');
  console.log('ok  unsaved draft survives reload');

  await page.click('button.day[data-i="1"]');
  await page.screenshot({ path: path.join(OUT, '4-tuesday.png'), fullPage: false });

  const real = errors.filter((e) => !/ERR_FAILED/.test(e)); // ERR_FAILED = the deliberate offline step
  assert.deepStrictEqual(real, [], 'no console errors: ' + real.join(' | '));
  console.log('ok  no console errors');
  await browser.close(); server.close();
  console.log('\nALL E2E CHECKS PASSED');
})().catch(async (e) => { console.error('FAILED:', e.message); process.exit(1); });
