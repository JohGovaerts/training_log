// Interval timers: parsing a prescription into a timer, the timeline, signals, sound and wake lock.
// Everything here is pure except the Audio/WakeLock helpers at the bottom (guarded for node tests).

export const COUNTDOWN_S = 10;        // every timer starts with a 10 s countdown (last 3 s beep)
export const WARN_S = 10;             // signal 10 s before the end of an interval
export const MIN_WARN_DUR_S = 25;     // no warning inside very short intervals (Tabata 20/10)

// ---------- parsing ----------
const DUR = `(?:\\d+:\\d{2}|\\d+\\s*'\\s*\\d{0,2}|\\d+(?:[.,]\\d+)?\\s*(?:min|minuten|m|s|sec|seconden)\\b|\\d+\\s*")`;
const WORK = '(?:werk|work|on)';
const REST = '(?:rust|rest|off)';

// "3'" "2'30" "1:30" "90s" "20 sec" "2 min" -> seconds. A bare number counts in `bare` ('min' or 's').
export function parseDur(str, bare = 'min') {
  const s = String(str ?? '').trim().toLowerCase().replace(',', '.');
  let m;
  if ((m = s.match(/^(\d+):(\d{2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+)\s*'\s*(\d{0,2})$/))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(min|minuten|m)$/))) return Math.round(+m[1] * 60);
  if ((m = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|seconden|")$/))) return Math.round(+m[1]);
  if ((m = s.match(/^(\d+(?:\.\d+)?)$/))) return Math.round(+m[1] * (bare === 's' ? 1 : 60));
  return null;
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function fmtDurShort(sec) {
  if (sec % 60 === 0) return `${sec / 60}'`;
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, '0')}`;
}

// Returns a config or null. Order matters: an EMOM or AMRAP wins over a rest hint in the same text.
export function parseTimer(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ');
  let m;
  // EMOM / E2MOM: "EMOM 10': 14 wall balls | 12 burpees"
  if ((m = t.match(/\b(?:E(\d)MOM|EMOM)\b\s*[:\-]?\s*(\d+)\s*(?:'|min|minuten|m\b)?([^]*)$/i))) {
    const every = m[1] ? +m[1] : 1, total = +m[2] * 60;
    if (total >= every * 60) {
      const tail = (m[3] || '').replace(/^\s*[:\-–]\s*/, '');
      const moves = tail.includes('|') ? tail.split('|').map((s) => s.trim().replace(/[.;]$/, '')).filter(Boolean) : [];
      return { type: 'emom', total, interval: every * 60, moves };
    }
  }
  if ((m = t.match(/\bAMRAP\b\s*[:\-]?\s*(\d+)\s*(?:'|min|minuten|m\b)?/i))) return { type: 'amrap', total: +m[1] * 60 };
  if (/\btabata\b/i.test(t)) return { type: 'workrest', rounds: 8, work: 20, rest: 10 };
  // "5 x 3' werk / 2' rust", "5 rondes: 3' werk, 2' rust"
  if ((m = t.match(new RegExp(`(\\d+)\\s*(?:[x×]|rondes|rounds)\\W{0,3}(${DUR})\\s*${WORK}\\s*[/,]?\\s*(${DUR})\\s*${REST}`, 'i')))) {
    const work = parseDur(m[2]), rest = parseDur(m[3]);
    if (work && rest != null) return { type: 'workrest', rounds: +m[1], work, rest };
  }
  // "40s werk / 20s rust x 8"
  if ((m = t.match(new RegExp(`(${DUR})\\s*${WORK}\\s*[/,]\\s*(${DUR})\\s*${REST}\\s*[x×]\\s*(\\d+)`, 'i')))) {
    const work = parseDur(m[1]), rest = parseDur(m[2]);
    if (work && rest != null) return { type: 'workrest', rounds: +m[3], work, rest };
  }
  if (/\b(for\s*time|voor\s*tijd)\b/i.test(t)) {
    const cap = t.match(new RegExp(`(?:time\\s*cap|tc|cap)\\s*[:=]?\\s*(${DUR}|\\d+)`, 'i'));
    const target = t.match(new RegExp(`(?:target|doel|tgt)\\s*[:=]?\\s*(${DUR}|\\d+)`, 'i'));
    return { type: 'fortime', cap: cap ? parseDur(cap[1]) : null, target: target ? parseDur(target[1]) : null };
  }
  // sets with a fixed rest: "5×3 @ 80%, rust 2'30" / "3' rust"
  const rest = t.match(new RegExp(`(?:${REST})\\s*[:=]?\\s*(${DUR})|(${DUR})\\s*${REST}`, 'i'));
  if (rest) {
    const sec = parseDur(rest[1] || rest[2]);
    const sets = t.match(/(\d+)\s*[x×]\s*\d/);
    if (sec) return { type: 'rest', rest: sec, sets: sets ? +sets[1] : null };
  }
  return null;
}

export function cfgLabel(c) {
  if (!c) return 'Timer';
  switch (c.type) {
    case 'emom': return `${c.interval === 60 ? 'EMOM' : `E${c.interval / 60}MOM`} ${fmtDurShort(c.total)}`;
    case 'amrap': return `AMRAP ${fmtDurShort(c.total)}`;
    case 'workrest': return `${c.rounds} × ${fmtDurShort(c.work)} werk / ${fmtDurShort(c.rest)} rust`;
    case 'fortime': return c.cap ? `For Time (cap ${fmtDurShort(c.cap)})` : 'For Time';
    case 'rest': return `Rust ${fmtDurShort(c.rest)}`;
    default: return 'Timer';
  }
}

// ---------- plan ----------
// segment: { kind: 'countdown'|'work'|'rest', dur (s), label, move, next, start (s from the very start) }
export function buildPlan(cfg) {
  const segs = [];
  const add = (s) => { const start = segs.length ? segs.at(-1).start + segs.at(-1).dur : 0; segs.push({ ...s, start }); };
  if (cfg.type !== 'rest') add({ kind: 'countdown', dur: COUNTDOWN_S, label: 'KLAAR OM TE STARTEN', move: '', next: '' });
  let mode = 'down', cap = null, target = null;
  if (cfg.type === 'emom') {
    const n = Math.floor(cfg.total / cfg.interval), mv = cfg.moves || [];
    for (let i = 0; i < n; i += 1) {
      add({ kind: 'work', dur: cfg.interval, label: 'WERK', sub: `interval ${i + 1} van ${n}`, move: mv.length ? mv[i % mv.length] : '',
        next: i + 1 < n && mv.length ? `Volgende: ${mv[(i + 1) % mv.length]}` : (i + 1 === n ? 'Laatste interval' : ''), idx: i, of: n });
    }
  } else if (cfg.type === 'workrest') {
    for (let r = 0; r < cfg.rounds; r += 1) {
      add({ kind: 'work', dur: cfg.work, label: 'WERK', sub: `ronde ${r + 1} van ${cfg.rounds}`, move: '', next: cfg.rest ? `Daarna ${fmtDurShort(cfg.rest)} rust` : '', idx: r, of: cfg.rounds });
      if (cfg.rest && r < cfg.rounds - 1) add({ kind: 'rest', dur: cfg.rest, label: 'RUST', sub: `ronde ${r + 1} van ${cfg.rounds}`, move: '', next: `Volgende: ${fmtDurShort(cfg.work)} werk`, idx: r, of: cfg.rounds });
    }
  } else if (cfg.type === 'amrap') {
    add({ kind: 'work', dur: cfg.total, label: 'AMRAP', sub: 'nog te gaan', move: '', next: '' });
  } else if (cfg.type === 'fortime') {
    mode = 'up'; cap = cfg.cap || null; target = cfg.target || null;
    add({ kind: 'work', dur: cap || 0, label: 'VOOR TIJD', sub: [cap && `cap ${fmtClock(cap)}`, target && `target ${fmtClock(target)}`].filter(Boolean).join(' · '), move: '', next: '' });
  } else if (cfg.type === 'rest') {
    add({ kind: 'rest', dur: cfg.rest, label: 'RUST', sub: '', move: '', next: '' });
  }
  const total = mode === 'up' ? (cap ? COUNTDOWN_S + cap : null) : segs.reduce((s, x) => s + x.dur, 0);
  return { cfg, mode, segs, total, cap, target, startRun: segs[0]?.kind === 'countdown' ? COUNTDOWN_S : 0 };
}

// state at t ms since the very first tick of the plan (countdown included)
export function stateAt(plan, tMs) {
  const t = Math.max(0, tMs) / 1000;
  const segs = plan.segs;
  if (plan.total != null && t >= plan.total) {
    const last = segs.at(-1);
    return { phase: 'done', seg: last, segIdx: segs.length - 1, segLeft: 0, segElapsed: last.dur, elapsed: Math.max(0, plan.total - plan.startRun), done: true, capHit: plan.mode === 'up' };
  }
  let i = segs.length - 1;
  for (let k = 0; k < segs.length; k += 1) { if (t < segs[k].start + (segs[k].dur || Infinity)) { i = k; break; } }
  const seg = segs[i];
  const segElapsed = t - seg.start;
  const elapsed = Math.max(0, t - plan.startRun);
  const segLeft = plan.mode === 'up' && seg.kind === 'work' ? (plan.cap ? plan.cap - segElapsed : null) : seg.dur - segElapsed;
  return { phase: seg.kind, seg, segIdx: i, segLeft, segElapsed, elapsed, done: false, capHit: false, overTarget: !!(plan.target && plan.mode === 'up' && seg.kind === 'work' && segElapsed >= plan.target) };
}

// All signals of a plan: [{ at (ms), type }]. Types: pip, go, work, rest, warn, target, end
export function planEvents(plan) {
  const ev = [];
  const segs = plan.segs;
  segs.forEach((s, i) => {
    const startMs = s.start * 1000;
    if (s.kind === 'countdown') {
      [7, 8, 9].forEach((k) => ev.push({ at: k * 1000, type: 'pip' }));
      return;
    }
    if (plan.cfg.type === 'rest') {
      [s.dur - 3, s.dur - 2, s.dur - 1].forEach((k) => { if (k > 0) ev.push({ at: k * 1000, type: 'pip' }); });
      return;
    }
    ev.push({ at: startMs, type: i === 1 && segs[0].kind === 'countdown' ? 'go' : s.kind });
    if (plan.mode === 'down' && s.dur >= MIN_WARN_DUR_S && !(plan.cfg.type === 'amrap')) ev.push({ at: (s.start + s.dur - WARN_S) * 1000, type: 'warn' });
    if (plan.cfg.type === 'amrap' && s.dur >= MIN_WARN_DUR_S) ev.push({ at: (s.start + s.dur - WARN_S) * 1000, type: 'warn' });
    if (plan.cfg.type === 'workrest' && s.dur >= 5) {
      [3, 2, 1].forEach((k) => { if (s.dur > k + 1 && s.dur < MIN_WARN_DUR_S) ev.push({ at: (s.start + s.dur - k) * 1000, type: 'pip' }); });
    }
  });
  if (plan.mode === 'up') {
    if (plan.target) ev.push({ at: (plan.startRun + plan.target) * 1000, type: 'target' });
    if (plan.cap) ev.push({ at: (plan.startRun + plan.cap) * 1000, type: 'end' });
  } else if (plan.cfg.type === 'rest') {
    ev.push({ at: segs[0].dur * 1000, type: 'end' });
  } else if (plan.total != null) {
    ev.push({ at: plan.total * 1000, type: 'end' });
  }
  return ev.sort((a, b) => a.at - b.at);
}

// ---------- running clock (persisted) ----------
// run = { startMs, accMs, running }
export const runElapsed = (run, now = Date.now()) => (run.accMs || 0) + (run.running ? now - run.startMs : 0);

// ---------- result text ----------
export function resultText(cfg, { elapsedS = 0, rounds = 0, reps = 0, capHit = false } = {}) {
  switch (cfg.type) {
    case 'fortime': return capHit ? `TC ${fmtClock(cfg.cap)} bereikt` : fmtClock(elapsedS);
    case 'amrap': return `${rounds} rondes${reps ? ` + ${reps} reps` : ''}`;
    case 'emom': return `EMOM ${fmtDurShort(cfg.total)} afgewerkt`;
    case 'workrest': return `${cfg.rounds} × ${fmtDurShort(cfg.work)}/${fmtDurShort(cfg.rest)} afgewerkt`;
    default: return '';
  }
}

// ---------- sound (browser only) ----------
const TONES = {
  pip: [[880, 0, 0.14]],
  warn: [[740, 0, 0.16], [740, 0.24, 0.16]],
  go: [[1320, 0, 0.7]],
  work: [[1175, 0, 0.5]],
  rest: [[523, 0, 0.6]],
  target: [[988, 0, 0.12], [988, 0.2, 0.12], [988, 0.4, 0.12]],
  end: [[1175, 0, 0.3], [1175, 0.4, 0.3], [1047, 0.8, 0.7]],
};

export class Beeper {
  constructor() { this.ctx = null; this.nodes = []; this.volume = 0.8; this.muted = false; }
  // must be called from a user gesture (the Start tap) to unlock audio on iOS
  unlock() {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(); g.gain.value = 0.0001;
      o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime + 0.02);
      return true;
    } catch { return false; }
  }
  // master compressor so overlapping loud tones don't clip
  out() {
    if (!this.master) {
      const c = this.ctx.createDynamicsCompressor ? this.ctx.createDynamicsCompressor() : null;
      if (c) { c.connect(this.ctx.destination); this.master = c; } else this.master = this.ctx.destination;
    }
    return this.master;
  }
  get suspended() { return !!this.ctx && this.ctx.state !== 'running'; }
  resume() { try { return this.ctx?.resume(); } catch { return null; } }
  // play `type` after `delayS` seconds (>= 0)
  play(type, delayS = 0) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + Math.max(0, delayS);
    for (const [freq, off, dur] of TONES[type] || []) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = 'square'; o.frequency.value = freq;   // square cuts through gym noise far better than a sine
      const a = t0 + off, v = Math.max(0.0001, Math.min(1, this.volume * 1.25) * 0.8);
      g.gain.setValueAtTime(0.0001, a); g.gain.exponentialRampToValueAtTime(v, a + 0.01);
      g.gain.setValueAtTime(v, a + Math.max(0.01, dur - 0.04)); g.gain.exponentialRampToValueAtTime(0.0001, a + dur);
      o.connect(g); g.connect(this.out()); o.start(a); o.stop(a + dur + 0.02);
      this.nodes.push(o);
    }
    if (this.nodes.length > 40) this.nodes = this.nodes.slice(-20);
  }
  cancel() { for (const o of this.nodes) { try { o.stop(); } catch { /* already stopped */ } } this.nodes = []; }
}

// Schedules the signals just before they are due, using the audio clock for exact timing.
export class Scheduler {
  constructor(beeper, onSignal) { this.b = beeper; this.onSignal = onSignal; this.done = new Set(); this.events = []; this.look = 1200; }
  reset(events, fromMs) {
    this.events = events; this.done = new Set(); this.b.cancel();
    events.forEach((e, i) => { if (e.at < fromMs - 50) this.done.add(i); });
  }
  // call about every 200 ms with the current run time (ms)
  step(tMs) {
    this.events.forEach((e, i) => {
      if (this.done.has(i) || e.at > tMs + this.look) return;
      this.done.add(i);
      const delay = (e.at - tMs) / 1000;
      this.b.play(e.type, delay);
      this.onSignal(e, delay);
    });
  }
}

// ---------- screen wake lock ----------
export class WakeKeeper {
  constructor() { this.lock = null; this.want = false; this.supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator; }
  async hold() {
    this.want = true;
    if (!this.supported) return false;
    if (this.lock) return true;
    try { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener?.('release', () => { this.lock = null; }); return true; } catch { return false; }
  }
  async renew() { if (this.want && !this.lock) return this.hold(); return !!this.lock; }
  async release() { this.want = false; try { await this.lock?.release(); } catch { /* ignore */ } this.lock = null; }
  get active() { return !!this.lock; }
}
