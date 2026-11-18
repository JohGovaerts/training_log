import * as Sh from './sheet.js';
import * as Api from './api.js';
import * as Rec from './records.js';
import * as Ld from './loading.js';
import * as Co from './coach.js';

const $app = document.getElementById('app');
const $toast = document.getElementById('toast');

// ---------- persistence ----------
const LS = {
  get(k, d) { try { const v = localStorage.getItem('logapp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('logapp.' + k, JSON.stringify(v)); } catch { /* private mode etc. */ } },
};

const S = {
  settings: { clientId: window.LOGAPP_CONFIG?.clientId || '', sheetId: '', sheetTitle: '', tab: '', cycleStarts: {}, ledgerId: '', autoTab: true, timers: true, autoNext: true, barKg: 20, coachKey: '', coachModel: 'claude-sonnet-5-5', coachLang: 'nl', coachLimit: 5, coachUrl: '', coachAuto: true, coachLog: true, ...LS.get('settings', {}) },
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
  S.headerIdx = hi; S.map = map; S.newHeaders = newHeaders;
  const base = Sh.parseRows(g, hi, map, `${S.settings.tab}§`);
  for (const op of S.queue.filter((o) => (o.tab || S.settings.tab) === S.settings.tab)) {
    const cells = Sh.planWrites(base, map, op);
    if (cells) { Sh.applyCells(g, cells); S.pendingKeys.add(op.type === 'piece' ? op.key : dayKey(op.week, op.dayIdx)); }
  }
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
  rebuild(); render(); toast('Training afgerond ✓'); kickSync(true);
}
function saveSessionTimes(start, end) {
  if (!start || !end) { toast('Vul start en einde in.'); return; }
  S.queue.push({ type: 'session', tab: S.settings.tab, week: S.view.week, dayIdx: S.view.dayIdx, fields: { sStart: start, sEnd: end }, at: Date.now() });
  S.editSession = false; save.queue(); rebuild(); render(); kickSync(true);
}

// ---------- sync ----------
function setSync(state, msg = '') { S.sync = { state, msg, at: state === 'ok' ? Date.now() : S.sync.at }; renderChip(); }

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
  const rows = Sh.parseRows(values, hi, map, `${tab}§`);
  const cells = [], done = [];
  const ops = S.queue.filter((o) => (o.tab || S.settings.tab) === tab);
  for (const h of newHeaders) cells.push({ row: hi + 1, col: h.col, value: h.title });
  for (const op of ops) {
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
  const data = cells.map((c) => ({ range: Sh.a1(tab, c.row, c.col), values: [[c.value]] }));
  await Api.batchUpdate(S.settings.sheetId, data);
  Sh.applyCells(values, cells);
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
  $app.innerHTML = mainHTML() + (S.showSettings ? settingsHTML(false) : '');
  tick();
}

function mainHTML() {
  if (S.page === 'records') return topHTML() + recordsHTML();
  if (S.page === 'coach') return topHTML() + coachHTML();
  if (S.err) return topHTML() + `<div class="setup"><div class="err">${esc(S.err)}</div><button class="btn" data-act="settings">Instellingen</button></div>`;
  if (!S.rows.length) return topHTML() + `<div class="rest"><b>Nog geen planning geladen</b>${S.sync.state === 'login' ? 'Log in om de sheet te laden.' : 'Even geduld…'}</div>`;
  const { week, dayIdx } = S.view;
  return topHTML() + noticeHTML() + sessionBannerHTML() + dayHTML(week, dayIdx);
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
      <button class="iconbtn" data-act="refresh" aria-label="Verversen">↻</button>
      <button class="iconbtn" data-act="settings" aria-label="Instellingen">⚙</button></div>
    <div class="seg"><button class="${train ? 'on' : ''}" data-act="page" data-p="train">Training</button><button class="${S.page === 'records' ? 'on' : ''}" data-act="page" data-p="records">Records</button><button class="${S.page === 'coach' ? 'on' : ''}" data-act="page" data-p="coach">Coach</button></div>
    ${train && S.view ? `<div class="weeknav"><button class="iconbtn" data-act="week" data-d="-1" ${week <= ws[0] ? 'disabled' : ''} aria-label="Vorige week">‹</button>
      <div><b>${S.cycles.length === 1 ? `Cycle ${esc(S.cycles[0])} · ` : ''}Week ${week}</b><small>${range}</small></div>
      <button class="iconbtn" data-act="week" data-d="1" ${week >= ws[ws.length - 1] ? 'disabled' : ''} aria-label="Volgende week">›</button></div>
    <nav class="days">${tabs}</nav>` : ''}
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
    return `<div class="dayhead"><h2>${title}</h2></div><div class="rest"><b>Rustdag 😴</b>Niets gepland. Herstel, slaap en eet goed.</div>`;
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
  return `<div class="dayhead"><h2>${title}${optional ? '<span class="badge">optioneel</span>' : ''}</h2><p>${esc(focus)} · ${done}/${rs.length} gelogd</p></div>
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

function lastHTML(it) {
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
    `<p class="hintline">${upd}${S.extrasBusy ? ' · verversen…' : ''} · Betrouwbaarheid is een indicatie op basis van leeftijd, testtype en noot.</p><div id="reclist">${recListHTML()}</div>`;
}

function settingsHTML(first) {
  const s = S.settings;
  const connected = S.tabs.length > 0 || s.tab;
  const body = `<div class="setup">
    <h1>${first ? 'Koppel je planning' : 'Instellingen'}</h1>
    ${first ? '<p>Eenmalig instellen. Zie de README voor het aanmaken van een Google client-ID (5 min).</p>' : ''}
    ${S.formErr ? `<div class="err">${esc(S.formErr)}</div>` : ''}
    <label>Google client-ID<input id="f-client" value="${esc(s.clientId)}" placeholder="123…apps.googleusercontent.com" autocomplete="off" autocapitalize="off"></label>
    <label>Link naar je Google Sheet<input id="f-sheet" value="${esc(s.sheetId ? `https://docs.google.com/spreadsheets/d/${s.sheetId}` : '')}" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" autocapitalize="off"></label>
    <button class="btn primary" data-act="connect">${connected ? 'Opnieuw verbinden' : 'Verbinden met Google'}</button>
    ${connected ? `<label>Tabblad (cyclus)<select id="f-tab">${(S.tabs.length ? S.tabs.filter((t) => t === s.tab || !Object.values(Co.COACH_TABS).includes(t)) : [s.tab]).map((t) => `<option ${t === (S.formTab || s.tab) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <label>Maandag van week 1 (voor dit tabblad)<input type="date" id="f-start" value="${esc((s.cycleStarts || {})[S.formTab || s.tab] || '')}"><span class="hint">Zo weet de app welke dag het vandaag is en toont hij datums. Elke cyclus heeft zijn eigen startdatum.</span></label>
    <label>Link naar je PR Ledger (optioneel)<input id="f-ledger" value="${esc(s.ledgerId ? `https://docs.google.com/spreadsheets/d/${s.ledgerId}` : '')}" placeholder="https://docs.google.com/spreadsheets/d/…" autocomplete="off" autocapitalize="off"><span class="hint">Voor de Records-pagina en de laatste score per onderdeel. Alleen lezen.</span></label>
    <label>Stang<select id="f-bar"><option value="20" ${+s.barKg !== 15 ? 'selected' : ''}>20 kg (man)</option><option value="15" ${+s.barKg === 15 ? 'selected' : ''}>15 kg (vrouw)</option></select><span class="hint">Voor de berekening van de plaatjes per kant.</span></label>
    <label class="toggle"><input type="checkbox" id="f-timers" ${s.timers ? 'checked' : ''}> Timers (sessie en per onderdeel)</label>
    <label class="toggle"><input type="checkbox" id="f-autonext" ${s.autoNext ? 'checked' : ''}> Volgende timer automatisch starten na opslaan</label>
    <details ${s.coachKey ? 'open' : ''}><summary>Coach (optioneel)</summary><div class="coachset">
      <label>Anthropic API-sleutel<input id="f-ckey" type="password" value="${esc(s.coachKey)}" placeholder="sk-ant-…" autocomplete="off" autocapitalize="off"><span class="hint">Blijft alleen op dit toestel (en gaat enkel naar Anthropic). Zonder sleutel werkt de app volledig, behalve de coach.</span></label>
      <label>Model<select id="f-cmodel">${Object.entries(Co.MODELS).map(([id, m]) => `<option value="${id}" ${s.coachModel === id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>
      <label>Taal van de coach<select id="f-clang"><option value="nl" ${s.coachLang !== 'en' ? 'selected' : ''}>Nederlands</option><option value="en" ${s.coachLang === 'en' ? 'selected' : ''}>English</option></select></label>
      <label>Eigen maandlimiet (USD, 0 = geen)<input id="f-climit" type="number" min="0" step="1" value="${esc(s.coachLimit)}" inputmode="decimal"><span class="hint">De app waarschuwt bij 80% en pauzeert de coach bij 100%. Stel in de Anthropic Console ook een harde limiet in.</span></label>
      <label>Link naar je coach-project (optioneel)<input id="f-curl" value="${esc(s.coachUrl)}" placeholder="https://claude.ai/project/…" autocomplete="off" autocapitalize="off"></label>
      <label class="toggle"><input type="checkbox" id="f-cauto" ${s.coachAuto ? 'checked' : ''}> Automatisch coach-reactie na een afgeronde sessie</label>
      <label class="toggle"><input type="checkbox" id="f-clog" ${s.coachLog ? 'checked' : ''}> Reacties en wijzigingen bewaren in tab "Coach log" (je project kan ze lezen)</label></div></details>
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

async function coachCall(userText, { history = false, maxTokens = 900, withContext = true, images = [] } = {}) {
  const blk = coachBlock();
  if (blk.blocked) throw new Co.CoachError({ kind: 'blocked', title: blk.reason, msg: blk.reason });
  const context = withContext && S.view ? Co.contextPack({ tab: S.settings.tab, rows: S.rows, week: S.view.week, dayIdx: S.view.dayIdx }) : '';
  const system = Co.systemPrompt({ lang: coachLang(), profile: S.coach.profile || [], memory: S.coach.memory || [], context });
  const prior = history ? S.coach.chat.slice(-12).map((m) => ({ role: m.role, content: m.content })) : [];
  const messages = Co.withImages(Co.normalizeMessages([...prior, { role: 'user', content: userText }]), images);
  const r = await Co.callClaude({ key: S.settings.coachKey.trim(), model: S.settings.coachModel, system, messages, maxTokens });
  S.coach.cost = Co.addCost(S.coach.cost, S.settings.coachModel, r.usage);
  S.coach.err = null; save.coach();
  return r.text;
}

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
    const am = assistantMsg(await coachCall(q, { maxTokens: 800 }));
    S.coach.reactions[k] = { text: am.content, props: am.props ? am.props.length : 0, at: Date.now(), model: S.settings.coachModel };
    S.coach.chat.push({ role: 'user', label: `Reactie op ${Sh.DAYS[dayIdx]} week ${week}`, content: q, at: Date.now() }, am);
    logCoach(Co.logEntry({ soort: 'Sessie-reactie', over: `${Sh.DAYS[dayIdx]} W${week} (${S.settings.tab})`, antwoord: am.content, props: am.props || [], model: S.settings.coachModel }));
    save.coach();
  } catch (e) { if (e instanceof Co.CoachError && e.info.kind === 'blocked') toast(e.info.msg); else coachFail(e); }
  setBusy('');
}

function maybeAutoReact(week, dayIdx) {
  if (!S.settings.coachAuto || !coachOn()) return;
  if (S.coach.reactions[dayKey(week, dayIdx)] || S.coach.busy || coachBlock().blocked) return;
  if (Co.sessionDone(S.rows, week, dayIdx)) coachReact(week, dayIdx);
}

async function coachWeek() {
  if (S.coach.busy || !S.view) return;
  const { week } = S.view;
  setBusy('week');
  try {
    const q = Co.shareText({ tab: S.settings.tab, kind: 'week', rows: S.rows, week, dayIdx: 0 });
    const am = assistantMsg(await coachCall(q, { maxTokens: 1200 }));
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

async function coachSend() {
  const att = S.coach.att;
  const text = (S.coach.draft || '').trim() || (att.length ? 'Wat zie je? Geef één fout en één cue.' : '');
  if (!text || S.coach.busy) return;
  const note = att.length ? Co.imageNote(att) : '';
  S.coach.chat.push({ role: 'user', content: note ? `${note}\n${text}` : text, label: '', shown: text, nImg: att.length, at: Date.now() });
  const keep = S.coach.draft; S.coach.draft = ''; S.coach.att = [];
  setBusy('chat');
  try {
    const reply = await coachCall(text, { history: true, maxTokens: 900, images: att });
    S.coach.chat.push(assistantMsg(reply)); save.coach();
  } catch (e) {
    S.coach.chat.pop(); S.coach.draft = keep; S.coach.att = att;   // nothing lost: question and attachments are back
    if (e instanceof Co.CoachError && e.info.kind === 'blocked') toast(e.info.msg); else coachFail(e);
  }
  setBusy('');
  window.scrollTo(0, document.body.scrollHeight);
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
  return `<div class="pacts">${ramp}${ask}</div>${rampHTML(it)}`;
}

function coachDayHTML(week, dayIdx, rs) {
  const k = dayKey(week, dayIdx);
  const r = S.coach.reactions[k];
  const busy = S.coach.busy === `react:${k}`;
  const blk = coachBlock();
  const any = rs.some((x) => x.actual || x.loggedAt);
  let card = '';
  if (busy) card = '<div class="coachcard"><b>🧑‍🏫 Coach</b><p>Denkt na…</p></div>';
  else if (r) card = `<div class="coachcard"><b>🧑‍🏫 Coach</b><div class="md">${Co.md(r.text)}</div>${r.props ? `<p><small>📝 ${r.props} voorstel(len) om het plan aan te passen — bekijk ze in de chat.</small></p>` : ''}<div class="actions"><button class="btn" data-act="coach-ask-day">${r.props ? 'Bekijk voorstel' : 'Vraag door'}</button><button class="btn link" data-act="coach-redo" ${blk.blocked ? 'disabled' : ''}>Opnieuw</button></div></div>`;
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
  const chat = c.chat.map((m, mi) => `<div class="msg ${m.role}">${m.label ? `<small>${esc(m.label)}</small>` : m.role === 'user' ? `${m.nImg ? `<small>📎 ${m.nImg} beeld(en)</small>` : ''}${Co.md(m.shown ?? m.content)}` : ''}${m.role === 'assistant' ? `<div class="md">${Co.md(m.content)}</div>` : ''}${(m.props || []).map((p, pi) => propHTML(mi, pi, p)).join('')}</div>`).join('');
  const prop = c.memProposal ? `<div class="coachcard"><b>🧠 De coach wil dit onthouden</b>${c.memProposal.map((m) => `<p><small>${esc(m.status)}</small> <b>${esc(m.sectie)}</b>: ${esc(m.inhoud)}</p>`).join('')}<div class="actions"><button class="btn primary" data-act="mem-save">Bewaar</button><button class="btn" data-act="mem-drop">Negeer</button></div><small class="hint">Wijzigingen aan vrijgaves of blessures staan als "voorstel" tot jij ze bevestigt.</small></div>` : '';
  const know = (c.memory || []).map((m, i) => `<p><b>${esc(m.sectie)}</b> <small>${esc(m.bijgewerkt)}</small><br>${esc(m.inhoud)} <button class="btn link" data-act="mem-wrong" data-i="${i}">Dit klopt niet</button></p>`).join('') || '<p class="note">Nog niets onthouden. Na een weekoverzicht stelt de coach voor wat hij bewaart.</p>';
  const profVals = Object.fromEntries((c.profile || []).map((p) => [p.veld, p.inhoud]));
  const profForm = Co.PROFILE_FIELDS.map(([v, hint], i) => `<label>${esc(v)}<textarea id="cp-${i}" rows="2" placeholder="${esc(hint)}">${esc(profVals[v] || '')}</textarea></label>`).join('');
  return `<div class="coachpage">${banner}
    <div class="row2"><button class="btn" data-act="coach-day" ${dis} ${blk.blocked ? `title="${esc(blk.reason)}"` : ''}>Reactie op vandaag</button><button class="btn" data-act="coach-week" ${dis}>Weekoverzicht</button></div>
    ${blk.blocked && !(c.err && !(c.err.kind === 'blocked')) ? `<p class="hintline">${esc(blk.reason)}</p>` : ''}
    ${prop}
    <div class="chat">${chat || '<p class="note">Stel een vraag, vraag uitleg over een oefening of een opbouw, of tik hierboven.</p>'}${c.busy === 'chat' || c.busy === 'week' || c.busy === 'media' || c.busy.startsWith('react') ? '<div class="msg assistant"><small>De coach denkt na…</small></div>' : ''}</div>
    <div class="chips"><button data-act="coach-chip" data-t="Leg uit hoe ik deze oefening uitvoer: ">Leg uit</button><button data-act="coach-chip" data-t="Maak een opbouw (ramp) naar ">Opbouw</button><button data-act="coach-chip" data-t="Welk alternatief heb ik bij pijn aan ">Alternatief</button></div>
 ${c.att.length ? `<div class="thumbs">${c.att.map((a, i) => `<span class="thumb"><img src="${a.thumb}" alt=""><button data-act="att-del" data-i="${i}" aria-label="Verwijder">✕</button>${a.kind === 'frame' ? `<small>${a.t}s</small>` : ''}</span>`).join('')}</div><p class="hintline">${c.att.length} beeld(en) gaan mee met je volgende vraag (±${Math.round(c.att.length * 0.8)}k tokens extra). Video: je coach ziet frames, geen snelheid.</p>` : ''}
    <label class="btn attach ${dis ? 'off' : ''}">📎 Foto of video<input id="cfile" type="file" accept="image/*,video/*" multiple hidden ${dis}></label>
    <div class="askbox"><textarea id="cdraft" rows="2" placeholder="Vraag aan je coach…">${esc(c.draft)}</textarea><button class="btn primary" data-act="coach-send" ${dis}>Stuur</button></div>
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
  if (g('f-ckey')) S.settings.coachKey = g('f-ckey').value.trim();
  if (g('f-cmodel')) S.settings.coachModel = g('f-cmodel').value;
  if (g('f-clang')) S.settings.coachLang = g('f-clang').value === 'en' ? 'en' : 'nl';
  if (g('f-climit')) S.settings.coachLimit = Math.max(0, +g('f-climit').value || 0);
  if (g('f-curl')) S.settings.coachUrl = g('f-curl').value.trim();
  if (g('f-cauto')) S.settings.coachAuto = g('f-cauto').checked;
  if (g('f-clog')) S.settings.coachLog = g('f-clog').checked;
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
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, key = b.dataset.key;
  switch (act) {
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
    case 'page': S.page = b.dataset.p; render(); window.scrollTo(0, 0); if (S.page === 'records') refreshExtras(); if (S.page === 'coach') coachLoad(); break;
    case 'tab-newest': { const n = Sh.cycleTabs(S.tabs)[0]; if (n) { S.settings.autoTab = true; switchTab(n, false); } break; }
    case 'rec': S.recOpen = S.recOpen === b.dataset.id ? '' : b.dataset.id; { const el = document.getElementById('reclist'); if (el) el.innerHTML = recListHTML(); } break;
    case 'recfilter': S.recFilter = b.dataset.v; render(); break;
    case 'extras': refreshExtras(true); break;
    case 'share': shareWithCoach(b.dataset.k); break;
    case 'ramp': S.coach.ramp[key] = !S.coach.ramp[key]; render(); break;
    case 'ask': { const it = currentItem(key); S.coach.draft = `Over "${it.piece}" (${it.prescribed}): `; S.page = 'coach'; render(); window.scrollTo(0, document.body.scrollHeight); document.getElementById('cdraft')?.focus(); coachLoad(); break; }
    case 'coach-day': coachReact(S.view.week, S.view.dayIdx).then(() => window.scrollTo(0, document.body.scrollHeight)); break;
    case 'coach-redo': coachReact(S.view.week, S.view.dayIdx); break;
    case 'coach-ask-day': S.coach.draft = ''; S.page = 'coach'; render(); document.getElementById('cdraft')?.focus(); coachLoad(); break;
    case 'coach-week': coachWeek(); break;
    case 'coach-send': coachSend(); break;
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
