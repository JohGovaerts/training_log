import * as Sh from './sheet.js';
import * as Api from './api.js';
import * as Rec from './records.js';
import * as Ld from './loading.js';
import * as Co from './coach.js';
import * as TU from './timerui.js'
import * as In from './insights.js';
import * as Pl from './polar.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

// ---------- persistence ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('logapp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('logapp.' + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};

const S = {
  settings: { clientId: window.LOGAPP_CONFIG?.clientId || '', sheetId: '', sheetTitle: '', tab: '', cycleStarts: {}, ledgerId: '', autoTab: true, timers: true, autoNext: true, barKg: 20, coachKey: '', coachModel: 'claude-sonnet-5-5', coachLang: 'nl', coachLimit: 5, coachUrl: '', coachAuto: true, coachLog: true, tmSound: true, tmVol: 1, tmFlash: true, coachQuick: true, readiness: true, polarUrl: '', polarKey: '', ...LS.get('settings', {}) },
  grids: LS.get('grids', null),         // {tab: {values, ts, sheetId, tab}} last server copy per tab (offline cache)
  grid: null,                           // grid of the active tab
  ledger: LS.get('ledger', null),       // {records, history, ts, ledgerId}
  extrasTs: LS.get('extrasTs', 0), logs: [], page: 'train', recQ: '', recFilter: 'all', recOpen: '', extrasErr: '', extrasBusy: false, formTab: '',
  queue: LS.get('queue', []),           // pending writes
  drafts: LS.get('drafts', {}),         // unsaved form state per piece
  timers: LS.get('timers', { session: null, part: null }),
  dayBad: LS.get('dayBad', {}),
  dismissed: LS.get('dismissed', {}),
  missing: [], cycles: [],
  tabs: [], rows: [], map: null, headerIdx: -1, newHeaders: [], pendingKeys: new Set(),
  pain: { sel: [], score: '' }, ready: { sl: '', sp: '', st: '' }, extra: null, polarDay: {}, polarAutoAt: {}, polarBusy: '', polarHelp: false, move: null, lastMove: null, merged: null,
  err: '', view: LS.get('view', null), open: {}, editSession: false, showSettings: false,
  sync: { state: 'idle', at: null, msg: '' }, syncing: false, again: false, formErr: '',
  coach: { chat: [], cost: null, reactions: {}, err: null, busy: '', profile: null, memory: null, memTs: 0, memProposal: null, draft: '', ramp: {}, ...LS.get('coach', {}), err: null, busy: '', memProposal: null, ramp: {}, att: [] },
};
S.coach.logQ = LS.get('coach', {}).logQ || [];
// A client-ID in config.js always wins over a value saved earlier in this browser.
if (window.LOGAPP_CONFIG?.clientId?.trim()) S.settings.clientId = window.LOGAPP_CONFIG.clientId.trim();

// ---- migrations from the single-tab version ----
(function migrate() {
  const st = S.settings, tab = st.tab;
  if (!st.cycleStarts || typeof st.cycleStarts !== 'object') st.cycleStarts = {};
  if (st.cycleStart) { if (tab && !st.cycleStarts[tab]) st.cycleStarts[tab] = st.cycleStart; delete st.cycleStart; LS.set('settings', st); }
  if (!S.grids) {
    const old = LS.get('grid', null);
    S.grids = old && old.tab ? { [old.tab]: old } : {};
  }
  S.grid = S.grids[tab] || null;
  if (S.ledger && S.ledger.ledgerId !== st.ledgerId) S.ledger = null;
  const pre = (k) => (k.includes('§') ? k : `${tab}§${k}`);
  S.queue = S.queue.map((o) => (o.tab ? o : { ...o, tab, ...(o.key ? { key: pre(o.key) } : {}) }));
  for (const k of Object.keys(S.drafts)) if (!k.includes('§')) { S.drafts[pre(k)] = S.drafts[k]; delete S.drafts[k]; }
  for (const k of Object.keys(S.dayBad)) if (!k.includes('§')) delete S.dayBad[k];
  LS.set('queue', S.queue); LS.set('drafts', S.drafts); LS.set('dayBad', S.dayBad);
})();

const save = {
  settings: () => LS.set('settings', S.settings),
  grid: () => LS.set('grids', S.grids),
  queue: () => LS.set('queue', S.queue),
  drafts: () => LS.set('drafts', S.drafts),
  timers: () => LS.set('timers', S.timers),
  dayBad: () => LS.set('dayBad', S.dayBad),
  dismissed: () => LS.set('dismissed', S.dismissed),
  view: () => LS.set('view', S.view),
  coach: () => LS.set('coach', { logQ: S.coach.logQ, chat: S.coach.chat.slice(-40), cost: S.coach.cost, reactions: S.coach.reactions, profile: S.coach.profile, memory: S.coach.memory, memTs: S.coach.memTs }),
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const configured = () => !!(S.settings.clientId && S.settings.sheetId && S.settings.tab);
const dayKey = (w, d) => `${S.settings.tab}§${w}|${d}`;
const curStart = () => (S.settings.cycleStarts || {})[S.settings.tab] || '';
let toastT;
function toast(msg) { $toast.textContent = msg; $toast.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => $toast.classList.remove('show'), 2600); }

// ---------- data model ----------
function rebuild() {
  S.err = '';
  S.pendingKeys = new Set();
  for (const k of Object.keys(S.grids)) if (S.grids[k].sheetId !== S.settings.sheetId) delete S.grids[k];
  S.logs = Rec.collectLogs(S.grids || {}, S.settings.cycleStarts);
  if (!S.grid) { S.rows = []; S.map = null; return; }
  const g = S.grid.values.map((r) => r.slice());
  const hi = Sh.findHeader(g);
  if (hi < 0) { S.err = 'Geen kopregel gevonden. Dit tabblad moet de kolommen "Week" en "Piece" hebben.'; S.rows = []; S.map = null; return; }
  const { map, newHeaders, missingReq } = Sh.buildColumnMap(g[hi]);
  if (missingReq.length) { S.err = `Kolom(men) ontbreken in de sheet: ${missingReq.join(', ')}`; S.rows = []; S.map = null; return; }
  for (const k of Object.keys(Sh.LAZY_COLS)) if (S.queue.some((o) => (o.tab || S.settings.tab) === S.settings.tab && o.fields && k in o.fields)) Sh.ensureCol(map, [], k);
  S.headerIdx = hi; S.map = map; S.newHeaders = newHeaders;
  const pre = `${S.settings.tab}§`;
  let base = Sh.parseRows(g, hi, map, pre);
  for (const op of S.queue.filter((o) => (o.tab || S.settings.tab) === S.settings.tab)) {
    if (op.type === 'extra') { g.push(Sh.extraRow(map, op.fields)); continue; }
    if (op.type === 'move') {                                  // rows change place: later ops use the new keys
      const pm = Sh.planMove(g, hi, map, op, pre);
      if (pm.moved) { g.splice(0, g.length, ...pm.grid); base = Sh.parseRows(g, hi, map, pre); }
      continue;
    }
    const cells = Sh.planWrites(base, map, op);
    if (cells) { Sh.applyCells(g, cells); S.pendingKeys.add(op.type === 'piece' ? op.key : dayKey(op.week, op.dayIdx)); }
  }
  S.merged = g;                                              // the grid with all queued ops applied (used to plan moves)
  S.rows = Sh.parseRows(g, hi, map, `${S.settings.tab}§`);
  S.missing = Sh.missingExpected(map);
  S.cycles = [...new Set(S.rows.map((r) => r.cycle.trim()).filter(Boolean))];
}

const weeks = () => [...new Set(S.rows.map((r) => r.week))].sort((a, b) => a - b);
const rowsOf = (w, d) => S.rows.filter((r) => r.week === w && r.dayIdx === d);

function initView() {
  const ws = weeks();
  if (!ws.length) return;
  const today = Sh.todayPosition(curStart());
  if (today && ws.includes(today.week)) { S.view = today; return; }
  if (S.view && ws.includes(S.view.week)) return;
  const first = S.rows.find((r) => Sh.status(r) === 'open') || S.rows[0];
  S.view = { week: first.week, dayIdx: Math.max(0, first.dayIdx) };
}

// ---------- drafts ----------
function dayBadFor(it) {
  const k = dayKey(it.week, it.dayIdx);
  if (S.dayBad[k]) return S.dayBad[k];
  const prev = rowsOf(it.week, it.dayIdx).map((r) => Sh.normBad(r.badDay)).filter(Boolean);
  return prev.length ? prev[prev.length - 1] : '';
}
function ensureDraft(it) {
  if (S.drafts[it.key]) return S.drafts[it.key];
  const [pain, after] = Sh.splitPain(it.pain);
  const d = {
    actual: it.actual, splits: it.splits, rpe: it.rpe, badDay: Sh.normBad(it.badDay) || dayBadFor(it),
    pain, after, notes: it.notes, start: it.start, end: it.end,
    durMin: it.dur !== '' && !isNaN(parseFloat(it.dur)) ? parseFloat(it.dur) : null,
    base: { actual: it.actual, splits: it.splits, rpe: it.rpe, badDay: it.badDay, pain: it.pain, notes: it.notes },
  };
  S.drafts[it.key] = d; save.drafts();
  return d;
}
let draftT;
const persistDraftsSoon = () => { clearTimeout(draftT); draftT = setTimeout(save.drafts, 300); };

// ---------- saving ----------
function currentItem(key) { return S.rows.find((r) => r.key === key); }

function buildFields(it, d, extra = {}) {
  const cfg = Sh.fieldsFor(Sh.pieceKind(it));
  const f = { actual: d.actual.trim() };
  if (cfg.splits !== 'hide') f.splits = d.splits.trim();
  if (cfg.rpe) f.rpe = d.rpe.trim();
  if (cfg.badDay) f.badDay = d.badDay;
  if (cfg.pain) f.pain = Sh.joinPain(d.pain, d.after);
  if (cfg.notes) f.notes = d.notes.trim();
  if (d.start || d.end) {
    f.start = d.start || ''; f.end = d.end || '';
    const m = d.durMin ?? Sh.minutesBetweenHM(d.start, d.end);
    f.dur = m == null ? '' : m;
  }
  return Object.assign(f, extra);
}

function commitPiece(key, extra = {}) {
  const it = currentItem(key);
  if (!it) return;
  const d = ensureDraft(it);
  pausePartTimer(key, false);
  const timed = !!(d.tAcc > 0);
  const fields = buildFields(it, d, extra);
  const hasContent = fields.actual || fields.rpe || fields.splits || fields.notes || fields.pain;
  if (!hasContent) { toast('Vul minstens een resultaat in, of kies Skip.'); return; }
  fields.loggedAt = Sh.fmtStamp(Date.now());
  S.queue = S.queue.filter((o) => !(o.type === 'piece' && o.key === key));
  S.queue.push({ type: 'piece', tab: S.settings.tab, key, fields, base: d.base, at: Date.now() });
  if (fields.badDay) { S.dayBad[dayKey(it.week, it.dayIdx)] = fields.badDay; save.dayBad(); }
  delete S.drafts[key]; save.drafts(); save.queue();
  TU.resetSets(key);
  S.open[key] = false;
  rebuild(); render();
  toast('Opgeslagen ✓');
  kickSync(true);
  maybeAutoReact(it.week, it.dayIdx);
  if (timed && S.settings.timers && S.settings.autoNext) {
    const rs = rowsOf(it.week, it.dayIdx);
    const next = rs.slice(rs.findIndex((r) => r.key === key) + 1).find((r) => Sh.status(r) === 'open');
    if (next) startPartTimer(next.key);
  }
}

// Per-piece timer: start / pause / resume. The elapsed time lives in the draft (tAcc = ms
// before the current run, tRun = start of the current run or 0), so a pause never loses anything.
const elapsedMs = (d) => (d.tAcc || 0) + (d.tRun ? Date.now() - d.tRun : 0);
function startPartTimer(key) {
  const running = S.timers.part?.key;
  if (running && running !== key) pausePartTimer(running, false);
  const it = currentItem(key); if (!it) return;
  const d = ensureDraft(it);
  const now = Date.now();
  if (!d.start) d.start = Sh.fmtHM(now);
  d.end = ''; d.tRun = now;
  S.timers.part = { key };
  S.open[key] = true;
  save.timers(); save.drafts(); render();
}
function pausePartTimer(key, doRender = true) {
  const d = S.drafts[key];
  if (S.timers.part?.key === key) S.timers.part = null;
  if (d && d.tRun) {
    d.tAcc = elapsedMs(d); d.tRun = 0;
    d.end = Sh.fmtHM(Date.now());
    d.durMin = Sh.round1(d.tAcc / 60000);
  }
  save.timers(); save.drafts();
  if (doRender) render();
}
function resetPartTimer(key) {
  const d = S.drafts[key]; if (!d) return;
  if (S.timers.part?.key === key) S.timers.part = null;
  d.tAcc = 0; d.tRun = 0; d.start = ''; d.end = ''; d.durMin = null;
  save.timers(); save.drafts(); render();
}

function startSession() {
  S.timers.session = { startMs: Date.now(), tab: S.settings.tab, week: S.view.week, dayIdx: S.view.dayIdx };
  save.timers(); render();
  if (S.settings.timers && S.settings.autoNext) {          // the first open piece starts its timer right away
    const first = rowsOf(S.view.week, S.view.dayIdx).find((r) => Sh.status(r) === 'open');
    if (first) startPartTimer(first.key);
  }
}
function endSession() {
  const t = S.timers.session; if (!t) return;
  if (S.timers.part) pausePartTimer(S.timers.part.key, false);
  S.queue.push({ type: 'session', tab: t.tab || S.settings.tab, week: t.week, dayIdx: t.dayIdx, fields: { sStart: Sh.fmtHM(t.startMs), sEnd: Sh.fmtHM(Date.now()) }, at: Date.now() });
  S.timers.session = null; save.timers(); save.queue();
  rebuild(); render(); toast('Training afgerond ✓'); kickSync(true); polarAfterEnd();
}
function saveSessionTimes(start, end) {
  if (!start || !end) { toast('Vul start en einde in.'); return; }
  S.queue.push({ type: 'session', tab: S.settings.tab, week: S.view.week, dayIdx: S.view.dayIdx, fields: { sStart: start, sEnd: end }, at: Date.now() });
  S.editSession = false; save.queue(); rebuild(); render(); kickSync(true); polarAfterEnd();
}

// ---------- sync ----------
function setSync(state, msg = '') { S.sync = { state, msg, at: state === 'ok' ? Date.now() : S.sync.at }; renderChip(); if (state === 'ok') setTimeout(() => polarAutoToday(), 300); }

function kickSync(gesture = false) {
  // A click is a user gesture: if the token has expired, refresh it silently via popup now.
  if (gesture && S.queue.length && !Api.tokenValid() && S.settings.clientId && navigator.onLine) {
    Api.signIn(S.settings.clientId, { prompt: '' }).then(() => sync(), () => { setSync('login'); });
    return;
  }
  sync();
}

async function refreshMeta() {
  const meta = await Api.getMeta(S.settings.sheetId);
  S.tabs = meta.tabs; S.settings.sheetTitle = meta.title;
  const newest = Sh.cycleTabs(meta.tabs)[0];
  if (S.settings.autoTab && newest && newest !== S.settings.tab && (Sh.cycleNum(newest) ?? -1) > (Sh.cycleNum(S.settings.tab) ?? -1)) {
    S.settings.tab = newest; S.grid = S.grids[newest] || null; S.view = null; S.editSession = false;
    toast(`Nieuwe cyclus: ${newest}`);
  }
  save.settings();
}

async function syncTab(tab) {
  const values = await Api.getValues(S.settings.sheetId, tab);
  const keep = () => {
    S.grids[tab] = { values, ts: Date.now(), sheetId: S.settings.sheetId, tab };
    if (tab === S.settings.tab) S.grid = S.grids[tab];
    save.grid();
  };
  const hi = Sh.findHeader(values);
  if (hi < 0) { keep(); if (tab === S.settings.tab) { rebuild(); throw new Error(S.err); } return { stuck: 0, added: [], done: 0 }; }
  const { map, newHeaders } = Sh.buildColumnMap(values[hi]);
  for (const k of Object.keys(Sh.LAZY_COLS)) if (S.queue.some((o) => (o.tab || S.settings.tab) === tab && o.fields && k in o.fields)) Sh.ensureCol(map, newHeaders, k);
  const pre = `${tab}§`;
  let rows = Sh.parseRows(values, hi, map, pre);
  const cells = [], done = [];
  const ops = S.queue.filter((o) => (o.tab || S.settings.tab) === tab);
  for (const h of newHeaders) cells.push({ row: hi + 1, col: h.col, value: h.title });
  const flush = async () => {
    if (!cells.length) return;
    await Api.batchUpdate(S.settings.sheetId, cells.map((c) => ({ range: Sh.a1(tab, c.row, c.col), values: [[c.value]] })));
    Sh.applyCells(values, cells); cells.length = 0;
  };
  let sheetNum = null, droppedMoves = 0;
  for (const op of ops) {
    if (op.type === 'move') {                                   // strictly in order: writes first, then the row moves
      await flush();
      const pm = Sh.planMove(values, hi, map, op, pre);
      droppedMoves += pm.skipped.length;
      if (pm.moved) {
        await Api.batchUpdate(S.settings.sheetId, pm.cells.map((c) => ({ range: Sh.a1(tab, c.row, c.col), values: [[c.value]] })));
        if (pm.moves.length) {
          if (sheetNum == null) sheetNum = (await Api.getMeta(S.settings.sheetId)).ids[tab];
          await Api.moveRows(S.settings.sheetId, sheetNum, pm.moves);
        }
        values.splice(0, values.length, ...pm.grid);
        rows = Sh.parseRows(values, hi, map, pre);
      }
      done.push(op); continue;
    }
    if (op.type === 'extra') {
      await flush();
      const row = Sh.extraRow(map, op.fields);
      await Api.appendRows(S.settings.sheetId, tab, [row]); values.push(row);
      done.push(op); continue;
    }
    const c = Sh.planWrites(rows, map, op);
    if (!c) { op.error = 'Rij niet meer gevonden in de sheet'; continue; }
    if (op.type === 'piece') {
      const row = rows.find((r) => r.key === op.key);
      const conflicts = Sh.findConflicts(row, op);
      if (conflicts.length && !window.confirm(`"${row.piece}" is intussen in de sheet aangepast (${conflicts.join(', ')}). Overschrijven met jouw invoer?`)) {
        done.push(op); continue;
      }
    }
    delete op.error; cells.push(...c); done.push(op);
  }
  await flush();
  if (droppedMoves) toast(`${droppedMoves} onderdeel(en) niet verplaatst: al gelogd in de sheet`);
  keep();
  S.queue = S.queue.filter((o) => !done.includes(o)); save.queue();
  return { stuck: ops.filter((o) => o.error).length, added: newHeaders, done: done.length };
}

