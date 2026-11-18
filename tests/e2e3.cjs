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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'] });
  const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const monday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await ctx.addInitScript(({ monday, WB, LED }) => {
    if (localStorage.getItem('logapp.settings')) return;
    localStorage.setItem('logapp.settings', JSON.stringify({ clientId: 'test.apps.googleusercontent.com', sheetId: WB, tab: 'Cycle 3', cycleStarts: { 'Cycle 3': monday }, ledgerId: LED, autoTab: true, timers: false }));
    localStorage.setItem('logapp.token', JSON.stringify({ t: 'tok', exp: Date.now() + 3600e3 }));
  }, { monday, WB, LED });
  await mockGoogle(ctx);
  // scripted Anthropic API
  let mode = 'ok'; let propDag = 'Za';
  await ctx.route('https://api.anthropic.com/**', async (route) => {
    const req = route.request(); const body = JSON.parse(req.postData());
    mock.api.push({ headers: req.headers(), body });
    if (mode === 'credits') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }) });
    const last = body.messages.at(-1).content;
    const text = /VOORSTEL/.test(last) ? `Lichter doen.\n<voorstel>[{"week":1,"dag":"${propDag}","piece":"Back squat 3RM","prescribed":"3 sets van 3 @ 100 kg","reden":"knie"}]</voorstel>`
      : /Geef me je coachreactie/.test(last) ? 'Sterke sessie. **Aandachtspunt**: adem.\n- geen aanpassing'
      : /Antwoord ALLEEN met JSON/.test(last) ? '[{"sectie":"Knie","inhoud":"voorstel: squat vrij"}]'
      : /weekoverzicht/.test(last) ? 'Goede week.' : 'Antwoord op je vraag.';
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 1000, output_tokens: 200 }, stop_reason: 'end_turn' }) });
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base);
  await page.waitForSelector('text=Cycle 3 · Week 1');
  const todayIdx = (await page.$$eval('button.day', (b) => b.findIndex((x) => x.classList.contains('today'))));
  assert(todayIdx >= 0);

  // Fase 1 - without a key: coach tab explains, share works, ramp works, ask is greyed
  await page.click('[data-act="page"][data-p="coach"]');
  assert((await page.textContent('.coachpage')).includes('optioneel'));
  await page.click('[data-act="share"][data-k="day"]');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert(clip.includes('Training Log — Cycle 3') && clip.includes('Back squat'), clip.slice(0, 120));
  await page.click('[data-act="page"][data-p="train"]');
  assert(await page.locator('.piece:has-text("Back squat") [data-act="ask"]').isDisabled(), 'ask greyed without key');
  console.log('ok  fase 1: deel met coach (klembord), vraag-knop grijs zonder sleutel');

  // key in settings
  await page.click('[data-act="settings"]');
  await page.click('summary:has-text("Coach")');
  await page.fill('#f-ckey', 'sk-ant-test'); await page.fill('#f-climit', '1');
  await page.click('[data-act="settings-save"]');
  assert.strictEqual(await page.locator('.piece:has-text("Back squat") [data-act="ask"]').isDisabled(), false);

  // ramp on a piece with an explicit load: add via fake rows? use Back squat 3RM -> no load, so ramp absent
  assert.strictEqual(await page.locator('.piece:has-text("Back squat") [data-act="ramp"]').count(), 0);

  // log whole day -> auto reaction after the last piece
  const names = await page.$$eval('.piece .pname', (els) => els.map((e) => e.firstChild.textContent.trim()));
  for (const n of names) {
    const p = page.locator(`.piece:has-text("${n}")`).first();
    if (!(await p.locator('.form').count())) await p.locator('.ptoggle').click();
    const ta = p.locator('textarea[data-f="actual"]'); if (await ta.count()) await ta.fill('100×5'); 
    if (await p.locator('[data-act="quick"]').count()) await p.locator('[data-act="quick"]').click(); else await p.locator('[data-act="save"]').click();
  }
  await wait(() => page.locator('.askmodal').count().then((n) => n > 0), 'bevestiging voor reactie');
  assert.strictEqual(mock.api.length, 0, 'niets verstuurd voor bevestiging');
  await page.click('[data-act="ask-no"]'); assert.strictEqual(await page.locator('.askmodal').count(), 0); assert.strictEqual(mock.api.length, 0, 'annuleren verstuurt niets');
  await page.click('[data-act="page"][data-p="coach"]'); await page.click('[data-act="coach-day"]'); await page.click('[data-act="ask-go"]');
  await page.click('[data-act="page"][data-p="train"]').catch(() => {});
  await wait(() => page.locator('.coachcard:has-text("Sterke sessie")').count().then((n) => n > 0), 'auto reaction card');
  assert(mock.api[0].headers['x-api-key'] === 'sk-ant-test' && mock.api[0].headers['anthropic-dangerous-direct-browser-access'] === 'true');
  assert(mock.api[0].body.system[0].text.includes('Back squat'), 'context pack in system prompt');
  await wait(() => (books[WB].tabs['Coach log'] || []).length >= 2, 'coach log row');
  { const lg = books[WB].tabs['Coach log']; assert.deepStrictEqual(lg[0], ['Datum', 'Soort', 'Over', 'Vraag', 'Antwoord', 'Voorstellen', 'Model']);
    assert(lg[1][1] === 'Sessie-reactie' && lg[1][4].includes('Sterke sessie') && /^\d{4}-\d\d-\d\d \d\d:\d\d$/.test(lg[1][0])); }
  console.log('ok  fase 2: coach-reactie komt automatisch na de laatste piece, en staat in tab "Coach log"');

  // chat + cost
  await page.click('[data-act="page"][data-p="coach"]');
  await page.fill('#cdraft', 'Leg de squat uit');
  await page.click('[data-act="coach-send"]'); await page.click('[data-act="ask-go"]');
  await wait(() => page.locator('.msg.assistant:has-text("Antwoord op je vraag")').count().then((n) => n > 0), 'chat answer');
  assert((await page.textContent('.coachpage')).includes('$0.0'), 'cost counter');
  console.log('ok  chat + kostenteller');

  // week overview -> memory proposal -> save writes the memory tab
  await page.click('[data-act="coach-week"]'); await page.click('[data-act="ask-go"]');
  await wait(() => page.locator('.coachcard:has-text("wil dit onthouden")').count().then((n) => n > 0), 'memory proposal');
  await page.click('[data-act="mem-save"]');
  await wait(() => (books[WB].tabs['Coach geheugen'] || []).length === 2, 'memory tab written');
  assert.deepStrictEqual(books[WB].tabs['Coach geheugen'][1].slice(0, 2), ['Knie', 'voorstel: squat vrij']);
  assert(mock.added.includes('Coach geheugen'));
  console.log('ok  weekoverzicht -> geheugenvoorstel -> tab "Coach geheugen"');

  // profile
  await page.click('summary:has-text("Mijn profiel")');
  await page.fill('#cp-0', '41, 94 kg'); await page.click('[data-act="prof-save"]');
  await wait(() => (books[WB].tabs['Coach profiel'] || []).length === 7, 'profile tab');
  console.log('ok  profiel bewaard in "Coach profiel"');

  // vraag coach on a piece prefills the chat
  await page.click('[data-act="page"][data-p="train"]');
  await page.click('.piece:has-text("Grace") [data-act="ask"]');
  assert((await page.inputValue('#cdraft')).startsWith('Over "Grace'));
  console.log('ok  "Vraag coach" op een piece vult de vraag in');

  // Fase 3: attach a photo -> request carries an image block + prompt caching on the system prompt
  await page.click('[data-act="page"][data-p="coach"]');
  const png = Buffer.from(await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; const x = c.getContext('2d'); x.fillStyle = '#c33'; x.fillRect(0, 0, 40, 30); return c.toDataURL('image/png').split(',')[1]; }), 'base64');
  await page.setInputFiles('#cfile', { name: 'squat.png', mimeType: 'image/png', buffer: png });
  await wait(() => page.locator('.thumb').count().then((n) => n === 1), 'thumb');
  await page.fill('#cdraft', 'Hoe is mijn diepte?'); const before = mock.api.length;
  await page.click('[data-act="coach-send"]'); await page.click('[data-act="ask-go"]');
  await wait(() => mock.api.length > before, 'api call with image');
  const sent = mock.api.at(-1).body;
  const lastMsg = sent.messages.at(-1).content;
  assert(Array.isArray(lastMsg) && lastMsg[0].type === 'image' && lastMsg[0].source.media_type === 'image/jpeg' && lastMsg[0].source.data.length > 50);
  assert(sent.system[0].cache_control.type === 'ephemeral');
  await wait(() => page.locator('.msg.user:has-text("1 beeld")').count().then((n) => n > 0), 'user msg shows attachment');
  console.log('ok  fase 3: foto meegestuurd als beeld, prompt caching aan');

  // Fase 3: video -> frames (webm made in the browser)
  const webm = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 64; c.height = 48; const x = c.getContext('2d');
    const rec = new MediaRecorder(c.captureStream(20), { mimeType: 'video/webm' }); const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    let i = 0; const iv = setInterval(() => { x.fillStyle = `hsl(${i * 20},70%,50%)`; x.fillRect(0, 0, 64, 48); i++; }, 50);
    rec.start(); await new Promise((r) => setTimeout(r, 1500)); rec.stop(); clearInterval(iv);
    await new Promise((r) => { rec.onstop = r; });
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
    let s = ''; new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); }); return btoa(s);
  });
  await page.setInputFiles('#cfile', { name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(webm, 'base64') });
  await wait(() => page.locator('.thumb').count().then((n) => n === 8), 'eight frames', 15000);
  assert.strictEqual(await page.locator('.thumb small').count(), 8);
  await page.click('[data-act="att-del"][data-i="0"]');
  assert.strictEqual(await page.locator('.thumb').count(), 7);
  await page.fill('#cdraft', 'Check mijn snatch'); const b2 = mock.api.length;
  await page.click('[data-act="coach-send"]'); await page.click('[data-act="ask-go"]');
  await wait(() => mock.api.length > b2, 'api call with frames');
  const fr = mock.api.at(-1).body.messages.at(-1).content;
  assert.strictEqual(fr.filter((x) => x.type === 'image').length, 7);
  assert(fr.at(-1).text.includes('frames uit een video') && fr.at(-1).text.includes('geen snelheid'));
  console.log('ok  fase 3: video -> 8 frames, één verwijderd, 7 beelden + tijdstippen meegestuurd');

  // Fase 4: proposal on an unlogged piece -> apply writes Prescribed only, undo restores
  const other = todayIdx === 5 ? 'Zo' : 'Za'; propDag = other;
  const rowOf = () => books[WB].tabs['Cycle 3'].find((r, i) => i && r[1] == 1 && r[2] === other && r[4] === "Back squat 3RM (20')");
  const orig = rowOf()[6];
  await page.fill('#cdraft', 'VOORSTEL graag'); await page.click('[data-act="coach-send"]'); await page.click('[data-act="ask-go"]');
  await wait(() => page.locator('.coachcard.prop [data-act="prop-apply"]').count().then((n) => n > 0), 'proposal card');
  assert(!mock.writes.some((w) => /!G\d+$/.test(w)), 'nothing written before approval');
  await page.click('[data-act="prop-apply"]');
  await wait(() => rowOf()[6] === '3 sets van 3 @ 100 kg', 'prescribed written');
  assert.strictEqual(rowOf()[9], '', 'no logged columns touched');
  await page.waitForSelector('.coachcard.prop:has-text("toegepast")');
  await page.click('[data-act="prop-undo"]');
  await wait(() => rowOf()[6] === orig, 'undo restored');
  await wait(() => ['Plan aangepast', 'Plan hersteld'].every((k) => (books[WB].tabs['Coach log'] || []).some((r) => r[1] === k)), 'proposal rows in coach log');
  { const r = books[WB].tabs['Coach log'].find((x) => x[1] === 'Plan aangepast'); assert(r[5].includes('3 sets van 3 @ 100 kg') && r[5].includes(orig)); }
  assert(books[WB].tabs['Coach log'].some((r) => r[1] === 'Weekoverzicht'), 'week overview logged');
  console.log('ok  fase 4: voorstel -> Toepassen schrijft Prescribed, Ongedaan maken herstelt, beide in Coach log');

  // Fase 4: proposal for an already logged piece is not applicable
  propDag = DAYS[todayIdx];
  await page.fill('#cdraft', 'VOORSTEL graag'); await page.click('[data-act="coach-send"]'); await page.click('[data-act="ask-go"]');
  await wait(() => page.locator('.coachcard.prop:has-text("al gelogd")').count().then((n) => n > 0), 'logged piece rejected');
  assert.strictEqual(await page.locator('.coachcard.prop:has-text("al gelogd") [data-act="prop-apply"]').count(), 0);
  console.log('ok  fase 4: voorstel voor gelogd onderdeel is niet toepasbaar');

  // credits error: banner, greyed buttons, rest of the app keeps working
  mode = 'credits';
  await page.fill('#cdraft', 'nog een vraag'); await page.click('[data-act="coach-send"]'); await page.click('[data-act="ask-go"]');
  await wait(() => page.locator('.err:has-text("tegoed of limiet")').count().then((n) => n > 0), 'credits banner');
  assert(await page.locator('[data-act="coach-send"]').isDisabled());
  assert.strictEqual(await page.inputValue('#cdraft'), 'nog een vraag', 'question not lost');
  await page.click('[data-act="page"][data-p="records"]');
  assert((await page.textContent('#app')).includes('Back Squat'), 'records still work');
  console.log('ok  tegoed/limiet-fout: banner, knoppen grijs, vraag niet verloren, rest werkt');

  // own limit reached
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('logapp.coach')); c.cost = { month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, usd: 1.5, n: 9, tin: 0, tout: 0 }; localStorage.setItem('logapp.coach', JSON.stringify(c)); });
  await page.reload(); await page.waitForSelector('text=Cycle 3 · Week 1');
  await page.click('[data-act="page"][data-p="coach"]');
  assert((await page.textContent('.coachpage')).includes('eigen maandlimiet'));
  console.log('ok  eigen maandlimiet: coach op pauze met uitleg');

  const real = errors.filter((e) => !/ERR_FAILED|status of 400/.test(e));
  assert.deepStrictEqual(real, [], 'console errors: ' + real.join(' | '));
  await browser.close(); server.close();
  console.log('\nE2E3 PASSED');
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
