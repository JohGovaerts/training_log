// Full-screen interval timer + the rest bar for sets. Owns its own DOM (#tm, #tmrest) outside #app,
// so the app's render() never wipes a running timer.
import * as T from './timer.js';

const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(`logapp.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`logapp.${k}`, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let ctx = null;                       // { getItem, ensureDraft, saveDrafts, openPiece, toast, settings }
const beeper = new T.Beeper();
const wake = new T.WakeKeeper();
const schedM = new T.Scheduler(beeper, (e, d) => flash(e, d));
const schedR = new T.Scheduler(beeper, () => {});
let $tm, $rest, loopId = null;

// main timer state
let M = LS.get('tm', null) || { stage: null };      // stage: null | setup | ready | run | result
let plan = null, events = [], lastSeg = -2;
// rest bar state + per piece set counters
let R = LS.get('tmrest', null);
const sets = LS.get('tmsets', {});
const saveM = () => LS.set('tm', M);
const saveR = () => LS.set('tmrest', R);

// Prescribed wins (so Intent text never leaks into movement names); Intent fills in what is missing.
const cfgOf = (it) => {
  const c = T.parseTimer(it.prescribed) || T.parseTimer(it.intent);
  if (c && c.type === 'fortime' && (!c.cap || !c.target)) {
    const both = T.parseTimer(`${it.prescribed} ${it.intent}`);
    if (both && both.type === 'fortime') return { ...c, cap: c.cap || both.cap, target: c.target || both.target };
  }
  return c;
};
const now = () => Date.now();
const settings = () => (ctx ? ctx.settings() : {});

export function init(c) {
  ctx = c;
  $tm = document.createElement('div'); $tm.id = 'tm'; $tm.hidden = true; document.body.appendChild($tm);
  $rest = document.createElement('div'); $rest.id = 'tmrest'; $rest.hidden = true; document.body.appendChild($rest);
  $tm.addEventListener('click', onClick); $rest.addEventListener('click', onClick);
  $tm.addEventListener('change', (e) => { if (e.target.id === 'tm-type') { M.cfgDraft = { ...(M.cfgDraft || {}), type: e.target.value }; renderTm(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    wake.renew(); beeper.resume();
    resync();
  });
  if (M.stage === 'run' || M.stage === 'result' || M.stage === 'ready') {
    if (M.cfg) { plan = T.buildPlan(M.cfg); events = T.planEvents(plan); }
    else M = { stage: null };
  } else if (M.stage === 'setup') M = { stage: null };
  applyAll();
}

// ---------- buttons shown in a piece ----------
export function pieceButtons(it) {
  const k = esc(it.key), cfg = cfgOf(it);
  if (cfg && cfg.type === 'rest') {
    const n = sets[it.key] || 0, of = cfg.sets;
    return `<button class="mini" data-tm="setdone" data-key="${k}">✓ Set klaar${of ? ` (${n}/${of})` : n ? ` (${n})` : ''} · rust ${T.fmtDurShort(cfg.rest)}</button>`
      + (n ? `<button class="mini" data-tm="setreset" data-key="${k}" aria-label="Sets op nul">↺</button>` : '');
  }
  return `<button class="mini" data-tm="open" data-key="${k}">⏲ ${esc(cfg ? T.cfgLabel(cfg) : 'Timer')}</button>`;
}
export function resetSets(key) { if (sets[key]) { delete sets[key]; LS.set('tmsets', sets); } }
export const active = () => M.stage === 'run' || !!(R && !R.done);

// ---------- actions ----------
export function click(e) { onClick(e); }
function onClick(e) {
  const b = e.target.closest('[data-tm]'); if (!b) return;
  const a = b.dataset.tm, key = b.dataset.key;
  switch (a) {
    case 'open': openTimer(key); break;
    case 'free': openFree(); break;
    case 'setdone': setDone(key); break;
    case 'setreset': resetSets(key); ctx.rerender(); break;
    case 'close': closeAll(); break;
    case 'edit': M.stage = 'setup'; M.cfgDraft = M.cfg ? { ...M.cfg } : {}; saveM(); renderTm(); break;
    case 'toready': toReady(); break;
    case 'start': start(); break;
    case 'pause': pause(); break;
    case 'resume': resume(); break;
    case 'stop': pause(); M.stage = 'result'; M.stopped = true; saveM(); renderTm(); break;
    case 'done': pause(); M.stage = 'result'; M.stopped = false; saveM(); renderTm(); break;
    case 'plus': M.rounds = (M.rounds || 0) + 1; saveM(); updateTick(); break;
    case 'minus': M.rounds = Math.max(0, (M.rounds || 0) - 1); saveM(); updateTick(); break;
    case 'back': M.stage = 'run'; saveM(); resumeAfterBack(); break;
    case 'save': saveResult(); break;
    case 'drop': closeAll(); break;
    case 'sound': beeper.unlock(); beeper.resume(); applySound(); renderTm(); break;
    case 'rest-skip': stopRest(); break;
    case 'rest-close': stopRest(); break;
    default: break;
  }
}

function openTimer(key) {
  const it = ctx.getItem(key); if (!it) return;
  const cfg = cfgOf(it);
  M = { stage: cfg && cfg.type !== 'rest' ? 'ready' : 'setup', key, cfg: cfg && cfg.type !== 'rest' ? cfg : null, cfgDraft: cfg && cfg.type !== 'rest' ? { ...cfg } : { type: 'emom', total: 600, interval: 60 }, rounds: 0, title: it.piece };
  if (M.cfg) { plan = T.buildPlan(M.cfg); events = T.planEvents(plan); }
  saveM(); applyAll();
}

// Standalone timer: not tied to a piece (no key), so nothing is written to the log.
export function openFree() {
  if (M.stage === 'run' || M.stage === 'result') { applyAll(); return; }   // a timer is already busy: just show it
  M = { stage: 'setup', key: null, cfg: null, cfgDraft: { type: 'emom', total: 600, interval: 60 }, rounds: 0, title: 'Losse timer' };
  saveM(); applyAll();
}

function readSetup() {
  const g = (id) => $tm.querySelector(`#${id}`);
  const type = g('tm-type').value;
  const num = (id, d) => { const v = parseFloat(String(g(id)?.value ?? '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : d; };
  switch (type) {
    case 'emom': {
      const interval = Math.round(num('tm-int', 1) * 60), total = Math.max(interval, Math.round(num('tm-total', 10) * 60));
      const moves = (g('tm-moves')?.value || '').split('\n').map((s) => s.trim()).filter(Boolean);
      return { type, total, interval, moves };
    }
    case 'amrap': return { type, total: Math.round(num('tm-total', 12) * 60) };
    case 'workrest': return { type, rounds: Math.round(num('tm-rounds', 5)), work: Math.round(num('tm-work', 40)), rest: Math.round(num('tm-rest', 20)) };
    default: { const cap = num('tm-cap', 0), target = num('tm-target', 0); return { type: 'fortime', cap: cap ? Math.round(cap * 60) : null, target: target ? Math.round(target * 60) : null }; }
  }
}
function toReady() {
  M.cfg = readSetup(); plan = T.buildPlan(M.cfg); events = T.planEvents(plan);
  M.stage = 'ready'; saveM(); renderTm();
}

function applySound() {
  const s = settings();
  beeper.volume = Math.min(1, Math.max(0.1, +s.tmVol || 0.8));
  beeper.muted = s.tmSound === false;
}

async function start() {
  applySound();
  beeper.unlock();
  wake.hold();
  M.run = { startMs: now(), accMs: 0, running: true }; M.stage = 'run'; M.rounds = 0; M.stopped = false; lastSeg = -2;
  schedM.reset(events, 0); saveM(); applyAll();
}
function elapsed() { return T.runElapsed(M.run, now()); }
function pause() { if (M.run?.running) { M.run.accMs = elapsed(); M.run.running = false; beeper.cancel(); } saveM(); renderTm(); }
function resume() { M.run.startMs = now(); M.run.running = true; applySound(); beeper.unlock(); wake.hold(); schedM.reset(events, M.run.accMs); saveM(); renderTm(); }
function resumeAfterBack() { M.run.startMs = now(); M.run.running = true; applySound(); beeper.unlock(); wake.hold(); schedM.reset(events, M.run.accMs); saveM(); applyAll(); }
function resync() { if (M.stage === 'run' && M.run?.running) schedM.reset(events, elapsed()); if (R && !R.done) schedR.reset(R.events, now() - R.startMs); updateTick(); }

function closeAll() {
  beeper.cancel(); wake.release();
  M = { stage: null }; plan = null; saveM(); applyAll();
}

function saveResult() {
  const it = ctx.getItem(M.key);
  const q = (id) => $tm.querySelector(`#${id}`)?.value ?? '';
  let text = '';
  const c = M.cfg;
  if (c.type === 'fortime') text = q('tm-res').trim();
  else if (c.type === 'amrap') text = T.resultText(c, { rounds: parseInt(q('tm-rounds-res'), 10) || 0, reps: parseInt(q('tm-reps-res'), 10) || 0 });
  else text = q('tm-res').trim();
  if (it && text) {
    const d = ctx.ensureDraft(it);
    d.actual = d.actual && d.actual.trim() ? `${d.actual.trim()}\n${text}` : text;
    ctx.saveDrafts();
    ctx.openPiece(M.key);
    ctx.toast('Resultaat in je log gezet. Controleer en tik op Opslaan.');
  }
  closeAll();
}

// ---------- rest bar for sets ----------
function setDone(key) {
  const it = ctx.getItem(key); if (!it) return;
  const cfg = cfgOf(it); if (!cfg || cfg.type !== 'rest') return;
  sets[key] = (sets[key] || 0) + 1; LS.set('tmsets', sets);
  applySound(); beeper.unlock(); wake.hold();
  const p = T.buildPlan({ type: 'rest', rest: cfg.rest });
  R = { key, startMs: now(), dur: cfg.rest, sets: sets[key], of: cfg.sets, events: T.planEvents(p), done: false, title: it.piece };
  schedR.reset(R.events, 0); saveR();
  ctx.rerender(); applyAll();
}
function stopRest() { R = null; beeper.cancel(); saveR(); if (M.stage !== 'run') wake.release(); applyAll(); }

// ---------- rendering ----------
const clockFor = (s) => {
  if (s.phase === 'countdown') return String(Math.max(1, Math.ceil(s.segLeft)));
  if (plan.mode === 'up') return T.fmtClock(s.elapsed);
  return T.fmtClock(Math.ceil(s.segLeft));
};
const progressFor = (s) => {
  if (s.phase === 'countdown') return 1 - s.segLeft / T.COUNTDOWN_S;
  if (plan.mode === 'up') return plan.cap ? Math.min(1, s.elapsed / plan.cap) : 0;
  return s.seg.dur ? Math.min(1, s.segElapsed / s.seg.dur) : 0;
};

function applyAll() {
  const mainOn = !!M.stage;
  $tm.hidden = !mainOn; document.body.classList.toggle('tm-open', mainOn);
  if (mainOn) renderTm();
  renderRest();
  const need = (M.stage === 'run' && M.run?.running) || (R && !R.done);
  if (need && !loopId) loopId = setInterval(loop, 100);
  if (!need && loopId) { clearInterval(loopId); loopId = null; }
}

function loop() {
  if (M.stage === 'run' && M.run?.running) {
    const t = elapsed();
    schedM.step(t);
    const s = T.stateAt(plan, t);
    if (s.done) {
      M.run.accMs = t; M.run.running = false; M.stage = 'result'; M.stopped = false; M.capHit = s.capHit; saveM(); wake.release();
      applyAll(); return;
    }
    if (s.segIdx !== lastSeg) { lastSeg = s.segIdx; renderTm(); }
    else updateTick(s);
  }
  if (R && !R.done) {
    const t = now() - R.startMs;
    schedR.step(t);
    if (t >= R.dur * 1000) { R.done = true; saveR(); wake.release(); renderRest(); applyAll(); } else renderRest(true);
  }
}

function updateTick(sIn) {
  if (M.stage !== 'run' || !plan) return;
  const s = sIn || T.stateAt(plan, elapsed());
  const set = (id, v) => { const el = $tm.querySelector(`#${id}`); if (el && el.textContent !== v) el.textContent = v; };
  set('tm-time', clockFor(s));
  const f = $tm.querySelector('#tm-fill'); if (f) f.style.width = `${Math.round(progressFor(s) * 1000) / 10}%`;
  $tm.classList.toggle('tm-over', !!s.overTarget);
  if (plan.cfg.type === 'amrap') set('tm-move', `${M.rounds || 0} rondes`);
  if (plan.cfg.type === 'fortime') set('tm-next', s.overTarget ? 'Over het target' : (plan.target ? `Target ${T.fmtClock(plan.target)}` : ''));
}

function flash(e, delayS) {
  if (settings().tmFlash === false) return;
  const strong = ['go', 'work', 'rest', 'end', 'target'].includes(e.type);
  setTimeout(() => { if (!$tm.hidden) { $tm.classList.add('tm-flash'); setTimeout(() => $tm.classList.remove('tm-flash'), strong ? 350 : 160); } }, Math.max(0, delayS) * 1000);
}

function summaryLines(c) {
  const lines = [];
  if (c.type === 'emom') { const n = Math.floor(c.total / c.interval); lines.push(`${n} intervallen van ${T.fmtDurShort(c.interval)}`); if (c.moves?.length) lines.push(...c.moves.map((m, i) => `${i + 1}. ${m}`)); }
  if (c.type === 'amrap') lines.push(`${T.fmtClock(c.total)} min, tel je rondes met de knop`);
  if (c.type === 'workrest') lines.push(`${c.rounds} rondes: ${T.fmtDurShort(c.work)} werk, ${T.fmtDurShort(c.rest)} rust`);
  if (c.type === 'fortime') { lines.push('Tijd telt op, tik Klaar als je klaar bent'); if (c.cap) lines.push(`Time cap ${T.fmtClock(c.cap)}`); if (c.target) lines.push(`Target ${T.fmtClock(c.target)}`); }
  return lines;
}

function renderTm() {
  if (!M.stage) { $tm.innerHTML = ''; return; }
  const c = M.cfg || M.cfgDraft || {};
  const typeCls = `tm-t-${c.type || 'none'}`;
  if (M.stage === 'setup') {
    const d = M.cfgDraft || {}, ty = d.type || 'emom';
    const f = (id, label, val, step = '1') => `<label>${label}<input id="${id}" type="number" inputmode="decimal" min="0" step="${step}" value="${esc(val ?? '')}"></label>`;
    const body = ty === 'emom' ? f('tm-total', 'Totaal (min)', (d.total || 600) / 60) + f('tm-int', 'Interval (min)', (d.interval || 60) / 60, '0.5') + `<label>Beweging per interval (optioneel, één per regel; ze wisselen af)<textarea id="tm-moves" rows="3">${esc((d.moves || []).join('\n'))}</textarea></label>`
      : ty === 'amrap' ? f('tm-total', 'Duur (min)', (d.total || 720) / 60)
      : ty === 'workrest' ? f('tm-rounds', 'Rondes', d.rounds || 5) + f('tm-work', 'Werk (sec)', d.work || 40) + f('tm-rest', 'Rust (sec)', d.rest ?? 20)
      : f('tm-cap', 'Time cap (min, leeg = geen)', d.cap ? d.cap / 60 : '', '0.5') + f('tm-target', 'Target (min, leeg = geen)', d.target ? d.target / 60 : '', '0.5');
    $tm.className = 'tm tm-setup';
    $tm.innerHTML = `<div class="tm-card"><h2>Timer instellen</h2><div class="tm-sub2">${esc(M.title || '')}</div>
      <label>Type<select id="tm-type">${[['emom', 'EMOM'], ['amrap', 'AMRAP'], ['workrest', 'Werk en rust (Tabata, intervallen)'], ['fortime', 'For Time']].map(([v, l]) => `<option value="${v}" ${ty === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${body}<div class="tm-row"><button class="btn" data-tm="close">Annuleer</button><button class="btn primary" data-tm="toready">Verder</button></div></div>`;
    return;
  }
  if (M.stage === 'ready') {
    $tm.className = `tm tm-ready ${typeCls}`;
    $tm.innerHTML = `<div class="tm-card"><div class="tm-sub2">${esc(M.title || '')}</div><h2>${esc(T.cfgLabel(M.cfg))}</h2>
      ${summaryLines(M.cfg).map((l) => `<p>${esc(l)}</p>`).join('')}
      <p class="tm-hint">Tik op Start: dan loopt eerst 10 seconden af, met pieptonen in de laatste 3.${wake.supported ? '' : ' Op dit toestel blijft het scherm niet vanzelf aan.'}</p>
      <button class="btn primary big" data-tm="start">Start</button>
      <div class="tm-row"><button class="btn" data-tm="edit">Aanpassen</button><button class="btn" data-tm="close">Sluiten</button></div></div>`;
    return;
  }
  if (M.stage === 'result') {
    const t = M.run ? M.run.accMs : 0, c2 = M.cfg;
    const secs = Math.floor(Math.max(0, t - T.COUNTDOWN_S * 1000) / 1000);
    let fields = '';
    if (c2.type === 'fortime') fields = `<label>Eindtijd (mm:ss)<input id="tm-res" value="${esc(M.capHit ? T.resultText(c2, { capHit: true }) : T.fmtClock(secs))}"></label>`;
    else if (c2.type === 'amrap') fields = `<div class="tm-row"><label>Volledige rondes<input id="tm-rounds-res" type="number" inputmode="numeric" min="0" value="${M.rounds || 0}"></label><label>Extra reps<input id="tm-reps-res" type="number" inputmode="numeric" min="0" value="0"></label></div><p class="tm-hint">Je kunt dit nog aanpassen voor het in je log komt.</p>`;
    else if (!M.key) fields = '';
    else fields = `<label>Resultaat of notitie (optioneel)<input id="tm-res" value="${esc(T.resultText(c2))}"></label>`;
    $tm.className = `tm tm-result ${typeCls}`;
    $tm.innerHTML = `<div class="tm-card"><div class="tm-sub2">${esc(M.title || '')}</div><h2>${M.stopped ? 'Gestopt' : 'Klaar'}</h2>${fields}
      <div class="tm-row">${M.key ? '<button class="btn primary" data-tm="save">Bewaar in Actual</button><button class="btn" data-tm="drop">Niet bewaren</button>' : '<button class="btn primary" data-tm="drop">Sluiten</button>'}</div>
      ${M.stopped ? '<button class="btn link" data-tm="back">Terug naar de timer</button>' : ''}</div>`;
    return;
  }
  // run
  const s = T.stateAt(plan, elapsed());
  lastSeg = s.segIdx;
  const seg = s.seg;
  const kind = s.phase === 'done' ? 'work' : seg.kind;
  const type = plan.cfg.type;
  const paused = !M.run.running;
  const move = type === 'amrap' ? `${M.rounds || 0} rondes` : type === 'fortime' ? 'Tijd telt op' : (seg.move || (kind === 'rest' ? 'Rust' : kind === 'countdown' ? M.title || '' : ''));
  const next = type === 'fortime' ? (plan.target ? `Target ${T.fmtClock(plan.target)}` : '') : (seg.next || '');
  const sub = seg.sub || (kind === 'countdown' ? 'start over' : '');
  const showSound = !beeper.muted && (!beeper.ctx || beeper.suspended);
  $tm.className = `tm tm-run tm-k-${kind} ${typeCls} ${paused ? 'tm-paused' : ''} ${s.overTarget ? 'tm-over' : ''}`;
  $tm.innerHTML = `<div class="tm-top"><span class="tm-title">${esc(M.title || '')}</span><span class="tm-sub" id="tm-sub">${esc(sub)}</span></div>
    <div class="tm-band">${paused ? 'PAUZE' : esc(seg.label)}</div>
    <div class="tm-time" id="tm-time">${clockFor(s)}</div>
    <div class="tm-barwrap"><div class="tm-fill" id="tm-fill" style="width:${Math.round(progressFor(s) * 1000) / 10}%"></div></div>
    <div class="tm-move"><b id="tm-move">${esc(move)}</b><span id="tm-next">${esc(next)}</span></div>
    ${type === 'amrap' ? '<div class="tm-plusrow"><button class="tm-minus" data-tm="minus" aria-label="Een ronde minder">−</button><button class="tm-plus" data-tm="plus">+1 ronde</button></div>' : ''}
    <div class="tm-btns">${paused ? '<button data-tm="resume">Hervat</button>' : '<button data-tm="pause">Pauze</button>'}${type === 'fortime' ? '<button data-tm="done" class="tm-go">Klaar</button>' : '<button data-tm="stop">Stop</button>'}</div>
    ${showSound ? '<button class="tm-sound" data-tm="sound">Geluid staat uit: tik hier om het aan te zetten</button>' : ''}`;
}

function renderRest(soft) {
  if (!R) { $rest.hidden = true; $rest.innerHTML = ''; return; }
  $rest.hidden = false;
  const left = Math.max(0, R.dur - (now() - R.startMs) / 1000);
  const label = `set ${R.sets}${R.of ? ` van ${R.of}` : ''}`;
  if (soft) { const el = $rest.querySelector('#rb-time'); if (el) { el.textContent = T.fmtClock(Math.ceil(left)); return; } }
  $rest.className = R.done ? 'done' : '';
  $rest.innerHTML = R.done
    ? `<span>Rust voorbij · klaar voor set ${R.sets + 1}${R.of && R.sets >= R.of ? ' (alle sets gedaan)' : ''}</span><button data-tm="rest-close" aria-label="Sluiten">✕</button>`
    : `<span>Rust <b id="rb-time">${T.fmtClock(Math.ceil(left))}</b> · ${esc(label)}</span><button data-tm="rest-skip">Sla over</button>`;
}