async function sync() {
  if (!configured()) return;
  if (S.syncing) { S.again = true; return; }
  if (!navigator.onLine) { setSync('offline'); return; }
  if (!Api.tokenValid()) { setSync('login'); return; }
  S.syncing = true; setSync('syncing');
  let ok = false;
  try {
    await refreshMeta();
    const cur = S.settings.tab;
    const tabs = [...new Set([cur, ...S.queue.map((o) => o.tab || cur)])];
    let stuck = 0, added = [], done = 0;
    for (const t of tabs) { const r = await syncTab(t); stuck += r.stuck; if (t === cur) added = r.added; done += r.done; }
    if (added.length && !done) toast(`Kolommen toegevoegd: ${added.map((h) => h.title).join(', ')}`);
    setSync(stuck ? 'error' : 'ok', stuck ? `${stuck} wijziging(en) konden niet geschreven worden: rij niet gevonden` : '');
    ok = true;
  } catch (e) {
    if (e instanceof Api.AuthError) setSync('login');
    else if (e instanceof Api.NetError) setSync(S.queue.length ? 'queued' : 'offline');
    else if (e instanceof Api.ApiError) setSync('error', e.status === 403 ? `Geweigerd door Google (403): ${e.message}` : e.status === 404 ? 'Sheet of tabblad niet gevonden.' : e.message);
    else setSync('error', e.message);
  } finally {
    S.syncing = false;
    rebuild();
    if (!S.view || !weeks().includes(S.view.week)) initView();
    renderSoft();
    if (S.again) { S.again = false; sync(); }
    else if (ok) refreshExtras();
  }
}

// Ledger + the other cycle tabs: read-only context for Records and "last score".
const EXTRAS_TTL = 6 * 3600e3;
async function refreshExtras(force = false) {
  if (S.extrasBusy || !configured() || !navigator.onLine || !Api.tokenValid()) return;
  if (!force && Date.now() - S.extrasTs < EXTRAS_TTL && (S.ledger || !S.settings.ledgerId)) return;
  S.extrasBusy = true; S.extrasErr = ''; if (S.page === 'records') renderSoft();
  try {
    for (const t of Sh.cycleTabs(S.tabs)) {
      if (t === S.settings.tab) continue;
      const values = await Api.getValues(S.settings.sheetId, t);
      S.grids[t] = { values, ts: Date.now(), sheetId: S.settings.sheetId, tab: t };
    }
    save.grid();
    if (S.settings.ledgerId) {
      const id = S.settings.ledgerId;
      const meta = await Api.getMeta(id);
      const find = (re, not) => meta.tabs.find((t) => re.test(t) && !(not && not.test(t)));
      const tl = find(/pr ledger/i, /benchmark/i), ts = find(/summary/i), th = find(/history/i);
      const get = async (t) => (t ? Api.getValues(id, t) : []);
      const [ledger, summary, history] = [await get(tl), await get(ts), await get(th)];
      if (!ledger.length && !summary.length) throw new Error('Geen tabbladen "PR Ledger" of "Benchmark Tracker - Summary" gevonden in dit bestand.');
      S.ledger = { ...Rec.buildRecords({ ledger, summary, history }), ts: Date.now(), ledgerId: id };
      LS.set('ledger', S.ledger);
    }
    S.extrasTs = Date.now(); LS.set('extrasTs', S.extrasTs);
  } catch (e) {
    S.extrasErr = e instanceof Api.ApiError ? (e.status === 404 ? 'Ledger-bestand niet gevonden of geen toegang.' : e.message) : e.message;
  } finally {
    S.extrasBusy = false; rebuild(); renderSoft();
  }
}

function switchTab(tab, manual = true) {
  if (!tab || tab === S.settings.tab) return;
  S.settings.tab = tab;
  if (manual) S.settings.autoTab = tab === Sh.cycleTabs(S.tabs)[0];
  save.settings();
  S.grid = S.grids[tab] || null; S.view = null; S.editSession = false;
  rebuild(); initView(); render(); sync();
}

function syncChip() {
  const q = S.queue.length;
  switch (S.sync.state) {
    case 'syncing': return '<span class="chip">⟳ Synchroniseren…</span>';
    case 'ok': return `<span class="chip ok">✓ ${S.sync.at ? Sh.fmtHM(S.sync.at) : 'Gesynchroniseerd'}</span>`;
    case 'queued': return `<span class="chip warn">⏳ ${q} in wachtrij</span>`;
    case 'offline': return `<span class="chip warn">Offline${q ? ` · ${q} in wachtrij` : ''}</span>`;
    case 'login': return `<button class="chip action" data-act="login">Inloggen${q ? ` · ${q} wachten` : ''}</button>`;
    case 'error': return `<span class="chip bad" title="${esc(S.sync.msg)}">⚠ ${esc(S.sync.msg || 'Fout')}</span>`;
    default: return q ? `<span class="chip warn">⏳ ${q}</span>` : '';
  }
}
function renderChip() { const el = document.getElementById('chip'); if (el) el.innerHTML = syncChip(); }

// ---------- rendering ----------
const typing = () => /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') && $app.contains(document.activeElement);
function renderSoft() { if (typing()) renderChip(); else render(); }

function render() {
  if (!configured()) { $app.innerHTML = settingsHTML(true); return; }
  $app.innerHTML = mainHTML() + (S.showSettings ? settingsHTML(false) : '') + extraHTML() + moveHTML() + askHTML();
  tick();
}

// Every API call to the coach is confirmed first: what is sent, how many requests, which model.
function askCall({ title, body, n = 1, run, extraChars = 800, model = '', history = false }) {
  if (S.coach.busy) return;
  S.ask = { title, body, n, run, model: model || S.settings.coachModel, est: estTokens(extraChars, { history }) }; render();
}
function estTokens(extraChars, { history = false } = {}) {
  const context = S.view ? Co.contextPack({ tab: S.settings.tab, rows: S.rows, week: S.view.week, dayIdx: S.view.dayIdx }) : '';
  const system = Co.systemPrompt({ lang: coachLang(), profile: S.coach.profile || [], memory: S.coach.memory || [], context });
  const prior = history ? S.coach.chat.slice(-12).reduce((a, m) => a + String(m.content || '').length, 0) : 0;
  return In.estTokens(system.length + prior + extraChars);
}
const askCost = (a) => { const m = Co.MODELS[a.model] || Co.MODELS['claude-sonnet-5-5']; return a.n * (a.est * m.inUsd + 500 * m.outUsd) / 1e6; };
function askHTML() {
  const a = S.ask; if (!a) return '';
  return `<div class="sheetmodal askmodal"><div><h2>${esc(a.title)}</h2><p>${esc(a.body)}</p><p class="hint">${a.n} aanvraag${a.n > 1 ? 'en' : ''} naar de coach · ${esc(a.model)} · ongeveer ${(a.est * a.n).toLocaleString('nl-BE')} tokens invoer, kost ± ${Co.fmtUsd(askCost(a))} · telt mee voor je maandlimiet.</p><div class="row2"><button class="btn" data-act="ask-no">Annuleer</button><button class="btn primary" data-act="ask-go">Verstuur</button></div></div></div>`;
}

function mainHTML() {
  if (S.page === 'records') return topHTML() + recordsHTML();
  if (S.page === 'coach') return topHTML() + coachHTML();
  if (S.err) return topHTML() + `<div class="setup"><div class="err">${esc(S.err)}</div><button class="btn" data-act="settings">Instellingen</button></div>`;
  if (!S.rows.length) return topHTML() + `<div class="rest"><b>Nog geen planning geladen</b>${S.sync.state === 'login' ? 'Log in om de sheet te laden.' : 'Even geduld…'}</div>`;
  const { week, dayIdx } = S.view;
  if (S.page === 'week') return topHTML() + weekHTML();
  return topHTML() + noticeHTML() + undoBarHTML() + painBarHTML() + readyBarHTML() + polarCardHTML(week, dayIdx, rowsOf(week, dayIdx)) + sessionBannerHTML() + dayHTML(week, dayIdx);
}

function noticeHTML() {
  const msgs = [];
  if (S.missing.length) msgs.push(`Sheet wijkt af van het contract: kolom ${S.missing.join(', ')} ontbreekt (de app werkt gewoon door).`);
  if (S.cycles.length > 1) msgs.push(`Dit tabblad bevat meerdere cycli (${S.cycles.join(', ')}); de app toont ze door elkaar.`);
  const key = `${S.settings.sheetId}|${msgs.join('|')}`;
  const newest = Sh.cycleTabs(S.tabs)[0];
  const newer = newest && newest !== S.settings.tab && (Sh.cycleNum(newest) ?? -1) > (Sh.cycleNum(S.settings.tab) ?? -1)
    ? `<div class="notice"><span>🆕 ${esc(newest)} staat klaar.</span><button class="link2" data-act="tab-newest">Openen</button></div>` : '';
  if (!msgs.length || S.dismissed[key]) return newer;
  return newer + `<div class="notice"><span>ℹ ${esc(msgs.join(' '))}</span><button data-act="dismiss" data-key="${esc(key)}" aria-label="Sluiten">✕</button></div>`;
}

