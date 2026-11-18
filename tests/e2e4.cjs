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
// timer pieces on every day of week 1
{ const rows = [CH];
  for (const d of DAYS) rows.push(
    [3, 1, d, 'Timers', "Wall balls EMOM (10')", '', "EMOM 10': 14 wall balls | 12 burpees", 'Sprint', '', '', '', '', '', '', '', ''],
    [3, 1, d, 'Timers', "Pull-ups AMRAP (12')", '', "AMRAP 12': 5 pull-ups, 10 push-ups, 15 squats", 'Grind', '', '', '', '', '', '', '', ''],
    [3, 1, d, 'Timers', "Grace (10')", '', "For time: 30 C&J 60 kg, TC 12', target 9'", 'Sprint', '', '', '', '', '', '', '', ''],
    [3, 1, d, 'Timers', "Back squat 5x3 (20')", '', "5×3 @ 100 kg, rust 2'30", 'Spotter', '', '', '', '', '', '', '', ''],
    [3, 1, d, 'Timers', "Sled (12')", '', "5 × 3' werk / 2' rust", 'Grind', '', '', '', '', '', '', '', ''],
  );
  books[WB].tabs['Cycle 3'] = rows; }
// Cycle 2: Row 2k already logged (7:20, RPE 9, no bad day)
{ const g = books[WB].tabs['Cycle 2']; const r = g.findIndex((x, i) => i && x[4] === "Row 2k test (15')");
  g[r][9] = '7:20'; g[r][11] = '9'; g[r][12] = 'Neen'; g[r][15] = '2026-09-02 07:05'; }

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
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
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
  await page.waitForSelector('text=Cycle 3 · Week 1');
  const beeps = (f) => page.evaluate((f) => window.__beeps.filter((x) => x === f).length, f);
  const txt = (sel) => page.textContent(sel);
  const run = (ms) => page.clock.runFor(ms);

  // --- EMOM: parsed from the prescription, countdown, signals, pause, stop
  await page.click('.piece:has-text("Wall balls EMOM") [data-tm="open"]');
  assert((await txt('#tm')).includes("EMOM 10'") && (await txt('#tm')).includes('10 intervallen'), 'ready screen shows the parsed EMOM');
  assert((await txt('#tm')).includes('1. 14 wall balls') && (await txt('#tm')).includes('2. 12 burpees'));
  await page.click('[data-tm="start"]');
  assert.strictEqual(await page.evaluate(() => window.__wl), 1, 'wake lock held');
  assert((await txt('#tm-time')) === '10' || (await txt('#tm-time')) === '9', 'countdown shows seconds');
  await page.screenshot({ path: path.join(OUT, 'timer-countdown.png') });
  await run(10300);
  assert.strictEqual(await beeps(880), 3, 'three pips in the last 3 s of the countdown');
  assert.strictEqual(await beeps(1320), 1, 'go signal');
  assert((await txt('#tm')).includes('interval 1 van 10') && (await txt('#tm')).includes('14 wall balls'), 'first interval');
  await run(1000);
  assert((await txt('#tm-time')).startsWith('0:5'), 'remaining time ' + await txt('#tm-time'));
  await page.screenshot({ path: path.join(OUT, 'timer-emom-portrait.png') });
  await run(48800);                                  // 60.1 s in = 50.1 s into the first interval
  assert.strictEqual(await beeps(740), 2, 'warning (double beep) 10 s before the end');
  await run(10000);
  assert((await txt('#tm')).includes('interval 2 van 10') && (await txt('#tm')).includes('12 burpees'), 'second interval, other movement');
  assert.strictEqual(await beeps(1175), 1, 'new-interval signal');
  await page.click('[data-tm="pause"]');
  assert((await txt('.tm-band')) === 'PAUZE');
  const frozen = await txt('#tm-time'); await run(5000);
  assert.strictEqual(await txt('#tm-time'), frozen, 'paused clock does not move');
  await page.click('[data-tm="resume"]');
  await run(3000);
  assert.notStrictEqual(await txt('#tm-time'), frozen);
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'timer-emom-landscape.png') });
  const geo = await page.evaluate(() => { const t = document.querySelector('#tm-time').getBoundingClientRect(), b = document.querySelector('.tm-btns').getBoundingClientRect(), w = innerWidth; return { tw: t.width, bx: (b.left + b.right) / 2, w, bBottom: b.bottom, h: innerHeight }; });
  assert(geo.tw > geo.w * 0.8, 'landscape: time spans the full width ' + JSON.stringify(geo));
  assert(Math.abs(geo.bx - geo.w / 2) < 6 && geo.bBottom <= geo.h, 'landscape: buttons centred at the bottom ' + JSON.stringify(geo));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-tm="stop"]');
  assert((await txt('#tm')).includes('Gestopt'));
  await page.click('[data-tm="drop"]');
  assert.strictEqual(await page.evaluate(() => window.__wl), 0, 'wake lock released');
  assert(await page.locator('#tm').isHidden(), 'timer closed');
  console.log('ok  EMOM: uit planning gelezen, aftelling + signalen, pauze, landscape, stop');

  // --- AMRAP: +1 ronde, ends by itself, result editable (partial reps), lands in Actual
  await page.evaluate(() => { window.__beeps.length = 0; });
  await page.click('.piece:has-text("Pull-ups AMRAP") [data-tm="open"]');
  await page.click('[data-tm="start"]');
  await run(10500);
  for (let i = 0; i < 3; i += 1) await page.click('[data-tm="plus"]');
  assert((await txt('#tm-move')).includes('3 rondes'));
  await page.click('[data-tm="minus"]'); await page.click('[data-tm="plus"]');
  await run(720000);
  assert((await txt('#tm')).includes('Klaar'), 'AMRAP ends by itself');
  assert.strictEqual(await page.inputValue('#tm-rounds-res'), '3');
  await page.fill('#tm-reps-res', '12');
  await page.click('[data-tm="save"]');
  assert((await page.inputValue('.piece:has-text("Pull-ups AMRAP") textarea[data-f="actual"]')).includes('3 rondes + 12 reps'), 'AMRAP result in the Actual field');
  console.log('ok  AMRAP: rondes tellen, einde vanzelf, extra reps achteraf, resultaat in Actual');

  // --- For Time: counts up, target signal, Klaar gives the time
  await page.evaluate(() => { window.__beeps.length = 0; });
  await page.click('.piece:has-text("Grace") [data-tm="open"]');
  assert((await txt('#tm')).includes('Time cap 12:00') && (await txt('#tm')).includes('Target 9:00'));
  await page.click('[data-tm="start"]');
  await run(10000 + 125000);
  assert((await txt('#tm-time')) === '2:05', 'counts up ' + await txt('#tm-time'));
  await run(425000);
  assert.strictEqual(await beeps(988), 3, 'target signal (3 short beeps)');
  assert(await page.locator('#tm.tm-over').count() === 1, 'over target is marked');
  await page.click('[data-tm="done"]');
  const t = await page.inputValue('#tm-res'); assert(/^9:1\d$/.test(t) || /^9:0\d$/.test(t) || /^9:2\d$/.test(t), 'final time ' + t);
  await page.fill('#tm-res', '9:14');
  await page.click('[data-tm="save"]');
  assert((await page.inputValue('.piece:has-text("Grace") textarea[data-f="actual"]')).includes('9:14'));
  console.log('ok  For Time: telt op, target-signaal, Klaar geeft de eindtijd (aanpasbaar)');

  // --- Work/rest from the prescription
  await page.click('.piece:has-text("Sled") [data-tm="open"]');
  assert((await txt('#tm')).includes('5 rondes') && (await txt('#tm')).includes("3' werk"));
  await page.click('[data-tm="start"]'); await run(10200);
  assert((await txt('.tm-band')) === 'WERK');
  await run(180000);
  assert((await txt('.tm-band')) === 'RUST' && await page.locator('#tm.tm-k-rest').count() === 1, 'rest phase is red/RUST');
  await page.click('[data-tm="stop"]'); await page.click('[data-tm="drop"]');
  console.log('ok  werk/rust: fases wisselen met duidelijke indicatie');

  // --- Rest bar: tap "Set klaar", rest runs by itself
  await page.evaluate(() => { window.__beeps.length = 0; });
  await page.click('.piece:has-text("Back squat 5x3") [data-tm="setdone"]');
  assert(await page.locator('#tmrest').isVisible() && (await txt('#tmrest')).includes('2:30') && (await txt('#tmrest')).includes('set 1 van 5'));
  await run(100000);
  assert((await txt('#rb-time')).startsWith('0:4') || (await txt('#rb-time')).startsWith('0:5'), 'rest counts down ' + await txt('#rb-time'));
  await run(50500);
  assert.strictEqual(await beeps(880), 3, 'three pips at the end of the rest');
  assert((await txt('#tmrest')).includes('Rust voorbij'));
  assert((await page.textContent('.piece:has-text("Back squat 5x3")')).includes('Set klaar (1/5)'));
  await page.click('[data-tm="rest-close"]');
  console.log('ok  rust na een set: start automatisch, pieptonen, teller 1/5');

  // --- Sound off: no beeps, wake lock unaffected
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('logapp.settings')); s.tmSound = false; localStorage.setItem('logapp.settings', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 1');
  await page.evaluate(() => { window.__beeps.length = 0; });
  await page.click('.piece:has-text("Wall balls EMOM") [data-tm="open"]'); await page.click('[data-tm="start"]'); await run(11000);
  assert.strictEqual(await page.evaluate(() => window.__beeps.filter((x) => x > 0).length), 0, 'sound off: silent');
  await page.click('[data-tm="stop"]'); await page.click('[data-tm="drop"]');
  console.log('ok  geluid uit: geen pieptonen');

  // --- Restore after a reload while a timer is running
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('logapp.settings')); s.tmSound = true; localStorage.setItem('logapp.settings', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 1');
  await page.click('.piece:has-text("Pull-ups AMRAP") [data-tm="open"]'); await page.click('[data-tm="start"]'); await run(30000);
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 1');
  assert(await page.locator('#tm.tm-run').count() === 1, 'running timer comes back after a reload');
  await run(2000);
  console.log('ok  lopende timer overleeft een herstart van de app');

  // --- Standalone timer, not tied to a piece
  await page.evaluate(() => { document.querySelector('#tm [data-tm="close"]')?.click(); });
  await page.click('[data-tm="stop"]').catch(() => {});
  await page.click('[data-tm="drop"]').catch(() => {});
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 1');
  await page.click('header [data-tm="free"]');
  assert(await page.locator('#tm.tm-setup').count() === 1, 'free timer opens the setup');
  await page.selectOption('#tm-type', 'amrap'); await page.fill('#tm-total', '10');
  await page.click('[data-tm="toready"]'); await page.click('[data-tm="start"]'); await run(11000);
  assert(await page.locator('#tm.tm-run').count() === 1);
  await page.click('[data-tm="plus"]'); await page.click('[data-tm="stop"]');
  assert(await page.locator('[data-tm="save"]').count() === 0, 'no save-to-Actual without a piece');
  await page.click('[data-tm="drop"]');
  assert(await page.locator('#tm:not([hidden])').count() === 0, 'closes');
  console.log('ok  losse timer: zonder onderdeel, geen opslag in Actual');

  // --- Lock: no accidental pause/stop, +1 ronde still works, unlock = hold 1 s
  await page.click('header [data-tm="free"]');
  await page.selectOption('#tm-type', 'amrap'); await page.fill('#tm-total', '10');
  await page.click('[data-tm="toready"]'); await page.click('[data-tm="start"]'); await run(11000);
  await page.click('[data-tm="lock"]');
  await page.click('[data-tm="pause"]', { force: true }); await page.click('[data-tm="stop"]', { force: true }).catch(() => {});
  assert(await page.locator('#tm.tm-run:not(.tm-paused)').count() === 1, 'locked: pause/stop do nothing');
  await page.click('[data-tm="plus"]');
  assert((await page.textContent('#tm-move')).startsWith('1'), '+1 ronde works while locked');
  const box = await page.locator('[data-tm="unlock"]').boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await run(400); await page.mouse.up(); await run(800);
  assert(await page.locator('[data-tm="unlock"]').count() === 1, 'short press does not unlock');
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down(); await run(1200); await page.mouse.up();
  assert(await page.locator('[data-tm="lock"]').count() === 1, 'hold unlocks');
  await page.click('[data-tm="stop"]'); await page.click('[data-tm="drop"]');
  console.log('ok  vergrendelen: pauze/stop geblokkeerd, +1 werkt, 1 s ingedrukt ontgrendelt');

  const real = errors.filter((e) => !/ERR_FAILED|status of 400/.test(e));
  assert.deepStrictEqual(real, [], 'console errors: ' + real.join(' | '));
  await browser.close(); server.close();
  console.log('\nE2E4 PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