function topHTML() {
  const { week, dayIdx } = S.view || { week: 1, dayIdx: 0 };
  const ws = weeks();
  const today = Sh.todayPosition(curStart());
  const d0 = Sh.dateFor(curStart(), week, 0), d6 = Sh.dateFor(curStart(), week, 6);
  const range = d0 ? `${d0.getDate()}/${d0.getMonth() + 1} – ${d6.getDate()}/${d6.getMonth() + 1}` : '';
  const tabs = Sh.DAYS.map((lbl, i) => {
    const rs = rowsOf(week, i);
    const cls = !rs.length ? 'off' : rs.every((r) => Sh.status(r) !== 'open') ? 'done' : rs.some((r) => Sh.status(r) !== 'open') ? 'part' : '';
    const dt = Sh.dateFor(curStart(), week, i);
    const isToday = today && today.week === week && today.dayIdx === i;
    return `<button class="day ${cls} ${i === dayIdx ? 'sel' : ''} ${isToday ? 'today' : ''}" data-act="day" data-i="${i}" aria-label="${Sh.DAYS_LONG[i]}">${lbl}<small>${dt ? dt.getDate() : '·'}</small><i></i></button>`;
  }).join('');
  const ct = Sh.cycleTabs(S.tabs);
  const titleEl = ct.length > 1 || (ct.length === 1 && S.tabs.length > 1 && !ct.includes(S.settings.tab))
    ? `<select class="tabsel" id="tabsel" aria-label="Cyclus">${[...new Set([...ct, S.settings.tab])].map((t) => `<option ${t === S.settings.tab ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`
    : `<h1>${esc(S.settings.sheetTitle || 'Training Log')}</h1>`;
  const train = S.page === 'train';
  return `<header class="top">
    <div class="bar">${titleEl}<span id="chip">${syncChip()}</span>
      <button class="iconbtn" data-tm="free" aria-label="Losse timer">⏲</button>
      <button class="iconbtn" data-act="refresh" aria-label="Verversen">↻</button>
      <button class="iconbtn" data-act="settings" aria-label="Instellingen">⚙</button></div>
    <div class="seg"><button class="${train ? 'on' : ''}" data-act="page" data-p="train">Training</button><button class="${S.page === 'records' ? 'on' : ''}" data-act="page" data-p="records">Records</button><button class="${S.page === 'week' ? 'on' : ''}" data-act="page" data-p="week">Week</button><button class="${S.page === 'coach' ? 'on' : ''}" data-act="page" data-p="coach">Coach</button></div>
    ${(train || S.page === 'week') && S.view ? `<div class="weeknav"><button class="iconbtn" data-act="week" data-d="-1" ${week <= ws[0] ? 'disabled' : ''} aria-label="Vorige week">‹</button>
      <div><b>${S.cycles.length === 1 ? `Cycle ${esc(S.cycles[0])} · ` : ''}Week ${week}</b><small>${range}</small></div>
      <button class="iconbtn" data-act="week" data-d="1" ${week >= ws[ws.length - 1] ? 'disabled' : ''} aria-label="Volgende week">›</button></div>` : ''}
    ${train && S.view ? `<nav class="days">${tabs}</nav>` : ''}
  </header>`;
}

function sessionBannerHTML() {
  const t = S.timers.session;
  if (!t) return '';
  return `<div class="banner">⏱ <span class="t" data-tick="session" data-since="${t.startMs}">00:00</span>
    <small>${Sh.DAYS[t.dayIdx]} W${t.week}</small><button data-act="sess-end">■ Einde</button></div>`;
}

function dayHTML(week, dayIdx) {
  const rs = rowsOf(week, dayIdx);
  const dt = Sh.dateFor(curStart(), week, dayIdx);
  const title = `${Sh.DAYS_LONG[dayIdx]}${dt ? ` ${dt.getDate()}/${dt.getMonth() + 1}` : ''}`;
  if (!rs.length) {
    return `<div class="dayhead"><h2>${title}</h2></div><div class="daytools"><button class="btn" data-act="extra-open">＋ Extra sessie of les</button></div><div class="rest"><b>Rustdag 😴</b>Niets gepland. Herstel, slaap en eet goed.</div>`;
  }
  const focus = rs[0].focus;
  const optional = /optioneel/i.test(focus);
  const done = rs.filter((r) => Sh.status(r) !== 'open').length;
  const sess = rs.find((r) => r.sStart && r.sEnd);
  const running = S.timers.session && S.timers.session.week === week && S.timers.session.dayIdx === dayIdx;
  let sessHTML = '';
  if (S.timers.session && !running) sessHTML = '';
  else if (running) sessHTML = '';
  else if (S.editSession) {
    sessHTML = `<div class="session form" style="border:0;padding:0"><div class="row2"><label>Start<input type="time" id="sStart" value="${esc(sess?.sStart || '')}"></label><label>Einde<input type="time" id="sEnd" value="${esc(sess?.sEnd || '')}"></label></div>
      <button class="btn primary" data-act="sess-save">Opslaan</button></div>`;
  } else if (sess) {
    const m = Sh.minutesBetweenHM(sess.sStart, sess.sEnd);
    sessHTML = `<div class="session">⏱ Sessie ${esc(sess.sStart)} – ${esc(sess.sEnd)}${m != null ? ` · ${m} min` : ''}<button class="iconbtn" data-act="sess-edit" aria-label="Tijden aanpassen">✎</button></div>`;
  } else if (S.settings.timers) {
    sessHTML = `<div class="session"><button class="go" data-act="sess-start">▶ Start training</button><button class="btn link" data-act="sess-edit">tijden invullen</button></div>`;
  }
  const firstOpen = rs.find((r) => Sh.status(r) === 'open');
  const tm = In.dayTimes(rs);
  const timeTxt = tm.planned ? ` · gepland ${tm.planned}'${tm.real != null ? ` · <b class="tm-${In.overTone(tm.planned, tm.real)}">echt ${tm.real}'</b>` : ''}` : '';
  return `<div class="dayhead"><h2>${title}${optional ? '<span class="badge">optioneel</span>' : ''}</h2><p>${esc(focus)} · ${done}/${rs.length} gelogd${timeTxt}</p></div>
    ${(rs.find((r) => r.readiness) || {}).readiness ? `<div class="readyline">🔋 ${esc(rs.find((r) => r.readiness).readiness)}</div>` : ''}
    ${polarLineHTML(week, dayIdx, rs)}
    <div class="daytools"><button class="btn" data-act="gym-open">🏋 Gym-modus</button><button class="btn" data-act="extra-open">＋ Extra sessie of les</button><button class="btn" data-act="move-open">↔ Verplaats</button></div>
    ${sessHTML}${rs.map((r) => pieceHTML(r, S.open[r.key] ?? (firstOpen && firstOpen.key === r.key))).join('')}${coachDayHTML(week, dayIdx, rs)}`;
}

function pieceHTML(it, open) {
  const st = Sh.status(it);
  const pending = S.pendingKeys.has(it.key);
  const label = pending ? '⏳ wacht op sync' : st === 'done' ? '✓ gelogd' : st === 'skipped' ? 'overgeslagen' : '';
  const timerBtn = S.settings.timers ? partTimerBtn(it) : '';
  const summary = [it.actual, it.rpe && `RPE ${it.rpe}`, it.pain].filter(Boolean).join(' · ');
  const showDemo = /^https?:\/\//i.test(it.demo.trim());
  return `<article class="piece ${st} ${pending ? 'pending' : ''}" data-key="${esc(it.key)}">
    <div class="phead"><button class="ptoggle" data-act="toggle" data-key="${esc(it.key)}" aria-expanded="${!!open}">
      <div class="pname">${esc(it.piece)} <span class="pstat">${label}</span></div></button>${timerBtn}</div>
    <div class="pbody"><div class="rx">${esc(it.prescribed)}</div>
      ${it.intent ? `<div class="intent">${esc(it.intent)}</div>` : ''}
      ${calcHTML(it)}
      ${pieceActionsHTML(it)}
      ${lastHTML(it)}
      ${showDemo ? `<a class="demo" href="${esc(it.demo.trim())}" target="_blank" rel="noopener">▶ Demo</a>` : ''}
      ${st !== 'open' && !open ? `<div class="result">${esc(summary || '—')}<small>${it.loggedAt ? `gelogd ${esc(it.loggedAt)}` : ''}${it.start ? ` · ${esc(it.start)}–${esc(it.end)}${it.dur ? ` (${esc(it.dur)} min)` : ''}` : ''}</small></div>` : ''}
    </div>${open ? formHTML(it) : ''}</article>`;
}

function loadsHTML(it) {
  const bar = S.settings.barKg || 20;
  const ls = Ld.loadsFor(it, { bar });
  if (!ls.length) return '';
  return `<div class="calc">🧮 Stang ${bar} kg, per kant:${ls.map((l) => `<br><b>${Ld.fmtKg(l.kg)} kg</b> → ${l.perSide.map(Ld.fmtKg).join(' · ')}${l.exact ? '' : ` <small>(dichtst haalbaar: ${Ld.fmtKg(l.loaded)} kg)</small>`}`).join('')}</div>`;
}

function calcHTML(it) {
  const cs = Ld.calcsFor(it, S.rows, { bar: S.settings.barKg || 20 });
  if (!cs.length) return loadsHTML(it);
  return cs.map((c) => {
    if (c.missing) return `<div class="calc warn">🧮 ${c.pct}% van wk ${c.week}: ${esc(c.why)}</div>`;
    const load = c.barbell
      ? (c.belowBar ? `<small>Lichter dan de stang (${c.bar} kg).</small>`
        : `<small>Stang ${c.bar} kg + per kant: <b>${c.perSide.length ? c.perSide.map(Ld.fmtKg).join(' · ') : 'niets'}</b>${c.exact ? '' : ` (dichtst haalbaar: ${Ld.fmtKg(c.loaded)} kg)`}</small>`)
      : '';
    return `<div class="calc">🧮 ${c.pct}% van wk ${c.week} (${Ld.fmtKg(c.refKg)} kg) = ${Ld.fmtKg(c.raw)} → <b>${Ld.fmtKg(c.target)} kg</b>${load ? `<br>${load}` : ''}</div>`;
  }).join('');
}

function partTimerBtn(it) {
  const k = esc(it.key), d = S.drafts[it.key];
  const tick = (acc, run) => `<span data-tick="part" data-acc="${acc}" data-run="${run}">00:00</span>`;
  if (d && d.tRun) return `<button class="tbtn run" data-act="ptimer" data-key="${k}" aria-label="Pauzeer timer">⏸ ${tick(d.tAcc || 0, d.tRun)}</button>`;
  if (d && d.tAcc) return `<button class="tbtn paused" data-act="ptimer" data-key="${k}" aria-label="Hervat timer">▶ ${tick(d.tAcc, 0)}</button>`;
  if (!d && Sh.status(it) !== 'open') return it.dur ? `<span class="tbtn done" title="Gelogde duur">✓ ${esc(it.dur)} min</span>` : '';
  return `<button class="tbtn" data-act="ptimer" data-key="${k}" aria-label="Start timer">⏱</button>`;
}

function formHTML(it) {
  const d = ensureDraft(it);
  const cfg = Sh.fieldsFor(Sh.pieceKind(it));
  const k = esc(it.key);
  const chips = (field, vals, cur) => `<div class="chips" data-chips="${field}">${vals.map((v) => `<button type="button" data-act="chip" data-field="${field}" data-v="${esc(v)}" class="${String(cur).trim() === v ? 'on' : ''}">${esc(v)}</button>`).join('')}</div>`;
  const wantsAfter = cfg.pain && /knie|dag erna|schouder/i.test(`${it.intent} ${it.prescribed}`) && cfg.splits !== 'hide';
  const dur = d.durMin ?? Sh.minutesBetweenHM(d.start, d.end);
  return `<div class="form" data-form="${k}">
    ${cfg.quick ? `<button class="btn primary big" data-act="quick" data-key="${k}">✓ ${cfg.quick}</button>` : ''}
    <label>${cfg.actualLabel}<textarea rows="2" data-f="actual" autocomplete="off">${esc(d.actual)}</textarea></label>
    ${cfg.rpe ? `<div class="lbl">RPE${chips('rpe', ['5', '6', '7', '8', '9', '10'], d.rpe)}<input data-f="rpe" value="${esc(d.rpe)}" placeholder="bv. 8 of 8-9" inputmode="text" autocomplete="off"></div>` : ''}
    ${cfg.splits === 'show' ? `<label>Rep splits<textarea rows="2" data-f="splits" placeholder="bv. 8/6/4 per ronde">${esc(d.splits)}</textarea></label>` : ''}
    ${cfg.splits === 'more' ? `<details ${d.splits ? 'open' : ''}><summary>+ Rep splits</summary><textarea rows="2" data-f="splits" placeholder="bv. 5/3/2 per set">${esc(d.splits)}</textarea></details>` : ''}
    ${cfg.badDay ? `<div class="lbl">Slechte dag?<div class="chips" data-chips="badDay">${['Neen', 'Misschien', 'Ja'].map((v) => `<button type="button" data-act="chip" data-field="badDay" data-v="${v}" class="${d.badDay === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>` : ''}
    ${cfg.pain ? `<div class="lbl">Pijn / knie / schouder${chips('pain', ['Geen pijn', 'Lichte last', 'Pijn'], d.pain)}<input data-f="pain" value="${esc(d.pain)}" placeholder="tijdens de oefening" autocomplete="off"></div>` : ''}
    ${wantsAfter ? `<label>Dag erna (knie/schouder)<input data-f="after" value="${esc(d.after)}" placeholder="vul morgen aan" autocomplete="off"></label>` : ''}
    ${cfg.notes ? `<label>Notities<textarea rows="2" data-f="notes">${esc(d.notes)}</textarea></label>` : ''}
    ${S.settings.timers ? `<details ${d.start || d.end ? 'open' : ''}><summary>Tijd${dur != null ? ` · ${dur} min` : ' (optioneel)'}</summary>
      <div class="row2"><label>Start<input type="time" data-f="start" value="${esc(d.start)}"></label><label>Einde<input type="time" data-f="end" value="${esc(d.end)}"></label></div>
      ${d.tAcc || d.tRun ? `<button type="button" class="btn link" data-act="treset" data-key="${k}">Timer op nul zetten</button>` : ''}</details>` : ''}
    <div class="actions"><button class="btn primary" data-act="save" data-key="${k}">Opslaan</button>
      <button class="btn" data-act="skip" data-key="${k}">Skip</button><button class="btn link" data-act="close" data-key="${k}">Sluiten</button></div>
  </div>`;
}

// ---------- records & last score ----------
const pctTxt = (ratio) => {
  const x = Math.abs((ratio - 1) * 100).toFixed(1).replace('.', ',');
  return ratio >= 0.9995 && ratio <= 1.0005 ? 'gelijk aan PB' : ratio < 1 ? `${x}% onder PB` : `${x}% boven PB`;
};
const ageTxt = (iso) => { const m = Rec.monthsSince(iso); return m == null ? '' : m < 1 ? '< 1 mnd' : m < 24 ? `${Math.round(m)} mnd` : `${(m / 12).toFixed(1).replace('.', ',')} jaar`; };
const refTxt = (rec, ref) => (ref ? `${ref.kind === 'est' ? 'schatting ' : 'PB '}${Rec.fmtValue(rec, ref)}${ref.date ? ` · ${Rec.fmtDateNL(ref.date)}` : ''}` : '');

function prevHTML(it) {
  const kind = Sh.pieceKind(it);
  if (kind === 'warmup' || kind === 'mobility') return '';
  const p = In.prevLog(S.logs, it, S.settings.tab); if (!p) return '';
  const first = p.actual.split('\n')[0].slice(0, 90);
  const bits = [p.date && Rec.fmtDateNL(p.date), p.rpe && `RPE ${p.rpe}`, ['Ja', 'Misschien'].includes(p.badDay) && 'slechte dag'].filter(Boolean).join(' · ');
  return `<div class="last"><span class="k">Vorige keer</span> <b>${esc(first)}</b> <small>${esc(bits)}</small></div>`;
}
function lastHTML(it) {
  const r = recLastHTML(it);
  return r.includes('Vorige keer') ? r : r + prevHTML(it);
}
function recLastHTML(it) {
  if (!S.ledger || !S.ledger.records) return '';
  const rec = Rec.recordFor(it.piece, it.benchmark, S.ledger.records);
  if (!rec) return '';
  const { last, ref } = Rec.lastFor(rec, { history: S.ledger.history, logs: S.logs, records: S.ledger.records, exclude: { tab: S.settings.tab, key: it.key } });
  const refLine = refTxt(rec, ref);
  if (!last) return refLine ? `<div class="last"><span class="k">Record</span> <b>${esc(refLine)}</b></div>` : '';
  const v = last.verdict;
  const bits = [last.date && Rec.fmtDateNL(last.date), last.rx, last.rpe && `RPE ${last.rpe}`].filter(Boolean).join(' · ');
  return `<div class="last"><span class="k">Vorige keer</span> <b>${esc(last.num != null && rec.lowerBetter ? Rec.fmtTime(last.num) : last.raw)}</b> <small>${esc(bits)}</small>
    <span class="tag ${v.tone}">${esc(v.label)}</span>
    <small class="sub">${esc(refLine)}${last.ratio != null ? ` · ${pctTxt(last.ratio)}` : ''}${v.lowerBound ? ' · ondergrens' : ''}</small></div>`;
}

function recordRows() {
  const recs = S.ledger.records;
  const q = S.recQ.trim().toLowerCase();
  const out = [];
  for (const r of recs) {
    if (q && !`${r.label} ${r.group}`.toLowerCase().includes(q)) continue;
    const past = Rec.pastResults(r, { history: S.ledger.history, logs: S.logs, records: recs });
    const conf = Rec.confidence(r, { past });
    if (S.recFilter === 'low' && !(conf.pct != null && conf.pct < 40)) continue;
    out.push({ r, past, conf });
  }
  return out;
}

function recDetailHTML({ r, past, conf }) {
  const line = (k, v) => (v ? `<tr><th>${k}</th><td>${v}</td></tr>` : '');
  const cell = (x) => (x ? `${esc(Rec.fmtValue(r, x))}${x.date ? ` <small>${esc(Rec.fmtDateNL(x.date))} · ${ageTxt(x.date)}</small>` : x.dateRaw ? ` <small>${esc(x.dateRaw)}</small>` : ''}` : '');
  const hist = past.slice(0, 12).map((p) => `<li><span>${esc(p.date ? Rec.fmtDateNL(p.date) : '—')}</span> <b>${esc(p.num != null && r.lowerBetter ? Rec.fmtTime(p.num) : p.raw)}</b>
    <small>${[p.rx, p.rpe && `RPE ${p.rpe}`, p.source === 'app' ? 'app' : ''].filter(Boolean).map(esc).join(' · ')}</small>
    <span class="tag ${p.verdict.tone}">${esc(p.verdict.label)}</span></li>`).join('');
  return `<div class="recdetail"><table>
      ${line('Huidig', cell(r.current))}${line('Geschat', r.est ? esc(r.est.raw) : '')}${line('All-time', cell(r.allTime))}${r.rx ? line('Rx/Sc', esc(r.rx)) : ''}
    </table>
    ${conf.pct != null ? `<div class="conf"><div class="meter"><i style="width:${conf.pct}%" class="${conf.label}"></i></div>
      <b>Betrouwbaarheid ${conf.pct}%</b> <small>(${conf.label}, indicatie)</small>
      <ul class="why">${conf.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    ${r.note ? `<p class="note">${esc(r.note)}</p>` : ''}
    ${hist ? `<h4>Historiek</h4><ul class="hist">${hist}</ul>` : '<p class="note">Nog geen losse metingen. Geef het stuk in je sheet een Benchmark-sleutel om resultaten hier te verzamelen.</p>'}
  </div>`;
}

function recListHTML() {
  const rows = recordRows();
  if (!rows.length) return '<div class="rest"><b>Niets gevonden</b>Pas de zoekterm of filter aan.</div>';
  let html = '', group = null;
  for (const row of rows) {
    const { r, conf } = row;
    if (r.group !== group) { group = r.group; html += `<h3 class="grp">${esc(group)}</h3>`; }
    const ref = Rec.reference(r);
    const open = S.recOpen === r.id;
    html += `<div class="rec ${open ? 'open' : ''}"><button class="rechead" data-act="rec" data-id="${esc(r.id)}" aria-expanded="${open}">
      <span class="rn">${esc(r.label)}${r.rx && r.rx !== 'Rx' ? ` <small>${esc(r.rx)}</small>` : ''}</span>
      <span class="rv"><b>${ref ? esc(Rec.fmtValue(r, ref)) : '—'}</b><small>${ref && ref.kind === 'est' ? 'schatting' : ref && ref.date ? ageTxt(ref.date) : ''}</small></span>
      ${conf.pct != null ? `<span class="pill ${conf.label}">${conf.pct}%</span>` : ''}</button>${open ? recDetailHTML(row) : ''}</div>`;
  }
  return html;
}

function recordsHTML() {
  if (!S.settings.ledgerId) {
    return `<div class="setup"><h1>Records</h1><p>Koppel je PR Ledger om je records, de historiek en de betrouwbaarheid te zien.</p><button class="btn primary" data-act="settings">Ledger koppelen</button></div>`;
  }
  const head = `<div class="recbar"><input id="recq" type="search" placeholder="Zoek (bv. squat, Fran, row)" value="${esc(S.recQ)}" autocomplete="off">
    <div class="chips"><button data-act="recfilter" data-v="all" class="${S.recFilter === 'all' ? 'on' : ''}">Alles</button><button data-act="recfilter" data-v="low" class="${S.recFilter === 'low' ? 'on' : ''}">Retest-kandidaten</button></div></div>`;
  if (!S.ledger) {
    return head + `<div class="rest"><b>${S.extrasBusy ? 'Records laden…' : 'Nog geen records geladen'}</b>${esc(S.extrasErr) || (Api.tokenValid() ? '' : 'Log eerst in.')}</div><div class="center"><button class="btn" data-act="extras">Opnieuw proberen</button></div>`;
  }
  const upd = S.ledger.ts ? `Bijgewerkt ${Sh.fmtHM(S.ledger.ts)}` : '';
  return head + (S.extrasErr ? `<div class="err">${esc(S.extrasErr)}</div>` : '') +
    `${trendsHTML()}<p class="hintline">${upd}${S.extrasBusy ? ' · verversen…' : ''} · Betrouwbaarheid is een indicatie op basis van leeftijd, testtype en noot.</p><div id="reclist">${recListHTML()}</div>`;
}

// ---------- readiness bij sessiestart ----------
// Slaap komt uit Polar als er data van deze nacht is; anders blijft de vraag staan.
function polarSleep() {
  if (!Pl.configured(S.settings)) return null;
  const e = S.polarDay[Pl.isoDate(new Date())];
  const ans = e && Pl.sleepAnswer(e.data);
  return ans ? { ans, score: e.data.sleep.score } : null;
}
const effReady = () => { const p = polarSleep(); return p && !S.ready.sl ? { ...S.ready, sl: p.ans } : S.ready; };  // Polar vult voor in; een eigen keuze wint
function readyBarHTML() {
  if (S.settings.readiness === false || !S.view || !S.rows.length) return '';
  const { week, dayIdx } = S.view, today = Sh.todayPosition(curStart());
  if (!today || today.week !== week || today.dayIdx !== dayIdx) return '';
  const rs = rowsOf(week, dayIdx);
  if (!rs.length || rs.some((r) => r.readiness && r.readiness.trim()) || rs.some((r) => Sh.status(r) !== 'open')) return '';
  if (S.dismissed[`ready|${S.settings.tab}|${week}|${dayIdx}`]) return '';
  const ps = polarSleep(), R = effReady();
  const row = (k) => `<div class="lbl">${In.READY_LABELS[k]}${k === 'sl' && ps ? `<small class="hint"> · ${S.ready.sl && S.ready.sl !== ps.ans ? `Polar stelde ${ps.ans} voor (${ps.score})` : `voorgesteld door Polar (${ps.score})`}</small>` : ''}<div class="chips">${In.READY_OPTS[k].map((v) => `<button type="button" data-act="ready-set" data-k="${k}" data-v="${v}" class="${R[k] === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>`;
  return `<div class="painbar readybar"><b>Hoe sta je erbij vandaag?</b><small>${ps ? 'slaap is voorgesteld door Polar, pas aan als het niet klopt' : '3 tikken, de coach neemt het mee'}</small>${row('sl')}${row('sp')}${row('st')}
    <div class="row2"><button class="btn primary" data-act="ready-save" ${In.readyComplete(R) ? '' : 'disabled'}>Opslaan</button><button class="btn link" data-act="ready-skip">Overslaan</button></div></div>`;
}
function readyAction(a, b) {
  if (a === 'ready-set') { S.ready[b.dataset.k] = S.ready[b.dataset.k] === b.dataset.v ? '' : b.dataset.v; render(); return; }
  const { week, dayIdx } = S.view;
  if (a === 'ready-skip') { S.dismissed[`ready|${S.settings.tab}|${week}|${dayIdx}`] = 1; save.dismissed(); render(); return; }
  if (!In.readyComplete(effReady())) return;
  S.queue.push({ type: 'session', tab: S.settings.tab, week, dayIdx, fields: { readiness: In.readyText(effReady()) }, at: Date.now() });
  S.ready = { sl: '', sp: '', st: '' }; save.queue();
  rebuild(); render(); toast('Genoteerd ✓'); kickSync(true);
}

// ---------- Polar (optioneel) ----------
function polarLineHTML(week, dayIdx, rs) {
  if (!Pl.configured(S.settings)) return '';
  const txt = (rs.find((r) => r.polar && r.polar.trim()) || {}).polar;
  const d = Sh.dateFor(curStart(), week, dayIdx);
  if (!d || d > new Date()) return txt ? `<div class="readyline">⌚ ${esc(txt)}</div>` : '';
  const busy = S.polarBusy === `${week}|${dayIdx}`;
  return `<div class="polarline">${txt ? `<div class="readyline">⌚ ${esc(txt)}</div>` : ''}<button class="btn" data-act="polar-fetch" ${busy ? 'disabled' : ''}>${busy ? 'Ophalen…' : txt ? '↻ Polar opnieuw ophalen' : '⌚ Polar-gegevens ophalen'}</button></div>`;
}
async function polarSync(week, dayIdx, manual) {
  const d = Sh.dateFor(curStart(), week, dayIdx);
  if (!d) { if (manual) toast('Vul eerst de startdatum van de cyclus in (⚙).'); return; }
  const key = `${week}|${dayIdx}`;
  if (manual) { S.polarBusy = key; render(); }
  try {
    const rs = rowsOf(week, dayIdx);
    const sess = rs.find((r) => r.sStart && r.sEnd) || {};
    const have = (rs.find((r) => r.polar && r.polar.trim()) || {}).polar || '';
    const data = await Pl.day(S.settings, Pl.isoDate(d));
    S.polarDay[Pl.isoDate(d)] = { t: Date.now(), data };
    const ex = Pl.matchExercise(data.exercises, sess.sStart, sess.sEnd);
    const text = Pl.polarText(data, ex);
    if (!manual) {
      // automatisch: enkel opslaan als het iets nieuws is (herstel nog niet bewaard, of training nu gevonden)
      if (!text || text === have || (have.includes('Training') && !ex)) { render(); return; }
    }
    if (!text) { if (manual) toast('Nog niets gevonden bij Polar. Sync je horloge met Polar Flow en probeer opnieuw.'); return; }
    if (text !== have) {
      S.queue.push({ type: 'session', tab: S.settings.tab, week, dayIdx, fields: { polar: text }, at: Date.now() });
      save.queue(); rebuild(); kickSync(true);
    }
    if (manual) toast(ex ? 'Polar opgeslagen ✓' : (sess.sEnd ? 'Herstel opgeslagen, training niet gevonden (sync met Polar Flow en tik ↻)' : 'Herstel opgeslagen ✓'));
    else if (ex && !have.includes('Training')) toast('Polar-training toegevoegd ✓');
  } catch (e) { if (manual) toast(e.message || 'Polar ophalen mislukt'); }
  finally { if (manual) S.polarBusy = ''; render(); }
}
const polarFetch = () => polarSync(S.view.week, S.view.dayIdx, true);
// Automatisch: herstel van vandaag ophalen/bewaren en, na een afgeronde sessie, de training koppelen.
function polarAutoToday(force = false) {
  if (!Pl.configured(S.settings) || !S.rows.length || !navigator.onLine) return;
  const t = Sh.todayPosition(curStart());
  if (!t || !rowsOf(t.week, t.dayIdx).length) return;
  const k = `${S.settings.tab}|${t.week}|${t.dayIdx}`;
  if (!force && Date.now() - (S.polarAutoAt[k] || 0) < 180e3) return;
  S.polarAutoAt[k] = Date.now();
  polarSync(t.week, t.dayIdx, false);
}
// Na het einde van een training: de watch synct meestal binnen enkele minuten naar Polar Flow.
function polarAfterEnd() {
  if (!Pl.configured(S.settings)) return;
  for (const ms of [90e3, 240e3, 480e3]) setTimeout(() => polarAutoToday(true), ms);
}
function polarCardHTML(week, dayIdx, rs) {
  if (!Pl.configured(S.settings)) return '';
  const t = Sh.todayPosition(curStart());
  if (!t || t.week !== week || t.dayIdx !== dayIdx) return '';
  const e = S.polarDay[Pl.isoDate(new Date())];
  if (!e) return '';
  const ready = (rs.find((r) => r.readiness && r.readiness.trim()) || {}).readiness || '';
  const lv = Pl.recoveryLevel(e.data, ready);
  if (!lv) return '';
  const r = e.data.recharge, sl = e.data.sleep;
  const dec = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
  const W = Pl.tileWords(e.data);
  const tile = (v, l, w) => `<div class="pc-t"><b>${esc(v)}</b><span>${esc(l)}</span>${w ? `<em>${esc(w)}</em>` : ''}</div>`;
  const tiles = [
    r && r.status != null ? tile(`${r.status}/6`, 'Recharge', W.recharge) : '',
    r && r.ansCharge != null ? tile(`${r.ansCharge > 0 ? '+' : ''}${dec(r.ansCharge)}`, 'ANS charge', W.ans) : '',
    r && r.hrv != null ? tile(Math.round(r.hrv), 'HRV', W.hrv) : '',
    sl && sl.score != null ? tile(sl.score, `Slaap${sl.asleepMin ? ` · ${Math.floor(sl.asleepMin / 60)}u${String(sl.asleepMin % 60).padStart(2, '0')}` : ''}`, W.sleep) : '',
  ].join('');
  const untouched = rs.every((r2) => Sh.status(r2) === 'open');
  const why = lv.reasons.length ? ` (${esc(lv.reasons.join(', '))})` : '';
  const hint = !untouched ? '' : lv.level === 'low' ? `<p class="pc-hint">Herstel onder je norm${why}. Overweeg lager volume of een lager RPE-doel vandaag.</p>`
    : lv.level === 'mid' ? `<p class="pc-hint">Herstel wat onder je norm${why}. Bouw rustig op en kijk hoe de eerste sets voelen.</p>` : '';
  return `<div class="polarcard ${lv.level}"><div class="pc-head"><span class="pc-dot"></span><b>Herstel vandaag: ${lv.label}</b><span class="pc-src">⌚ Polar</span><button class="pc-q" data-act="polar-help" aria-label="Uitleg">?</button></div><div class="pc-grid">${tiles}</div>${S.polarHelp ? `<dl class="pc-help">${Pl.HELP.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}${hint}</div>`;
}
async function polarTest() {
  readSettingsForm();
  if (!Pl.configured(S.settings)) return toast('Vul het adres en de code van je Worker in.');
  try { await Pl.ping(S.settings); save.settings(); toast('Polar-Worker bereikbaar ✓'); }
  catch (e) { toast(e.message); }
}

// ---------- doelkiezer (week + dag), gedeeld door "Verplaats" en de les-vraag ----------
const dmy = (w, d) => { const x = Sh.dateFor(curStart(), w, d); return x ? `${x.getDate()}/${x.getMonth() + 1}` : ''; };
const openOf = (w, d) => rowsOf(w, d).filter((r) => Sh.status(r) === 'open');
const maxWeek = () => Math.max(1, ...weeks());
function pickerHTML(ctx, st) {
  const ws = weeks(), top = maxWeek() + 1;
  const chips = Sh.DAYS.map((dn, d) => {
    const all = rowsOf(st.tw, d), n = all.filter((r) => Sh.status(r) === 'open').length;
    const same = st.tw === S.view.week && d === S.view.dayIdx;
    const sub = same ? 'hier' : !all.length ? 'leeg' : `${n} open`;
    return `<button type="button" class="tpday ${st.td === d ? 'on' : ''}" data-act="tp-day" data-ctx="${ctx}" data-d="${d}" ${same ? 'disabled' : ''}><b>${dn}</b><small>${dmy(st.tw, d)}</small><small>${sub}</small></button>`;
  }).join('');
  return `<div class="tp"><div class="tpweek"><button type="button" class="btn" data-act="tp-week" data-ctx="${ctx}" data-dir="-1" ${st.tw <= 1 ? 'disabled' : ''}>‹</button><b>Week ${st.tw}${st.tw > Math.max(0, ...ws) ? ' (nieuw)' : ''}</b><button type="button" class="btn" data-act="tp-week" data-ctx="${ctx}" data-dir="1" ${st.tw >= top ? 'disabled' : ''}>›</button></div><div class="tpdays">${chips}</div></div>`;
}
function tpAction(b) {
  const st = b.dataset.ctx === 'extra' ? S.extra : S.move; if (!st) return;
  if (st === S.extra) extraRead();
  if (b.dataset.act === 'tp-week') { st.tw = Math.min(maxWeek() + 1, Math.max(1, st.tw + +b.dataset.dir)); if (st.tw === S.view.week && st.td === S.view.dayIdx) st.td = -1; }
  else st.td = +b.dataset.d;
  if (st === S.move) st.swap = false;
  render();
}
const minsOf = (rs) => rs.reduce((a, r) => a + In.plannedMin(r.piece), 0);

// ---------- verplaatsen ----------
function moveOpen() {
  const { week, dayIdx } = S.view;
  const open = openOf(week, dayIdx);
  if (!open.length) { toast('Er zijn geen open onderdelen om te verplaatsen op deze dag.'); return; }
  const nd = dayIdx < 6 ? { tw: week, td: dayIdx + 1 } : { tw: week + 1, td: 0 };
  S.move = { sel: open.map((r) => r.key), tw: nd.tw, td: nd.td, swap: false };
  render();
}
function moveHTML() {
  const m = S.move; if (!m) return '';
  const { week, dayIdx } = S.view;
  const open = openOf(week, dayIdx);
  const tgtOpen = m.td >= 0 ? openOf(m.tw, m.td) : [];
  const picked = open.filter((r) => m.sel.includes(r.key));
  const swapRows = m.swap ? tgtOpen : [];
  const srcAfter = minsOf(rowsOf(week, dayIdx)) - minsOf(picked) + minsOf(swapRows);
  const tgtAfter = m.td >= 0 ? minsOf(rowsOf(m.tw, m.td)) - minsOf(swapRows) + minsOf(picked) : 0;
  const lbl = (w, d) => `${Sh.DAYS[d]} ${dmy(w, d)}`.trim();
  const sum = m.td < 0 ? 'Kies een dag.' : !picked.length ? 'Vink minstens één onderdeel aan.'
    : `${picked.length} onderdeel/onderdelen → ${lbl(m.tw, m.td)}${swapRows.length ? ` · ${swapRows.length} terug naar ${lbl(week, dayIdx)}` : ''}. Geplande tijd: ${lbl(m.tw, m.td)} ${tgtAfter}', ${lbl(week, dayIdx)} ${srcAfter}'.`;
  return `<div class="sheetmodal"><div><div class="setup"><h1>Verplaats onderdelen</h1>
    <p class="hint">Van ${Sh.DAYS_LONG[dayIdx]} ${dmy(week, dayIdx)} (week ${week}). Alleen onderdelen die nog niet gelogd zijn.</p>
    <div class="mvlist">${open.map((r) => `<label class="chk"><input type="checkbox" data-act="mv-toggle" data-key="${esc(r.key)}" ${m.sel.includes(r.key) ? 'checked' : ''}> <span>${esc(r.piece)}</span></label>`).join('')}</div>
    <button class="btn link" data-act="mv-all">${picked.length === open.length ? 'Niets' : 'Alles'} aanvinken</button>
    <h3 class="mvh">Naar</h3>${pickerHTML('move', m)}
    ${tgtOpen.length ? `<label class="toggle"><input type="checkbox" data-act="mv-swap" ${m.swap ? 'checked' : ''}> Wissel: de ${tgtOpen.length} open onderdelen van ${Sh.DAYS[m.td]} komen naar ${Sh.DAYS[dayIdx]}</label>` : ''}
    <p class="hint mvsum">${esc(sum)}</p>
    <button class="btn primary" data-act="mv-go" ${m.td < 0 || !picked.length ? 'disabled' : ''}>Verplaats</button><button class="btn" data-act="mv-cancel">Annuleer</button></div></div></div>`;
}
// Queue a move op; returns the undo info (or null when nothing moved)
function queueMove(moves, label) {
  if (!moves.length || !S.merged) return null;
  const tab = S.settings.tab, pre = `${tab}§`;
  const op = { type: 'move', tab, moves, at: Date.now() };
  const pm = Sh.planMove(S.merged, S.headerIdx, S.map, op, pre);
  if (!pm.moved) return null;
  const after = Sh.parseRows(pm.grid, S.headerIdx, S.map, pre);
  const keyMap = new Map(pm.placed.map((p) => [p.oldKey, after.find((r) => r.rowNum === p.newRowNum)?.key]));
  const undo = pm.placed.map((p) => {
    const i = S.rows.findIndex((r) => r.key === p.oldKey);
    let prev = null; for (let j = i - 1; j >= 0; j--) if (S.rows[j].week === p.from.week && S.rows[j].dayIdx === p.from.dayIdx) { prev = S.rows[j].piece; break; }
    return { newKey: keyMap.get(p.oldKey), week: p.from.week, dayIdx: p.from.dayIdx, piece: p.from.piece, afterName: prev };
  });
  // UI state follows the keys
  const drafts = {}, opened = {};
  for (const p of pm.placed) { if (S.drafts[p.oldKey]) { drafts[keyMap.get(p.oldKey)] = S.drafts[p.oldKey]; delete S.drafts[p.oldKey]; } if (p.oldKey in S.open) { opened[keyMap.get(p.oldKey)] = S.open[p.oldKey]; delete S.open[p.oldKey]; } }
  Object.assign(S.drafts, drafts); Object.assign(S.open, opened); save.drafts?.();
  S.queue.push(op); save.queue();
  S.lastMove = { tab, undo, label, at: Date.now() };
  rebuild();
  return { moved: pm.moved, renamed: pm.renamed };
}
function moveGo() {
  const m = S.move; if (!m || m.td < 0) return;
  const { week, dayIdx } = S.view;
  const picked = openOf(week, dayIdx).filter((r) => m.sel.includes(r.key));
  if (!picked.length) return;
  const moves = picked.map((r) => ({ key: r.key, week: m.tw, dayIdx: m.td }));
  if (m.swap) for (const r of openOf(m.tw, m.td)) moves.push({ key: r.key, week: week, dayIdx });
  const partKey = S.timers.part && S.timers.part.key;
  if (partKey && moves.some((x) => x.key === partKey)) { toast('Stop eerst de timer van dit onderdeel.'); return; }
  const lbl = `${picked.length} onderdeel/onderdelen → ${Sh.DAYS[m.td]} ${dmy(m.tw, m.td)}${m.swap ? ' (gewisseld)' : ''}`;
  const r = queueMove(moves, lbl);
  S.move = null;
  if (!r) { render(); toast('Er is niets verplaatst.'); return; }
  const target = { week: m.tw, dayIdx: m.td };
  S.view = target; save.view?.();
  render(); toast(`Verplaatst ✓${r.renamed.length ? ` (${r.renamed.length} kreeg een nummer achter de naam)` : ''}`); kickSync(true);
}
function undoBarHTML() {
  const u = S.lastMove; if (!u || u.tab !== S.settings.tab) return '';
  const rows = u.undo.map((x) => S.rows.find((r) => r.key === x.newKey));
  if (rows.some((r) => !r || Sh.status(r) !== 'open')) return '';
  return `<div class="notice undo"><span>↩ ${esc(u.label)}</span><button class="link2" data-act="mv-undo">Ongedaan maken</button><button data-act="mv-undo-x" aria-label="Sluiten">✕</button></div>`;
}
function moveUndo() {
  const u = S.lastMove; if (!u) return;
  const moves = u.undo.map((x) => ({ key: x.newKey, week: x.week, dayIdx: x.dayIdx, piece: x.piece, afterName: x.afterName }));
  S.lastMove = null;
  const r = queueMove(moves, '');
  S.lastMove = null;
  if (!r) { render(); toast('Ongedaan maken lukt niet meer (onderdelen zijn gelogd of verplaatst).'); return; }
  S.view = { week: u.undo[0].week, dayIdx: u.undo[0].dayIdx };
  render(); toast('Verplaatsing ongedaan gemaakt ✓'); kickSync(true);
}
function moveAction(a, b) {
  const m = S.move;
  if (a === 'mv-toggle') { const k = b.dataset.key; m.sel = b.checked ? [...new Set([...m.sel, k])] : m.sel.filter((x) => x !== k); m.swap = m.swap && m.sel.length > 0; render(); }
  else if (a === 'mv-all') { const open = openOf(S.view.week, S.view.dayIdx); m.sel = m.sel.length === open.length ? [] : open.map((r) => r.key); render(); }
  else if (a === 'mv-swap') { m.swap = b.checked; render(); }
  else if (a === 'mv-cancel') { S.move = null; render(); }
  else if (a === 'mv-go') moveGo();
}

// ---------- extra sessie of les ----------
function extraOpen() {
  const { week, dayIdx } = S.view;
  const nd = dayIdx < 6 ? { tw: week, td: dayIdx + 1 } : { tw: week + 1, td: 0 };
  S.extra = { title: '', actual: '', rpe: '', dur: '', repl: [], rest: 'keep', tw: nd.tw, td: nd.td };
  render();
}
function extraRead() {                                       // keep what was typed when the form re-renders
  const x = S.extra; if (!x) return;
  const g = (id) => document.getElementById(id);
  if (g('x-title')) { x.title = g('x-title').value; x.actual = g('x-actual').value; x.rpe = g('x-rpe').value; x.dur = g('x-dur').value; }
}
function extraAction(a, b) {
  const x = S.extra; if (!x) return;
  extraRead();
  if (a === 'x-toggle') x.repl = b.checked ? [...new Set([...x.repl, b.dataset.key])] : x.repl.filter((k) => k !== b.dataset.key);
  else if (a === 'x-all') { const open = openOf(S.view.week, S.view.dayIdx); x.repl = x.repl.length === open.length ? [] : open.map((r) => r.key); }
  else if (a === 'x-rest') x.rest = b.dataset.v;
  render();
}
function extraHTML() {
  const x = S.extra; if (!x) return '';
  const open = openOf(S.view.week, S.view.dayIdx);
  const rest = open.filter((r) => !x.repl.includes(r.key));
  const restOpts = [['keep', 'Laten staan'], ['skip', 'Overslaan (Skip)'], ['move', 'Doorschuiven…']];
  return `<div class="sheetmodal"><div><div class="setup"><h1>Extra sessie of les</h1>
    <p class="hint">${Sh.DAYS_LONG[S.view.dayIdx]} week ${S.view.week}. Komt als rij met Focus "Extra" in je sheet.</p>
    <label>Titel<input id="x-title" value="${esc(x.title)}" placeholder="bv. CrossFit-les 18u" autocomplete="off"></label>
    <label>Resultaat of notitie<textarea id="x-actual" rows="4" placeholder="bv. WOD Fran 5:10, of: les gegeven, lichte squats">${esc(x.actual)}</textarea></label>
    <div class="row2"><label>RPE<select id="x-rpe"><option value=""></option>${['5', '6', '7', '8', '9', '10'].map((v) => `<option ${x.rpe === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label>Duur (min)<input id="x-dur" type="number" inputmode="numeric" min="0" value="${esc(x.dur)}"></label></div>
    ${open.length ? `<h3 class="mvh">Welke geplande onderdelen heeft de les vervangen?</h3><p class="hint">Die krijgen "Vervangen door les" en tellen niet als gemist.</p>
      <div class="mvlist">${open.map((r) => `<label class="chk"><input type="checkbox" data-act="x-toggle" data-key="${esc(r.key)}" ${x.repl.includes(r.key) ? 'checked' : ''}> <span>${esc(r.piece)}</span></label>`).join('')}</div>
      <button class="btn link" data-act="x-all">${x.repl.length === open.length ? 'Niets' : 'Alles'} aanvinken</button>
      ${rest.length ? `<h3 class="mvh">Wat met de overige ${rest.length} onderdelen?</h3><div class="chips">${restOpts.map(([v, l]) => `<button type="button" data-act="x-rest" data-v="${v}" class="${x.rest === v ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${x.rest === 'move' ? pickerHTML('extra', x) : ''}` : ''}` : ''}
    <button class="btn primary" data-act="extra-save">Toevoegen</button><button class="btn" data-act="extra-cancel">Annuleer</button></div></div></div>`;
}
function saveExtra() {
  extraRead();
  const x = S.extra;
  const title = (x.title || '').trim();
  if (!title) { toast('Geef de sessie een titel.'); return; }
  const open = openOf(S.view.week, S.view.dayIdx);
  const repl = open.filter((r) => x.repl.includes(r.key)), rest = open.filter((r) => !x.repl.includes(r.key));
  if (rest.length && x.rest === 'move' && x.td < 0) { toast('Kies een dag om naar door te schuiven.'); return; }
  const { week, dayIdx } = S.view, tab = S.settings.tab, stamp = Sh.fmtStamp(Date.now());
  const fields = { cycle: String(Sh.cycleNum(tab) ?? ''), week: String(week), dag: Sh.DAYS[dayIdx], focus: 'Extra', piece: `Les: ${title}`,
    actual: (x.actual || '').trim() || 'Gedaan', rpe: x.rpe, dur: x.dur, loggedAt: stamp };
  S.queue.push({ type: 'extra', tab, week, dayIdx, fields, at: Date.now() });
  for (const it of repl) S.queue.push({ type: 'piece', tab, key: it.key, fields: { actual: 'Vervangen door les', loggedAt: stamp }, base: { actual: it.actual }, at: Date.now() });
  if (x.rest === 'skip') for (const it of rest) S.queue.push({ type: 'piece', tab, key: it.key, fields: { actual: 'Skip', loggedAt: stamp }, base: { actual: it.actual }, at: Date.now() });
  const target = { tw: x.tw, td: x.td }, doMove = x.rest === 'move' && rest.length && x.td >= 0, restKeys = rest.map((r) => r.key);
  S.extra = null; save.queue(); rebuild();
  let msg = 'Extra sessie toegevoegd ✓';
  if (doMove) {
    const r = queueMove(restKeys.map((k) => ({ key: k, week: target.tw, dayIdx: target.td })), `${rest.length} onderdeel/onderdelen → ${Sh.DAYS[target.td]} ${dmy(target.tw, target.td)}`);
    if (r) msg += ` · ${rest.length} doorgeschoven`;
  } else if (x.rest === 'skip' && rest.length) msg += ` · ${rest.length} overgeslagen`;
  render(); toast(msg); kickSync(true);
}

// ---------- gym-modus ----------
let $gym = null, gymKey = '', gymLock = null;
async function gymWake() { try { if (navigator.wakeLock && !gymLock) { gymLock = await navigator.wakeLock.request('screen'); gymLock.addEventListener?.('release', () => { gymLock = null; }); } } catch { /* optional */ } }
function gymOpen() {
  const rs = rowsOf(S.view.week, S.view.dayIdx); if (!rs.length) return;
  gymKey = (rs.find((r) => Sh.status(r) === 'open') || rs[0]).key;
  if (!$gym) {
    $gym = document.createElement('div'); $gym.id = 'gym'; document.body.appendChild($gym);
    $gym.addEventListener('click', (e) => {
      if (e.target.closest('[data-tm]')) { TU.click(e); setTimeout(renderGym, 0); return; }
      const b = e.target.closest('[data-gym]'); if (!b) return;
      const it = currentItem(gymKey), rs2 = it ? rowsOf(it.week, it.dayIdx) : [], i = rs2.findIndex((r) => r.key === gymKey);
      if (b.dataset.gym === 'prev' && i > 0) gymKey = rs2[i - 1].key;
      else if (b.dataset.gym === 'next' && i < rs2.length - 1) gymKey = rs2[i + 1].key;
      else if (b.dataset.gym === 'close') return gymClose();
      else if (b.dataset.gym === 'log') { const k = gymKey; gymClose(); S.open[k] = true; render(); document.querySelector(`[data-key="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'start' }); return; }
      renderGym();
    });
  }
  $gym.hidden = false; document.body.classList.add('gym-open'); gymWake(); renderGym();
}
function gymClose() { if ($gym) $gym.hidden = true; document.body.classList.remove('gym-open'); try { gymLock?.release(); } catch { /* ignore */ } gymLock = null; }
function renderGym() {
  if (!$gym || $gym.hidden) return;
  const it = currentItem(gymKey); if (!it) { gymClose(); return; }
  const rs = rowsOf(it.week, it.dayIdx), i = rs.findIndex((r) => r.key === gymKey);
  $gym.innerHTML = `<div class="gym-top"><span>${i + 1} van ${rs.length} · ${esc(it.focus)}</span><button data-gym="close" aria-label="Sluiten">✕</button></div>
    <h1>${esc(it.piece)}</h1><div class="gym-rx">${esc(it.prescribed)}</div>${calcHTML(it)}
    ${it.intent ? `<div class="gym-intent">${esc(it.intent)}</div>` : ''}${lastHTML(it)}
    <div class="gym-btns">${TU.pieceButtons(it)}</div>
    <div class="gym-nav"><button data-gym="prev" ${i <= 0 ? 'disabled' : ''}>‹ Vorige</button><button data-gym="log" class="primary">Loggen</button><button data-gym="next" ${i >= rs.length - 1 ? 'disabled' : ''}>Volgende ›</button></div>`;
}

// ---------- CSV-back-up ----------
async function exportCsv() {
  if (!S.rows.length) { toast('Nog niets om te exporteren.'); return; }
  const name = `${(S.settings.tab || 'training-log').replace(/[^A-Za-z0-9_-]+/g, '-')}-${today()}.csv`;
  const file = new File([In.toCsv(S.rows)], name, { type: 'text/csv' });
  try { if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e?.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('CSV gedownload ✓');
}

// ---------- pijncheck de dag erna ----------
const PAIN_AREAS = ['Geen klachten', 'Knie', 'Schouder', 'Elleboog', 'Rug', 'Anders'];
const painCand = () => (S.rows.length ? In.painCandidate(S.rows, new Date(), S.dismissed, S.settings.tab) : null);
function painBarHTML() {
  const c = painCand(); if (!c) return '';
  const sel = S.pain.sel, any = sel.length && !sel.includes('Geen klachten');
  return `<div class="painbar"><b>Hoe voelt het vandaag?</b><small>na ${Sh.DAYS_LONG[c.dayIdx].toLowerCase()} (${esc(c.reason)})</small>
    <div class="chips">${PAIN_AREAS.map((a) => `<button type="button" data-act="pain-area" data-v="${a}" class="${sel.includes(a) ? 'on' : ''}">${a}</button>`).join('')}</div>
    ${any ? `<div class="lbl">Hoe erg? (0 tot 10, optioneel)<div class="chips sc">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<button type="button" data-act="pain-score" data-v="${n}" class="${String(S.pain.score) === String(n) ? 'on' : ''}">${n}</button>`).join('')}</div></div>` : ''}
    <div class="row2"><button class="btn primary" data-act="pain-save" ${sel.length ? '' : 'disabled'}>Opslaan</button><button class="btn link" data-act="pain-skip">Overslaan</button></div></div>`;
}
function painAction(a, v) {
  if (a === 'pain-area') {
    let sel = S.pain.sel.slice();
    if (v === 'Geen klachten') sel = sel.includes(v) ? [] : [v];
    else { sel = sel.filter((x) => x !== 'Geen klachten'); sel = sel.includes(v) ? sel.filter((x) => x !== v) : [...sel, v]; }
    S.pain.sel = sel; if (!sel.length || sel.includes('Geen klachten')) S.pain.score = '';
    render(); return;
  }
  if (a === 'pain-score') { S.pain.score = String(S.pain.score) === String(v) ? '' : v; render(); return; }
  const c = painCand(); if (!c) return;
  const mark = `pain|${S.settings.tab}|${c.groupKey}`;
  if (a === 'pain-skip') { S.dismissed[mark] = 1; save.dismissed(); S.pain = { sel: [], score: '' }; render(); return; }
  const it = currentItem(c.key); if (!it) return;
  const text = In.painText(S.pain.sel, S.pain.score);
  const [p, after] = Sh.splitPain(it.pain);
  const pain = Sh.joinPain(p, after ? `${after}; ${text}` : text);
  S.queue.push({ type: 'piece', tab: S.settings.tab, key: c.key, fields: { pain }, base: { pain: it.pain }, at: Date.now() });
  S.dismissed[mark] = 1; save.dismissed(); save.queue();
  S.pain = { sel: [], score: '' };
  rebuild(); render(); toast('Genoteerd ✓'); kickSync(true);
}

// ---------- weekoverzicht ----------
const fmtKg = (n) => `${Math.round(n).toLocaleString('nl-BE')} kg`;
function weekHTML() {
  const { week } = S.view;
  const s = In.weekSummary(S.rows, week);
  if (!s.days.length) return '<div class="rest"><b>Geen sessies deze week</b>Er staat niets gepland.</div>';
  const stat = (k, v, sub = '') => `<div class="stat"><small>${k}</small><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const tone = In.overTone(s.planned, s.real);
  const cards = [
    stat('Sessies', `${s.sessions}/${s.sessionsPlanned}`, s.coreTotal ? `kern ${s.coreDone}/${s.coreTotal}` : ''),
    stat('Onderdelen', `${s.pieces}/${s.piecesTotal}`, s.skipped ? `${s.skipped} overgeslagen` : ''),
    s.real ? stat('Tijd', `<span class="tm-${tone}">${s.real}'</span>`, `gepland ${s.planned}'`) : stat('Tijd', '—', 'nog niets gemeten'),
    stat('RPE gem.', s.rpe != null ? s.rpe.toFixed(1).replace('.', ',') : '—'),
    stat('Volume', s.tonnage ? fmtKg(s.tonnage) : '—', 'indicatief, kracht'),
    stat('Let op', s.painDays || s.badDays ? `${s.painDays} pijn` : 'niets', s.badDays ? `${s.badDays} slechte dag${s.badDays > 1 ? 'en' : ''}` : 'geen meldingen'),
  ].join('');
  const days = s.days.map((d) => {
    const dt = Sh.dateFor(curStart(), week, d.dayIdx);
    const t = d.real != null ? ` · <span class="tm-${In.overTone(d.planned, d.real)}">${d.real}'</span>/${d.planned}'` : d.planned ? ` · ${d.planned}' gepland` : '';
    const cls = d.done === d.total ? 'done' : d.done ? 'part' : '';
    return `<button class="wkday ${cls}" data-act="wkday" data-i="${d.dayIdx}"><span class="wd">${Sh.DAYS[d.dayIdx]}${dt ? `<small>${dt.getDate()}/${dt.getMonth() + 1}</small>` : ''}</span>
      <span class="wf">${esc(d.focus)}${d.optional ? '' : ''}<small>${d.done}/${d.total} gelogd${d.skipped ? ` · ${d.skipped} skip` : ''}${t}${d.rpe != null ? ` · RPE ${d.rpe.toFixed(1).replace('.', ',')}` : ''}${d.pain ? ' · ⚠ pijn' : ''}${d.bad ? ' · slechte dag' : ''}</small></span></button>`;
  }).join('');
  return `<div class="dayhead"><h2>Week ${week}</h2><p>Berekend in de app, zonder coach.</p></div><div class="stats">${cards}</div><div class="wkdays">${days}</div>`;
}

// ---------- trends (Records) ----------
function spark(pts) {
  const vs = pts.map((p) => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const W = 110, H = 28, xy = pts.map((p, i) => [Math.round((i / (pts.length - 1)) * (W - 6) + 3), Math.round(H - 4 - ((p.v - lo) / span) * (H - 8))]);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${xy.map((q) => q.join(',')).join(' ')}"/>${xy.map((q, i) => `<circle cx="${q[0]}" cy="${q[1]}" r="${pts[i].bad ? 3 : 2}" fill="${pts[i].bad ? 'var(--warn)' : 'currentColor'}"/>`).join('')}</svg>`;
}
function trendsHTML() {
  const lifts = In.liftSeries(S.logs), wk = In.weekTrend(S.grids).slice(-10);
  if (!lifts.length && !wk.length) return '';
  const cyc = (t) => { const n = Sh.cycleNum(t); return n != null ? `C${n}` : t; };
  const l = lifts.map((x) => {
    const first = x.pts[0].v, last = x.pts[x.pts.length - 1].v, d = last - first;
    return `<div class="tr"><span class="trn">${esc(x.label)}<small>${x.pts.length} metingen</small></span>${spark(x.pts)}<span class="trv"><b>${Math.round(last)} kg</b><small>${d >= 0 ? '+' : '−'}${Math.abs(Math.round(d))} kg</small></span></div>`;
  }).join('');
  const w = wk.map((x) => `<div class="trw"><span>${cyc(x.tab)} W${x.week}</span><span>${x.sessions} sessie${x.sessions === 1 ? '' : 's'}</span><span class="bar"><i style="width:${x.rpe != null ? Math.round(x.rpe * 10) : 0}%"></i></span><span>${x.rpe != null ? x.rpe.toFixed(1).replace('.', ',') : '—'}</span></div>`).join('');
  return `<details class="trends"><summary>Trends</summary>
    ${l ? `<h4>Geschatte 1RM per lift</h4><p class="hintline">Beste set per sessie, berekend uit je gelogde sets (Brzycki). Oranje punt = slechte dag.</p>${l}` : ''}
    ${w ? `<h4>Sessies en gemiddelde RPE per week</h4>${w}` : ''}</details>`;
}

function settingsHTML(first) {
  const s = S.settings;
  const connected = S.tabs.length > 0 || s.tab;
  const body = `<div class="setup">
    <h1>${first ? 'Koppel je planning' : 'Instellingen'}</h1>
    ${first ? '<p>Eenmalig instellen, in 3 stappen:</p><ol class="steps"><li><b>Google client-ID</b> invullen (aanmaken: zie de README, 5 min).</li><li><b>Link naar je Google Sheet</b> plakken en op Verbinden tikken.</li><li>Je <b>tabblad (cyclus)</b> kiezen en de <b>maandag van week 1</b> invullen. Klaar: de planning verschijnt.</li></ol>' : ''}
    ${S.formErr ? `<div class="err">${esc(S.formErr)}</div>` : ''}
    <label>Google client-ID<input id="f-client" value="${esc(s.clientId)}" placeholder="123…apps.googleusercontent.com" autocomplete="off" autocapitalize="off"></label>
    <label>Link naar je Google Sheet<input id="f-sheet" value="${esc(s.sheetId ? `https://docs.google.com/spreadsheets/d/${s.sheetId}` : '')}" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" autocapitalize="off"></label>
    <button class="btn primary" data-act="connect">${connected ? 'Opnieuw verbinden' : 'Verbinden met Google'}</button>
    ${connected ? `<label>Tabblad (cyclus)<select id="f-tab">${(S.tabs.length ? S.tabs.filter((t) => t === s.tab || !Object.values(Co.COACH_TABS).includes(t)) : [s.tab]).map((t) => `<option ${t === (S.formTab || s.tab) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label>Maandag van week 1 (voor dit tabblad)<input type="date" id="f-start" value="${esc((s.cycleStarts || {})[S.formTab || s.tab] || '')}"><span class="hint">Zo weet de app welke dag het vandaag is en toont hij datums. Elke cyclus heeft zijn eigen startdatum.</span></label>
    <label>Link naar je PR Ledger (optioneel)<input id="f-ledger" value="${esc(s.ledgerId ? `https://docs.google.com/spreadsheets/d/${s.ledgerId}` : '')}" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" autocapitalize="off"><span class="hint">Voor de Records-pagina en de laatste score per onderdeel. Alleen lezen.</span></label>
    <label>Stang<select id="f-bar"><option value="20" ${+s.barKg !== 15 ? 'selected' : ''}>20 kg (man)</option><option value="15" ${+s.barKg === 15 ? 'selected' : ''}>15 kg (vrouw)</option></select><span class="hint">Voor de berekening van de plaatjes per kant.</span></label>
    <label class="toggle"><input type="checkbox" id="f-timers" ${s.timers ? 'checked' : ''}> Timers (sessie en per onderdeel)</label>
    <details><summary>Interval-timer (EMOM, AMRAP, For Time)</summary><div class="coachset">
      <label class="toggle"><input type="checkbox" id="f-tmsound" ${s.tmSound !== false ? 'checked' : ''}> Geluid</label>
      <label>Volume<input type="range" id="f-tmvol" min="0.1" max="1" step="0.1" value="${esc(s.tmVol ?? 0.8)}"></label>
      <label class="toggle"><input type="checkbox" id="f-tmflash" ${s.tmFlash !== false ? 'checked' : ''}> Scherm flitst bij een signaal</label></div></details>
    <label class="toggle"><input type="checkbox" id="f-autonext" ${s.autoNext ? 'checked' : ''}> Volgende timer automatisch starten na opslaan</label>
    <label class="toggle"><input type="checkbox" id="f-ready" ${s.readiness !== false ? 'checked' : ''}> Readiness-check bij sessiestart (slaap, spierpijn, stress)</label>
    <details ${s.coachKey ? 'open' : ''}><summary>Coach (optioneel)</summary><div class="coachset">
      <label>Anthropic API-sleutel<input id="f-ckey" type="password" value="${esc(s.coachKey)}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off"><span class="hint">Blijft alleen op dit toestel (en gaat enkel naar Anthropic). Zonder sleutel werkt de app volledig, behalve de coach.</span></label>
      <label>Model<select id="f-cmodel">${Object.entries(Co.MODELS).map(([id, m]) => `<option value="${id}" ${s.coachModel === id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label>Taal van de coach<select id="f-clang"><option value="nl" ${s.coachLang !== 'en' ? 'selected' : ''}>Nederlands</option><option value="en" ${s.coachLang === 'en' ? 'selected' : ''}>English</option></select></label>
      <label>Eigen maandlimiet (USD, 0 = geen)<input id="f-climit" type="number" min="0" step="1" value="${esc(s.coachLimit)}" inputmode="decimal"><span class="hint">De app waarschuwt bij 80% en pauzeert de coach bij 100%. Stel in de Anthropic Console ook een harde limiet in.</span></label>
      <label>Link naar je coach-project (optioneel)<input id="f-curl" value="${esc(s.coachUrl)}" placeholder="https://claude.ai/project/…" autocomplete="off" autocapitalize="off"></label>
      <label class="toggle"><input type="checkbox" id="f-cquick" ${s.coachQuick !== false ? 'checked' : ''}> Losse vragen met Haiku (goedkoper); vragen met foto of video, reacties en weekoverzicht gebruiken het model hierboven</label>
      <label class="toggle"><input type="checkbox" id="f-cauto" ${s.coachAuto ? 'checked' : ''}> Automatisch coach-reactie na een afgeronde sessie</label>
      <label class="toggle"><input type="checkbox" id="f-clog" ${s.coachLog ? 'checked' : ''}> Reacties en wijzigingen bewaren in tab "Coach log" (je project kan ze lezen)</label></div></details>
    <details ${Pl.configured(s) ? 'open' : ''}><summary>Polar (optioneel)</summary><div class="coachset">
      <label>Adres van je Polar-Worker<input id="f-purl" value="${esc(s.polarUrl || '')}" placeholder="https://….workers.dev" autocomplete="off" autocapitalize="off"></label>
      <label>Toegangscode (APP_KEY)<input id="f-pkey" type="password" value="${esc(s.polarKey || '')}" autocomplete="off" autocapitalize="off"><span class="hint">Blijft alleen op dit toestel. Zonder adres en code doet de app niets met Polar.</span></label>
      <button class="btn" data-act="polar-test">Test verbinding</button></div></details>
    <button class="btn" data-act="csv">Logboek van dit tabblad exporteren (CSV)</button>
    <button class="btn primary" data-act="settings-save">Opslaan</button>` : ''}
    ${!first ? '<button class="btn" data-act="settings-close">Terug</button><button class="btn link" data-act="logout">Uitloggen</button>' : ''}
  </div>`;
  return first ? body : `<div class="sheetmodal"><div>${body}</div></div>`;
}

function tick() {
  document.querySelectorAll('[data-tick]').forEach((el) => {
    const d = el.dataset;
    const ms = d.acc !== undefined ? Number(d.acc) + (Number(d.run) ? Date.now() - Number(d.run) : 0) : Date.now() - Number(d.since);
    el.textContent = Sh.fmtElapsed(ms);
  });
}
setInterval(tick, 1000);

// ---------- coach ----------
const coachOn = () => !!String(S.settings.coachKey || '').trim();
const coachLang = () => (S.settings.coachLang === 'en' ? 'en' : 'nl');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function coachBlock() {
  if (!coachOn()) return { blocked: true, reason: 'Voeg je API-sleutel toe in ⚙ om de coach te gebruiken.' };
  if (!navigator.onLine) return { blocked: true, reason: 'Offline: de coach heeft internet nodig.' };
  const e = S.coach.err;
  if (e && Co.BLOCKING.has(e.kind)) return { blocked: true, reason: e.title };
  const ls = Co.limitState(S.coach.cost, +S.settings.coachLimit);
  if (ls.state === 'over') return { blocked: true, reason: 'Je eigen maandlimiet is bereikt (verhoog hem in ⚙).' };
  return { blocked: false };
}

function coachFail(e) {
  const info = e instanceof Co.CoachError ? e.info : Co.mapError({ message: e?.message });
  S.coach.err = { ...info, at: Date.now() };
  return info;
}

async function coachCall(userText, { history = false, maxTokens = 900, effort = 'low', withContext = true, images = [], model = S.settings.coachModel } = {}) {
  const blk = coachBlock();
  if (blk.blocked) throw new Co.CoachError({ kind: 'blocked', title: blk.reason, msg: blk.reason });
  const context = withContext && S.view ? Co.contextPack({ tab: S.settings.tab, rows: S.rows, week: S.view.week, dayIdx: S.view.dayIdx }) : '';
  const system = Co.systemPrompt({ lang: coachLang(), profile: S.coach.profile || [], memory: S.coach.memory || [], context });
  const prior = history ? S.coach.chat.slice(-12).map((m) => ({ role: m.role, content: m.content })) : [];
  const messages = Co.withImages(Co.normalizeMessages([...prior, { role: 'user', content: userText }]), images);
  let r = await Co.callClaude({ key: S.settings.coachKey.trim(), model, system, messages, maxTokens, effort });
  S.coach.cost = Co.addCost(S.coach.cost, model, r.usage);
  if (!r.text && model !== S.settings.coachModel) {            // the quick model returned nothing: try the chosen model once
    model = S.settings.coachModel;
    r = await Co.callClaude({ key: S.settings.coachKey.trim(), model, system, messages, maxTokens, effort });
    S.coach.cost = Co.addCost(S.coach.cost, model, r.usage);
  }
  if (!r.text && r.stop === 'max_tokens') {                    // all budget went to thinking: try once more with double room
    r = await Co.callClaude({ key: S.settings.coachKey.trim(), model, system, messages, maxTokens: Math.min(maxTokens * 2, 8000), effort });
    S.coach.cost = Co.addCost(S.coach.cost, model, r.usage);
  }
  save.coach();
  if (!r.text) throw new Co.CoachError(Co.emptyReplyError(r.stop));
  S.coach.err = null; save.coach();
  return Co.finalizeReply(r.text, r.stop);
}

// Haiku for plain questions; anything with an image goes to the model chosen in settings
// plan changes (swap, move, adjust) also go to the chosen model: they need more care than a plain question
const PLAN_CHANGE = /wissel|omwissel|verplaats|verschuif|verander|wijzig|aanpas|vervang|swap|move|change|replace/i;
const quickModel = (nImg = 0, text = '') => (S.settings.coachQuick !== false && !nImg && !PLAN_CHANGE.test(text) ? 'claude-haiku-5-5' : S.settings.coachModel);
function setBusy(v) {
  S.coach.busy = v;
  const focused = document.activeElement?.id === 'cdraft';
  render();
  if (focused) { const t = document.getElementById('cdraft'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }
}

// Coach log: rows wait in a local queue until they are written to the tab "Coach log" in your workbook.
function logCoach(entry) {
  if (!S.settings.coachLog) return;
  S.coach.logQ.push(entry); save.coach(); flushCoachLog();
}
async function flushCoachLog() {
  if (S.coach.logBusy || !S.coach.logQ.length || !configured() || !navigator.onLine || !Api.tokenValid()) return;
  S.coach.logBusy = true;
  const batch = S.coach.logQ.slice();
  try {
    if (!S.tabs.length || !hasTab(Co.COACH_TABS.log)) {
      S.tabs = (await Api.getMeta(S.settings.sheetId)).tabs;
      if (!hasTab(Co.COACH_TABS.log)) { await Api.addTab(S.settings.sheetId, Co.COACH_TABS.log); S.tabs = [...S.tabs, Co.COACH_TABS.log]; await Api.appendRows(S.settings.sheetId, Co.COACH_TABS.log, [Co.LOG_HEADER]); }
    }
    await Api.appendRows(S.settings.sheetId, Co.COACH_TABS.log, batch);
    S.coach.logQ = S.coach.logQ.slice(batch.length); save.coach();
  } catch { /* stays in the queue, retried at the next opportunity */ }
  S.coach.logBusy = false;
}

// An assistant answer may carry <voorstel> blocks: strip them and turn them into validated proposals.
function assistantMsg(raw) {
  const { text, proposals } = Co.parseProposals(raw);
  const props = proposals.map((p) => Co.resolveProposal(p, S.rows));
  return { role: 'assistant', content: text || (props.length ? 'Voorstel:' : raw), props: props.length ? props : undefined, at: Date.now() };
}

async function coachReact(week, dayIdx) {
  const k = dayKey(week, dayIdx);
  if (S.coach.busy) return;
  setBusy(`react:${k}`);
  try {
    const q = Co.shareText({ tab: S.settings.tab, kind: 'day', rows: S.rows, week, dayIdx });
    const am = assistantMsg(await coachCall(q, { maxTokens: 3000 }));
    S.coach.reactions[k] = { text: am.content, props: am.props ? am.props.length : 0, at: Date.now(), model: S.settings.coachModel };
    S.coach.chat.push({ role: 'user', label: `Reactie op ${Sh.DAYS[dayIdx]} week ${week}`, content: q, at: Date.now() }, am);
    logCoach(Co.logEntry({ soort: 'Sessie-reactie', over: `${Sh.DAYS[dayIdx]} W${week} (${S.settings.tab})`, antwoord: am.content, props: am.props || [], model: S.settings.coachModel }));
    save.coach();
  } catch (e) { if (e instanceof Co.CoachError && e.info.kind === 'blocked') toast(e.info.msg); else coachFail(e); }
  setBusy('');
}

// Follow-up question on a training: answer is shown under that day (and kept in the chat history for context).
async function coachDayAsk(week, dayIdx) {
  const k = dayKey(week, dayIdx), text = (S.coach.dayDraft || '').trim();
  if (!text || S.coach.busy) return;
  S.coach.chat.push({ role: 'user', content: text, label: '', shown: text, nImg: 0, at: Date.now() });
  setBusy(`dayq:${k}`);
  try {
    const am = assistantMsg(await coachCall(text, { history: true, maxTokens: 3000 }));
    S.coach.chat.push(am);
    const r = S.coach.reactions[k] || (S.coach.reactions[k] = { text: '', props: 0, at: Date.now(), model: S.settings.coachModel });
    (r.thread = r.thread || []).push({ q: text, a: am.content, props: am.props ? am.props.length : 0, at: Date.now() });
    S.coach.dayDraft = '';
    logCoach(Co.logEntry({ soort: 'Vraag', over: `${Sh.DAYS[dayIdx]} W${week} (${S.settings.tab})`, vraag: text, antwoord: am.content, props: am.props || [], model: S.settings.coachModel }));
    save.coach();
  } catch (e) {
    S.coach.chat.pop();                                      // question stays in the box, nothing lost
    if (e instanceof Co.CoachError && e.info.kind === 'blocked') toast(e.info.msg); else coachFail(e);
  }
  setBusy('');
}

function maybeAutoReact(week, dayIdx) {
  if (!S.settings.coachAuto || !coachOn()) return;
  if (S.coach.reactions[dayKey(week, dayIdx)] || S.coach.busy || coachBlock().blocked) return;
  if (Co.sessionDone(S.rows, week, dayIdx)) askReact(week, dayIdx);
}
function askReact(week, dayIdx) {
  askCall({ title: 'Reactie op de training vragen?', body: `De coach leest je sessie van ${Sh.DAYS[dayIdx]} week ${week} (plan, wat je logde, je profiel en geheugen) en geeft feedback.`, run: () => coachReact(week, dayIdx) });
}

async function coachWeek() {
  if (S.coach.busy || !S.view) return;
  const { week } = S.view;
  setBusy('week');
  try {
    const q = Co.shareText({ tab: S.settings.tab, kind: 'week', rows: S.rows, week, dayIdx: 0 });
    const am = assistantMsg(await coachCall(q, { maxTokens: 3500, effort: 'medium' }));
    const text = am.content;
    S.coach.chat.push({ role: 'user', label: `Weekoverzicht week ${week}`, content: q, at: Date.now() }, am);
    logCoach(Co.logEntry({ soort: 'Weekoverzicht', over: `W${week} (${S.settings.tab})`, antwoord: am.content, props: am.props || [], model: S.settings.coachModel }));
    save.coach();
    try {
      const mem = await coachCall(Co.memoryPrompt({ memory: S.coach.memory || [], reply: text, lang: coachLang() }), { maxTokens: 900, withContext: false });
      const parsed = Co.parseMemory(mem);
      if (parsed) { const diff = Co.memoryDiff(S.coach.memory || [], parsed); if (diff.some((d) => d.status !== 'gelijk')) S.coach.memProposal = diff; }
    } catch (e) { /* memory proposal is a bonus; the overview itself succeeded */ }
  } catch (e) { if (e instanceof Co.CoachError && e.info.kind === 'blocked') toast(e.info.msg); else coachFail(e); }
  setBusy('');
}

function scrollChatEnd() {                                   // the start of the newest message in view, input just below
  requestAnimationFrame(() => { const m = [...document.querySelectorAll('.chat > .msg')].pop(); if (m) m.scrollIntoView({ block: 'start' }); else window.scrollTo(0, 0); });
}
async function coachSend() {
  const att = S.coach.att;
  const text = (S.coach.draft || '').trim() || (att.length ? 'Wat zie je? Geef één fout en één cue.' : '');
  if (!text || S.coach.busy) return;
  const note = att.length ? Co.imageNote(att) : '';
  S.coach.chat.push({ role: 'user', content: note ? `${note}\n${text}` : text, label: '', shown: text, nImg: att.length, at: Date.now() });
  const keep = S.coach.draft; S.coach.draft = ''; S.coach.att = [];
  setBusy('chat');
  try {
    const reply = await coachCall(text, { history: true, maxTokens: 3000, images: att, model: quickModel(att.length, text) });
    S.coach.chat.push(assistantMsg(reply)); save.coach();
  } catch (e) {
    S.coach.chat.pop(); S.coach.draft = keep; S.coach.att = att;   // nothing lost: question and attachments are back
    if (e instanceof Co.CoachError && e.info.kind === 'blocked') toast(e.info.msg); else coachFail(e);
  }
  setBusy('');
  scrollChatEnd();
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
async function shareWithCoach(kind) {
  if (!S.view) return;
  const text = Co.shareText({ tab: S.settings.tab, kind, rows: S.rows, week: S.view.week, dayIdx: S.view.dayIdx });
  const copied = await copyText(text);
  if (navigator.share && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)) { try { await navigator.share({ text }); return; } catch (e) { if (e?.name === 'AbortError') return; } }
  toast(copied ? `Gekopieerd ✓${S.settings.coachUrl ? ' — plak het in je coach-project' : ''}` : 'Kopiëren lukte niet; selecteer de tekst handmatig.');
  if (S.settings.coachUrl && copied) window.open(S.settings.coachUrl, '_blank', 'noopener');
}

// coach tabs in the user's own workbook
const hasTab = (t) => S.tabs.includes(t);
async function ensureTab(t) { if (!hasTab(t)) { await Api.addTab(S.settings.sheetId, t); S.tabs = [...S.tabs, t]; } }
async function coachLoad(force = false) {
  if (!coachOn() && !force) return;
  if (!configured() || !navigator.onLine || !Api.tokenValid()) return;
  const filled = (S.coach.profile || []).length && (S.coach.memory || []).length;
  if (!force && Date.now() - S.coach.memTs < 3600e3 && filled) return;
  try {
    if (!S.tabs.length || !hasTab(Co.COACH_TABS.profile) || !hasTab(Co.COACH_TABS.memory)) S.tabs = (await Api.getMeta(S.settings.sheetId)).tabs;
    const p = hasTab(Co.COACH_TABS.profile) ? await Api.getValues(S.settings.sheetId, Co.COACH_TABS.profile) : [];
    const m = hasTab(Co.COACH_TABS.memory) ? await Api.getValues(S.settings.sheetId, Co.COACH_TABS.memory) : [];
    S.coach.profile = Co.parseTable(p, ['veld', 'inhoud']);
    S.coach.memory = Co.parseTable(m, ['sectie', 'inhoud', 'bijgewerkt']);
    S.coach.memTs = Date.now(); save.coach(); if (S.page === 'coach') renderSoft();
    flushCoachLog();
  } catch { /* offline or no access: keep the cached copy */ }
}
async function writeCoachTab(tab, header, rows) {
  if (!Api.tokenValid()) { toast('Log eerst opnieuw in (↻) om te kunnen bewaren.'); return false; }
  try { await ensureTab(tab); await Api.replaceValues(S.settings.sheetId, tab, [header, ...rows]); return true; }
  catch (e) { toast(`Bewaren mislukt: ${e.message}`); return false; }
}
async function saveMemory(list) {
  const rows = list.map((m) => ({ sectie: m.sectie, inhoud: m.inhoud, bijgewerkt: m.status === 'gelijk' && m.bijgewerkt ? m.bijgewerkt : today() }));
  if (await writeCoachTab(Co.COACH_TABS.memory, ['Sectie', 'Inhoud', 'Bijgewerkt'], rows.map((r) => [r.sectie, r.inhoud, r.bijgewerkt]))) {
    S.coach.memory = rows; S.coach.memProposal = null; S.coach.memTs = Date.now(); save.coach(); toast('Coachgeheugen bijgewerkt ✓'); render();
  }
}
async function saveProfile() {
  const rows = Co.PROFILE_FIELDS.map(([v], i) => ({ veld: v, inhoud: (document.getElementById(`cp-${i}`)?.value || '').trim() }));
  if (await writeCoachTab(Co.COACH_TABS.profile, ['Veld', 'Inhoud'], rows.map((r) => [r.veld, r.inhoud]))) {
    S.coach.profile = rows.filter((r) => r.inhoud); S.coach.memTs = Date.now(); save.coach(); toast('Profiel bewaard ✓'); render();
  }
}

// ---- Fase 3: photos and video frames (everything stays on the device until you send) ----
const loadImg = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Kon de foto niet lezen.')); i.src = url; });
function toJpeg(src, w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.8);
  return { data: url.split(',')[1], thumb: url };
}
async function framesFromVideo(file, n) {
  const url = URL.createObjectURL(file);
  try {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('Deze video kan de browser niet lezen. Probeer een foto of een kortere clip.')); });
    let dur = v.duration;
    if (!isFinite(dur)) {                                   // some recorders omit the duration
      await new Promise((res) => { v.onseeked = res; v.currentTime = 1e7; });
      dur = v.currentTime;
    }
    const out = [];
    for (const t of Co.frameTimes(dur, n)) {
      await new Promise((res) => { v.onseeked = res; v.currentTime = Math.min(t, Math.max(0, dur - 0.05)); });
      out.push({ kind: 'frame', t, ...toJpeg(v, v.videoWidth, v.videoHeight, 768) });
    }
    return out;
  } finally { URL.revokeObjectURL(url); }
}
async function addFiles(files) {
  S.coach.busy = 'media'; render();
  try {
    for (const f of files) {
      if (S.coach.att.length >= Co.MAX_IMAGES) { toast(`Maximaal ${Co.MAX_IMAGES} beelden per vraag.`); break; }
      if (/^video\//.test(f.type)) {
        const room = Co.MAX_IMAGES - S.coach.att.length;
        S.coach.att.push(...(await framesFromVideo(f, Math.min(8, room))));
      } else if (/^image\//.test(f.type)) {
        const url = URL.createObjectURL(f);
        try { const im = await loadImg(url); S.coach.att.push({ kind: 'photo', ...toJpeg(im, im.naturalWidth, im.naturalHeight, 1024) }); } finally { URL.revokeObjectURL(url); }
      }
    }
  } catch (e) { toast(e.message || 'Bijlage mislukt'); }
  S.coach.busy = ''; render();
}

// ---- Fase 4: apply / reject / undo a proposed change of Prescribed ----
async function writePrescribed(p, from, to) {
  if (!Api.tokenValid() || !navigator.onLine) throw new Error('Online en ingelogd nodig om de sheet aan te passen (tik op ↻).');
  const tab = S.settings.tab, id = S.settings.sheetId;
  const values = await Api.getValues(id, tab);
  const hi = Sh.findHeader(values); if (hi < 0) throw new Error('Kopregel niet gevonden.');
  const { map } = Sh.buildColumnMap(values[hi]);
  if (!('prescribed' in map)) throw new Error('Kolom Prescribed ontbreekt in de sheet.');
  const row = Sh.parseRows(values, hi, map, `${tab}§`).find((r) => r.rowNum === p.rowNum);
  if (!row || row.piece !== p.piece) throw new Error('De planning is intussen gewijzigd; vraag de coach om een nieuw voorstel.');
  if (row.prescribed.trim() !== from.trim()) throw new Error('Het plan is intussen aangepast; er is niets overschreven.');
  if (row.actual || row.loggedAt || S.queue.some((o) => o.type === 'piece' && o.key === row.key)) throw new Error('Dit onderdeel is al gelogd; het plan wordt niet meer aangepast.');
  const cell = { row: row.rowNum, col: map.prescribed, value: to };
  await Api.batchUpdate(id, [{ range: Sh.a1(tab, cell.row, cell.col), values: [[to]] }]);
  Sh.applyCells(values, [cell]);
  S.grids[tab] = { values, ts: Date.now(), sheetId: id, tab }; S.grid = S.grids[tab]; save.grid();
  rebuild();
}
async function proposalAct(mi, pi, act) {
  const p = S.coach.chat[mi]?.props?.[pi]; if (!p) return;
  if (act === 'reject') { if (p.status === 'nieuw') p.status = 'geweigerd'; save.coach(); render(); return; }
  try {
    if (act === 'apply' && p.status === 'nieuw') { await writePrescribed(p, p.old, p.new); p.status = 'toegepast'; toast('Plan aangepast ✓'); logCoach(Co.logEntry({ soort: 'Plan aangepast', over: `W${p.week} ${p.dag} ${p.piece}`, props: [p], model: S.settings.coachModel })); }
    else if (act === 'undo' && p.status === 'toegepast') { await writePrescribed(p, p.new, p.old); p.status = 'hersteld'; toast('Teruggezet ✓'); logCoach(Co.logEntry({ soort: 'Plan hersteld', over: `W${p.week} ${p.dag} ${p.piece}`, props: [p], model: S.settings.coachModel })); }
  } catch (e) { toast(e.message || 'Aanpassen mislukt'); }
  save.coach(); render();
}
const propHTML = (mi, pi, p) => {
  const lab = { nieuw: '', toegepast: '✓ toegepast', geweigerd: 'geweigerd', hersteld: 'teruggezet', ongeldig: '⚠ niet toepasbaar' }[p.status];
  const acts = p.status === 'nieuw' ? `<div class="actions"><button class="btn primary" data-act="prop-apply" data-m="${mi}" data-p="${pi}">Toepassen</button><button class="btn" data-act="prop-reject" data-m="${mi}" data-p="${pi}">Weigeren</button></div>`
    : p.status === 'toegepast' ? `<button class="btn link" data-act="prop-undo" data-m="${mi}" data-p="${pi}">Ongedaan maken</button>` : '';
  return `<div class="coachcard prop"><b>Voorstel: ${esc(Sh.DAYS[Sh.dayIndex(p.dag)] || p.dag)} week ${esc(p.week)} · ${esc(p.piece)}</b> ${lab ? `<small>${lab}</small>` : ''}
    ${p.old != null ? `<p><small>nu</small> ${esc(p.old)}</p>` : ''}<p><small>nieuw</small> <b>${esc(p.new)}</b></p>${p.reason ? `<p><small>${esc(p.reason)}</small></p>` : ''}${p.why ? `<p class="errline">${esc(p.why)}</p>` : ''}${acts}</div>`;
};

function rampHTML(it) {
  if (!S.coach.ramp[it.key]) return '';
  const bar = S.settings.barKg || 20;
  const target = Co.rampTarget(it, S.rows, { bar });
  if (!target) return '';
  const steps = Co.buildRamp(target, { bar });
  return `<div class="calc"><b>Opbouw naar ${Ld.fmtKg(target)} kg</b> <small>(stang ${bar} kg, per kant)</small>${steps.map((s) => `<br>${s.reps ? `${s.reps}×` : 'top'} <b>${Ld.fmtKg(s.kg)} kg</b> <small>${s.label === 'top' ? '' : s.label || `${s.pct}%`} → ${s.perSide.length ? s.perSide.map(Ld.fmtKg).join(' · ') : 'alleen stang'}</small>`).join('')}</div>`;
}

function pieceActionsHTML(it) {
  const k = esc(it.key);
  const ramp = Co.rampTarget(it, S.rows, { bar: S.settings.barKg || 20 }) ? `<button class="mini" data-act="ramp" data-key="${k}">🏋 Opbouw</button>` : '';
  const blk = coachBlock();
  const ask = `<button class="mini" data-act="ask" data-key="${k}" ${blk.blocked ? `disabled title="${esc(blk.reason)}"` : ''}>💬 Vraag coach</button>`;
  return `<div class="pacts">${TU.pieceButtons(it)}${ramp}${ask}</div>${rampHTML(it)}`;
}

function coachDayHTML(week, dayIdx, rs) {
  const k = dayKey(week, dayIdx);
  const r = S.coach.reactions[k];
  const busy = S.coach.busy === `react:${k}`;
  const blk = coachBlock();
  const any = rs.some((x) => x.actual || x.loggedAt);
  let card = '';
  if (busy) card = '<div class="coachcard"><b>🧑‍🏫 Coach</b><p>Denkt na…</p></div>';
  else if (r) {
    const dbusy = S.coach.busy === `dayq:${k}`;
    const thread = (r.thread || []).map((t) => `<div class="coachcard you"><b>🙋 Jij</b><p>${esc(t.q)}</p></div><div class="coachcard"><b>🧑‍🏫 Coach</b><div class="md">${Co.md(t.a)}</div>${t.props ? `<p><small>📝 ${t.props} voorstel(len) om het plan aan te passen — bekijk ze in de chat.</small></p>` : ''}</div>`).join('');
    card = `<div class="coachcard"><b>🧑‍🏫 Coach</b><div class="md">${Co.md(r.text)}</div>${r.props ? `<p><small>📝 ${r.props} voorstel(len) om het plan aan te passen — bekijk ze in de chat.</small></p>` : ''}<div class="actions">${r.props ? '<button class="btn" data-act="coach-ask-day">Bekijk voorstel</button>' : ''}<button class="btn link" data-act="coach-redo" ${blk.blocked ? 'disabled' : ''}>Opnieuw</button></div></div>${thread}${dbusy ? '<div class="coachcard"><b>🧑‍🏫 Coach</b><p>Denkt na…</p></div>' : ''}${S.coach.err && S.coach.err.kind !== 'blocked' && !blk.blocked ? `<div class="err"><b>${esc(S.coach.err.title)}</b><br>${esc(S.coach.err.msg)}</div>` : ''}<div class="askbox dayask"><textarea id="dday" rows="2" placeholder="Vraag door over deze training…">${esc(S.coach.dayDraft || '')}</textarea><button class="btn" data-act="day-send" ${blk.blocked || dbusy ? 'disabled' : ''}>Stuur</button></div>`;
  }
  else if (any && coachOn()) card = `<div class="coachcard"><b>🧑‍🏫 Coach</b>${S.coach.err && !blk.blocked ? `<p class="errline">${esc(S.coach.err.title)}</p>` : ''}<button class="btn" data-act="coach-redo" ${blk.blocked ? `disabled title="${esc(blk.reason)}"` : ''}>Coach-reactie op deze sessie</button>${blk.blocked ? `<small class="why2">${esc(blk.reason)}</small>` : ''}</div>`;
  return `${card}<div class="center"><button class="btn link" data-act="share" data-k="day">📤 Deel deze dag met je coach</button></div>`;
}

function coachHTML() {
  const c = S.coach, blk = coachBlock(), on = coachOn();
  const ls = Co.limitState(c.cost, +S.settings.coachLimit);
  const cost = c.cost && c.cost.month === Co.monthKey() ? c.cost : { usd: 0, n: 0 };
  let banner = '';
  if (c.err && !(c.err.kind === 'blocked')) banner = `<div class="err"><b>${esc(c.err.title)}</b><br>${esc(c.err.msg)}<div class="actions" style="margin-top:8px"><button class="btn" data-act="coach-retry">${Co.BLOCKING.has(c.err.kind) ? 'Ik heb het opgelost' : 'Probeer opnieuw'}</button>${c.err.kind === 'credits' || c.err.kind === 'auth' ? '<a class="btn" href="https://console.anthropic.com/settings/billing" target="_blank" rel="noopener">Console</a>' : ''}</div></div>`;
  else if (ls.state === 'over') banner = `<div class="err"><b>Je eigen maandlimiet is bereikt</b><br>Deze maand ${Co.fmtUsd(ls.used)} van ${Co.fmtUsd(+S.settings.coachLimit)}. Verhoog de limiet in ⚙ of wacht tot volgende maand. De coach staat zolang op pauze; loggen werkt gewoon.</div>`;
  else if (ls.state === 'warn') banner = `<div class="notice"><span>⚠ ${Math.round(ls.pct * 100)}% van je maandlimiet gebruikt (${Co.fmtUsd(ls.used)} van ${Co.fmtUsd(+S.settings.coachLimit)}).</span></div>`;
  const dis = blk.blocked || c.busy ? 'disabled' : '';
  const share = `<div class="row2"><button class="btn" data-act="share" data-k="day">📤 Deel dag</button><button class="btn" data-act="share" data-k="week">📤 Deel week</button></div>${S.settings.coachUrl ? `<a class="btn link center" href="${esc(S.settings.coachUrl)}" target="_blank" rel="noopener">Open coach-project ↗</a>` : ''}`;
  if (!on) {
    return `<div class="coachpage"><div class="setup"><h1>Coach</h1><p>De coach in de app is optioneel. Zonder API-sleutel kun je je training delen met je coach in Claude: tik op "Deel", plak in je project en je krijgt hetzelfde advies.</p>${share}<p class="hint">Wil je de coach in de app zelf? Voeg je eigen API-sleutel toe in ⚙ Instellingen → Coach.</p></div></div>`;
  }
  const userIdx = c.chat.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i >= 0);
  const KEEP = 3, start = c.chatAll || userIdx.length <= KEEP ? 0 : userIdx[userIdx.length - KEEP];
  const older = userIdx.length > KEEP ? `<button class="btn link" data-act="chat-older">${c.chatAll ? 'Oudere berichten verbergen' : `Oudere berichten tonen (${userIdx.length - KEEP})`}</button>` : '';
  const chat = older + c.chat.map((m, mi) => mi < start ? '' : `<div class="msg ${m.role}">${m.label ? `<small>${esc(m.label)}</small>` : m.role === 'user' ? `${m.nImg ? `<small>📎 ${m.nImg} beeld(en)</small>` : ''}${Co.md(m.shown ?? m.content)}` : ''}${m.role === 'assistant' ? `<div class="md">${Co.md(m.content)}</div>` : ''}${(m.props || []).map((p, pi) => propHTML(mi, pi, p)).join('')}</div>`).join('');
  const prop = c.memProposal ? `<div class="coachcard"><b>🧠 De coach wil dit onthouden</b>${c.memProposal.map((m) => `<p><small>${esc(m.status)}</small> <b>${esc(m.sectie)}</b>: ${esc(m.inhoud)}</p>`).join('')}<div class="actions"><button class="btn primary" data-act="mem-save">Bewaar</button><button class="btn" data-act="mem-drop">Negeer</button></div><small class="hint">Wijzigingen aan vrijgaves of blessures staan als "voorstel" tot jij ze bevestigt.</small></div>` : '';
  const know = (c.memory || []).map((m, i) => `<p><b>${esc(m.sectie)}</b> <small>${esc(m.bijgewerkt)}</small><br>${esc(m.inhoud)} <button class="btn link" data-act="mem-wrong" data-i="${i}">Dit klopt niet</button></p>`).join('') || '<p class="note">Nog niets onthouden. Na een weekoverzicht stelt de coach voor wat hij bewaart.</p>';
  const profVals = Object.fromEntries((c.profile || []).map((p) => [p.veld, p.inhoud]));
  const profForm = Co.PROFILE_FIELDS.map(([v, hint], i) => `<label>${esc(v)}<textarea id="cp-${i}" rows="8" placeholder="${esc(hint)}">${esc(profVals[v] || '')}</textarea></label>`).join('');
  return `<div class="coachpage">${banner}
    <div class="row2"><button class="btn" data-act="coach-day" ${dis} ${blk.blocked ? `title="${esc(blk.reason)}"` : ''}>Reactie op vandaag</button><button class="btn" data-act="coach-week" ${dis}>Weekoverzicht</button></div>
    ${blk.blocked && !(c.err && !(c.err.kind === 'blocked')) ? `<p class="hintline">${esc(blk.reason)}</p>` : ''}
    ${prop}
    <div class="chat">${chat || '<p class="note">Stel een vraag, vraag uitleg over een oefening of een opbouw, of tik hierboven.</p>'}${c.busy === 'chat' || c.busy === 'week' || c.busy === 'media' || c.busy.startsWith('react') ? '<div class="msg assistant"><small>De coach denkt na…</small></div>' : ''}</div>
    <div class="chips"><button data-act="coach-chip" data-t="Leg uit hoe ik deze oefening uitvoer: ">Leg uit</button><button data-act="coach-chip" data-t="Maak een opbouw (ramp) naar ">Opbouw</button><button data-act="coach-chip" data-t="Welk alternatief heb ik bij pijn aan ">Alternatief</button></div>
 ${c.att.length ? `<div class="thumbs">${c.att.map((a, i) => `<span class="thumb"><img src="${a.thumb}" alt=""><button data-act="att-del" data-i="${i}" aria-label="Verwijder">✕</button>${a.kind === 'frame' ? `<small>${a.t}s</small>` : ''}</span>`).join('')}</div><p class="hintline">${c.att.length} beeld(en) gaan mee met je volgende vraag (±${Math.round(c.att.length * 0.8)}k tokens extra). Video: je coach ziet frames, geen snelheid.</p>` : ''}
    <label class="btn attach ${dis ? 'off' : ''}">📎 Foto of video<input id="cfile" type="file" accept="image/*,video/*" multiple hidden ${dis}></label>
    ${c.err && c.err.kind !== 'blocked' ? `<div class="err"><b>${esc(c.err.title)}</b><br>${esc(c.err.msg)}</div>` : ''}
    <div class="askbox"><textarea id="cdraft" rows="12" placeholder="Vraag aan je coach…">${esc(c.draft)}</textarea><button class="btn primary" data-act="coach-send" ${dis}>Stuur</button></div>
    ${share}
    <details><summary>Wat de coach weet</summary>${know}</details>
    <details><summary>Mijn profiel</summary><div class="form" style="border:0;padding:0">${profForm}<button class="btn primary" data-act="prof-save">Profiel bewaren</button><button class="btn" data-act="coach-reload">↻ Opnieuw laden uit de sheet</button></div></details>
    <p class="hintline">Deze maand: ${Co.fmtUsd(cost.usd)} · ${cost.n} aanvragen${+S.settings.coachLimit > 0 ? ` · limiet ${Co.fmtUsd(+S.settings.coachLimit)}` : ''} · ${esc(S.settings.coachModel)} · de coach doet voorstellen, hij past niets zelf aan.</p></div>`;
}

// ---------- events ----------
function readSettingsForm() {
  const g = (id) => document.getElementById(id);
  if (g('f-client')) S.settings.clientId = g('f-client').value.trim();
  if (g('f-sheet')) { const id = Api.parseSheetId(g('f-sheet').value); if (id) S.settings.sheetId = id; }
  if (g('f-ledger')) { const v = g('f-ledger').value.trim(); S.settings.ledgerId = v ? Api.parseSheetId(v) : ''; }
  if (g('f-start')) S.settings.cycleStarts = { ...(S.settings.cycleStarts || {}), [S.formTab || S.settings.tab]: g('f-start').value };
  if (g('f-tab')) S.formTab = g('f-tab').value;
  if (g('f-bar')) S.settings.barKg = +g('f-bar').value === 15 ? 15 : 20;
  if (g('f-timers')) S.settings.timers = g('f-timers').checked;
  if (g('f-autonext')) S.settings.autoNext = g('f-autonext').checked;
  if (g('f-ready')) S.settings.readiness = g('f-ready').checked;
  if (g('f-cquick')) S.settings.coachQuick = g('f-cquick').checked;
  if (g('f-tmsound')) S.settings.tmSound = g('f-tmsound').checked;
  if (g('f-tmvol')) S.settings.tmVol = +g('f-tmvol').value || 0.8;
  if (g('f-tmflash')) S.settings.tmFlash = g('f-tmflash').checked;
  if (g('f-ckey')) S.settings.coachKey = g('f-ckey').value.trim();
  if (g('f-cmodel')) S.settings.coachModel = g('f-cmodel').value;
  if (g('f-clang')) S.settings.coachLang = g('f-clang').value === 'en' ? 'en' : 'nl';
  if (g('f-climit')) S.settings.coachLimit = Math.max(0, +g('f-climit').value || 0);
  if (g('f-curl')) S.settings.coachUrl = g('f-curl').value.trim();
  if (g('f-cauto')) S.settings.coachAuto = g('f-cauto').checked;
  if (g('f-clog')) S.settings.coachLog = g('f-clog').checked;
  if (g('f-purl')) S.settings.polarUrl = g('f-purl').value.trim();
  if (g('f-pkey')) S.settings.polarKey = g('f-pkey').value.trim();
}

async function connect() {
  readSettingsForm();
  S.formErr = '';
  const urlVal = document.getElementById('f-sheet')?.value || '';
  if (!S.settings.clientId) S.formErr = 'Vul je Google client-ID in.';
  else if (!Api.parseSheetId(urlVal)) S.formErr = 'Dit lijkt geen geldige Google Sheets-link.';
  if (S.formErr) return render();
  try {
    await Api.signIn(S.settings.clientId);
    const meta = await Api.getMeta(S.settings.sheetId);
    S.tabs = meta.tabs; S.settings.sheetTitle = meta.title;
    if (!meta.tabs.includes(S.settings.tab)) S.settings.tab = meta.tabs[0] || '';
    // Prefer the newest "Cycle N" tab, then any tab that actually has the Week/Piece header.
    for (const t of [...Sh.cycleTabs(meta.tabs), ...meta.tabs]) {
      try { const v = await Api.getValues(S.settings.sheetId, t); if (Sh.findHeader(v) >= 0) { S.settings.tab = t; break; } } catch { /* try next */ }
    }
    S.formTab = S.settings.tab; S.grid = S.grids[S.settings.tab] || null;
    save.settings();
  } catch (e) {
    S.formErr = e instanceof Api.AuthError ? 'Inloggen is niet gelukt of geannuleerd.'
      : e instanceof Api.ApiError ? (e.status === 404 ? 'Sheet niet gevonden: controleer de link en of dit Google-account erbij kan.' : e.message)
      : e.message;
  }
  render();
}

function finishSettings() {
  readSettingsForm();
  if (S.formTab && S.formTab !== S.settings.tab) { S.settings.tab = S.formTab; S.settings.autoTab = S.formTab === Sh.cycleTabs(S.tabs)[0]; S.view = null; }
  if (S.ledger && S.ledger.ledgerId !== S.settings.ledgerId) { S.ledger = null; LS.set('ledger', null); S.extrasTs = 0; }
  save.settings();
  S.showSettings = false;
  S.grid = S.grids[S.settings.tab] || null;
  if (S.grid && S.grid.sheetId !== S.settings.sheetId) S.grid = null;
  rebuild(); initView(); render(); sync();
}

function pickChip(btn) {
  const form = btn.closest('[data-form]'); const key = form.dataset.form;
  const d = S.drafts[key]; const f = btn.dataset.field; const v = btn.dataset.v;
  const same = d[f] === v;
  d[f] = same && f === 'badDay' ? '' : v;
  if (f === 'rpe' || f === 'pain') { const inp = form.querySelector(`[data-f="${f}"]`); if (inp) inp.value = d[f]; }
  btn.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', d[f] === b.dataset.v));
  persistDraftsSoon();
}

$app.addEventListener('click', (e) => {
  if (e.target.closest('[data-tm]')) { TU.click(e); return; }
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, key = b.dataset.key;
  switch (act) {
    case 'ready-set': case 'ready-save': case 'ready-skip': readyAction(b.dataset.act, b); break;
    case 'extra-open': extraOpen(); break;
    case 'x-toggle': case 'x-all': case 'x-rest': extraAction(b.dataset.act, b); break;
    case 'tp-week': case 'tp-day': tpAction(b); break;
    case 'move-open': moveOpen(); break;
    case 'mv-toggle': case 'mv-all': case 'mv-swap': case 'mv-cancel': case 'mv-go': moveAction(b.dataset.act, b); break;
    case 'mv-undo': moveUndo(); break;
    case 'mv-undo-x': S.lastMove = null; render(); break;
    case 'extra-cancel': S.extra = null; render(); break;
    case 'extra-save': saveExtra(); break;
    case 'gym-open': gymOpen(); break;
    case 'csv': exportCsv(); break;
    case 'pain-area': case 'pain-score': painAction(b.dataset.act, b.dataset.v); break;
    case 'pain-save': case 'pain-skip': painAction(b.dataset.act); break;
    case 'wkday': S.view.dayIdx = +b.dataset.i; S.page = 'train'; S.editSession = false; save.view(); render(); window.scrollTo(0, 0); break;
    case 'day': S.view.dayIdx = +b.dataset.i; S.editSession = false; save.view(); render(); window.scrollTo(0, 0); break;
    case 'week': { const ws = weeks(); const i = ws.indexOf(S.view.week) + +b.dataset.d; if (ws[i] != null) { S.view.week = ws[i]; S.editSession = false; save.view(); render(); } break; }
    case 'toggle': { const it = currentItem(key); const firstOpen = rowsOf(it.week, it.dayIdx).find((r) => Sh.status(r) === 'open'); const cur = S.open[key] ?? (firstOpen && firstOpen.key === key); S.open[key] = !cur; render(); break; }
    case 'close': S.open[key] = false; render(); break;
    case 'dismiss': S.dismissed[key] = true; save.dismissed(); render(); break;
    case 'chip': pickChip(b); break;
    case 'save': commitPiece(key); break;
    case 'quick': { const d = ensureDraft(currentItem(key)); if (!d.actual.trim()) d.actual = 'Gedaan'; commitPiece(key); break; }
    case 'skip': { const d = ensureDraft(currentItem(key)); d.actual = 'Skip'; commitPiece(key); break; }
    case 'ptimer': S.drafts[key]?.tRun ? pausePartTimer(key) : startPartTimer(key); break;
    case 'treset': resetPartTimer(key); break;
    case 'polar-help': S.polarHelp = !S.polarHelp; render(); break;
    case 'polar-fetch': polarFetch(); break;
    case 'polar-test': polarTest(); break;
    case 'sess-start': startSession(); break;
    case 'sess-end': endSession(); break;
    case 'sess-edit': S.editSession = true; render(); break;
    case 'sess-save': saveSessionTimes(document.getElementById('sStart').value, document.getElementById('sEnd').value); break;
    case 'refresh': toast('Verversen…'); kickSync(true); if (S.page === 'records') refreshExtras(true); break;
    case 'login': Api.signIn(S.settings.clientId).then(() => sync(), (err) => toast(err.message || 'Inloggen mislukt')); break;
    case 'settings': S.showSettings = true; S.formErr = ''; S.formTab = S.settings.tab; if (!S.tabs.length && S.settings.tab) S.tabs = [S.settings.tab]; render(); break;
    case 'settings-close': S.showSettings = false; render(); break;
    case 'settings-save': finishSettings(); break;
    case 'connect': connect(); break;
    case 'page': S.page = b.dataset.p; render(); window.scrollTo(0, 0); if (S.page === 'records') refreshExtras(); if (S.page === 'coach') { coachLoad(); scrollChatEnd(); } break;
    case 'chat-older': S.coach.chatAll = !S.coach.chatAll; render(); break;
    case 'tab-newest': { const n = Sh.cycleTabs(S.tabs)[0]; if (n) { S.settings.autoTab = true; switchTab(n, false); } break; }
    case 'rec': S.recOpen = S.recOpen === b.dataset.id ? '' : b.dataset.id; { const el = document.getElementById('reclist'); if (el) el.innerHTML = recListHTML(); } break;
    case 'recfilter': S.recFilter = b.dataset.v; render(); break;
    case 'extras': refreshExtras(true); break;
    case 'share': shareWithCoach(b.dataset.k); break;
    case 'ramp': S.coach.ramp[key] = !S.coach.ramp[key]; render(); break;
    case 'ask': { const it = currentItem(key); S.coach.draft = `Over "${it.piece}" (${it.prescribed}): `; S.page = 'coach'; render(); window.scrollTo(0, document.body.scrollHeight); document.getElementById('cdraft')?.focus(); coachLoad(); break; }
    case 'coach-day': askReact(S.view.week, S.view.dayIdx); break;
    case 'coach-redo': askReact(S.view.week, S.view.dayIdx); break;
    case 'day-send': {
      const t = (S.coach.dayDraft || '').trim(); if (!t) break;
      const { week, dayIdx } = S.view;
      askCall({ history: true, extraChars: t.length, title: 'Vraag stellen aan de coach?', body: `"${t.length > 160 ? t.slice(0, 160) + '…' : t}" De coach krijgt ook je profiel, geheugen en de huidige sessie mee. Het antwoord komt onder deze training.`, run: () => coachDayAsk(week, dayIdx) });
      break;
    }
    case 'coach-ask-day': S.coach.draft = ''; S.page = 'coach'; render(); document.getElementById('cdraft')?.focus(); coachLoad(); break;
    case 'coach-week': askCall({ title: 'Weekoverzicht vragen?', body: `De coach leest alle sessies van week ${S.view.week} en maakt een overzicht. Daarna doet hij (2e aanvraag) een voorstel wat hij mag onthouden; dat bewaart pas als jij het goedkeurt.`, n: 2, extraChars: 4000, run: coachWeek }); break;
    case 'ask-go': { const r = S.ask && S.ask.run; S.ask = null; render(); if (r) r(); break; }
    case 'ask-no': S.ask = null; render(); break;
    case 'coach-send': {
      const t = (S.coach.draft || '').trim(), na = S.coach.att.length;
      if (!t && !na) break;
      askCall({ model: quickModel(na, t), history: true, extraChars: (t || '').length + na * 1500, title: 'Vraag stellen aan de coach?', body: `${t ? `"${t.length > 160 ? t.slice(0, 160) + '…' : t}"` : 'Je bijlagen zonder tekst.'}${na ? ` + ${na} beeld(en) (kost extra tokens).` : ''} De coach krijgt ook je profiel, geheugen en de huidige sessie mee.`, run: coachSend });
      break;
    }
    case 'coach-retry': S.coach.err = null; render(); break;
    case 'coach-chip': S.coach.draft = (S.coach.draft ? `${S.coach.draft.trim()} ` : '') + b.dataset.t; render(); { const t = document.getElementById('cdraft'); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } } break;
    case 'mem-save': saveMemory(S.coach.memProposal); break;
    case 'mem-drop': S.coach.memProposal = null; render(); break;
    case 'mem-wrong': { const m = S.coach.memory[+b.dataset.i]; if (m && window.confirm(`"${m.sectie}" uit het geheugen verwijderen?`)) saveMemory(S.coach.memory.filter((_, i) => i !== +b.dataset.i).map((x) => ({ ...x, status: 'gelijk' }))); break; }
    case 'prof-save': saveProfile(); break;
    case 'coach-reload': toast('Laden…'); coachLoad(true).then(() => toast('Profiel en geheugen herladen ✓')); break;
    case 'att-del': S.coach.att.splice(+b.dataset.i, 1); render(); break;
    case 'prop-apply': proposalAct(+b.dataset.m, +b.dataset.p, 'apply'); break;
    case 'prop-reject': proposalAct(+b.dataset.m, +b.dataset.p, 'reject'); break;
    case 'prop-undo': proposalAct(+b.dataset.m, +b.dataset.p, 'undo'); break;
    case 'logout': Api.signOut(); S.showSettings = false; setSync('login'); render(); break;
  }
});

$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'cfile') { const fs = [...el.files]; el.value = ''; if (fs.length) addFiles(fs); return; }
  if (el.id === 'tabsel') switchTab(el.value, true);
  else if (el.id === 'f-tab') { readSettingsForm(); render(); }
});

$app.addEventListener('input', (e) => {
  if (e.target.id === 'recq') { S.recQ = e.target.value; const el = document.getElementById('reclist'); if (el) el.innerHTML = recListHTML(); return; }
  if (e.target.id === 'cdraft') { S.coach.draft = e.target.value; return; }
  if (e.target.id === 'dday') { S.coach.dayDraft = e.target.value; return; }
  const el = e.target; const f = el.dataset?.f; if (!f) return;
  const form = el.closest('[data-form]'); if (!form) return;
  const d = S.drafts[form.dataset.form]; if (!d) return;
  d[f] = el.value;
  if (f === 'start' || f === 'end') d.durMin = null;
  if (f === 'rpe' || f === 'pain') form.querySelectorAll(`[data-chips="${f}"] button`).forEach((b) => b.classList.toggle('on', d[f].trim() === b.dataset.v));
  persistDraftsSoon();
});

window.addEventListener('online', () => sync());
window.addEventListener('offline', () => setSync('offline'));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && configured()) sync(); });
setInterval(() => { if (S.queue.length && S.sync.state !== 'login') sync(); }, 30000);

// ---------- boot ----------
(function boot() {
  if (S.grid && (S.grid.sheetId !== S.settings.sheetId || S.grid.tab !== S.settings.tab)) S.grid = null;
  rebuild();
  if (S.timers.part && S.timers.part.startMs) {            // timer saved by the previous version
    const { key, startMs } = S.timers.part; const it = currentItem(key);
    S.timers.part = it ? { key } : null;
    if (it) { const d = ensureDraft(it); d.tRun = startMs; d.tAcc = 0; save.drafts(); }
    save.timers();
  }
  initView();
  render();
  TU.init({ getItem: currentItem, ensureDraft, saveDrafts: () => save.drafts(), rerender: () => render(), settings: () => S.settings, toast,
    openPiece: (key) => { S.open[key] = true; render(); document.querySelector(`.piece[data-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'center' }); } });
  if (configured()) {
    Api.loadGsi().catch(() => {});
    sync();
  } else {
    Api.loadGsi().catch(() => {});
  }
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !navigator.webdriver) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
