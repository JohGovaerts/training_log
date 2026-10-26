// Records: PR Ledger + Benchmark Tracker parsing, "last score" lookup, good/bad-day
// verdict and a transparent confidence indication. Pure functions, no DOM/network.
import * as Sh from './sheet.js';

export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const clean = (v) => { const s = String(v ?? '').trim(); return s === '' || s === '—' || s === '-' ? '' : s; };

// ---- parsing values ---------------------------------------------------------

// "4:56" (m:ss), "0:04:56" / "1:02:03" (h:mm:ss), "7 mins 18 secs", "24 s" -> seconds
export function parseTime(s) {
  const t = String(s ?? '').trim().toLowerCase();
  let m = /^(\d+):(\d{2}):(\d{2})$/.exec(t);
  if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /^(\d+):(\d{2})$/.exec(t);
  if (m) return +m[1] * 60 + +m[2];
  m = /^(\d+)\s*mins?(?:\s*(\d+)\s*sec'?s?)?$/.exec(t);
  if (m) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  m = /^(\d+)\s*(?:s|secs?)$/.exec(t);
  if (m) return +m[1];
  return null;
}
export function fmtTime(sec) {
  if (sec == null || !isFinite(sec)) return '';
  const r = Math.round(sec), h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), s = r % 60;
  const p = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
const firstNumber = (s) => { const m = /[-+]?\d+(?:[.,]\d+)?/.exec(String(s ?? '')); return m ? parseFloat(m[0].replace(',', '.')) : null; };

export function parseAnyDate(s) {
  const t = String(s ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(t);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}
export const isoDate = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
export function fmtDateNL(iso) {
  const d = parseAnyDate(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}
export function monthsSince(iso, now = new Date()) {
  const d = parseAnyDate(iso);
  return d ? (now - d) / (30.44 * 864e5) : null;
}

// A value cell -> {raw, num, time(bool)}; num is seconds for times, else the first number
function parseCell(raw, { holdTime = false } = {}) {
  const r = clean(raw);
  if (!r) return null;
  const sec = /kg|reps?|rounds?|\bm\b/i.test(r) ? null : parseTime(r);
  if (sec != null) return { raw: r, num: sec, time: !holdTime };
  const n = firstNumber(r);
  return { raw: r, num: n, time: false };
}

// "13 rounds + 1 Pull-up | 391 reps" / "7 mins 18 secs" / "309 reps | 112; 106" -> number
export function parseResult(raw) {
  const r = String(raw ?? '').trim();
  const t = parseTime(r);
  if (t != null) return { num: t, time: true };
  const reps = /(\d+(?:\.\d+)?)\s*reps/i.exec(r);
  if (reps) return { num: parseFloat(reps[1]), time: false };
  const tm = /(\d+)\s*mins?(?:\s*(\d+)\s*secs?)?/i.exec(r);
  if (tm) return { num: +tm[1] * 60 + (tm[2] ? +tm[2] : 0), time: true };
  const n = firstNumber(r);
  return { num: n, time: false };
}

// ---- building the record list ----------------------------------------------

function headerMap(row) {
  const m = {};
  (row || []).forEach((c, i) => { m[String(c ?? '').trim().toLowerCase()] = i; });
  return m;
}
const pick = (row, idx) => (idx == null ? '' : String(row[idx] ?? ''));

export function buildRecords({ ledger = [], summary = [], history = [] }) {
  const recs = [];
  const hist = {};

  // Benchmark history
  if (history.length) {
    const h = headerMap(history[0]);
    for (const row of history.slice(1)) {
      const name = pick(row, h['workout']).trim(); if (!name) continue;
      const res = pick(row, h['resultaat']).trim(); if (!res) continue;
      const date = parseAnyDate(pick(row, h['datum']));
      const pr = parseResult(res);
      (hist[norm(name)] ||= []).push({ date: isoDate(date), raw: res, num: pr.num, time: pr.time, rx: pick(row, h['rx/scaled']).trim(), note: pick(row, h['noot']).trim(), source: 'ledger' });
    }
    for (const k of Object.keys(hist)) hist[k].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  // Benchmark summary (named WODs / Open workouts)
  if (summary.length) {
    const h = headerMap(summary[0]);
    for (const row of summary.slice(1)) {
      const name = pick(row, h['workout']).trim(); if (!name) continue;
      const cur = parseCell(pick(row, h['current']));
      const at = parseCell(pick(row, h['all-time best']));
      const lowerBetter = !!((cur && cur.time) || (at && at.time));
      recs.push({
        id: norm(name), group: pick(row, h['categorie']).trim() || 'Benchmarks', name, label: name, type: 'bench',
        lowerBetter, rx: pick(row, h['rx/sc']).trim(),
        current: cur && { ...cur, date: isoDate(parseAnyDate(pick(row, h['current datum']))) },
        est: null,
        allTime: at && { ...at, date: isoDate(parseAnyDate(pick(row, h['all-time datum']))) },
        note: pick(row, h['noot']).trim(),
      });
    }
  }

  // PR Ledger (lifts, monostructural, skills)
  if (ledger.length) {
    const h = headerMap(ledger[0]);
    for (const row of ledger.slice(1)) {
      const item = pick(row, h['item']).trim(); if (!item) continue;
      const rep = pick(row, h['rep/afstand']).trim();
      const section = pick(row, h['sectie']).trim();
      const hold = /^tijd$/i.test(rep);
      const cur = parseCell(pick(row, h['current pb']), { holdTime: hold });
      const at = parseCell(pick(row, h['all-time pb']), { holdTime: hold });
      const estRaw = clean(pick(row, h['geschatte pb']));
      const lowerBetter = !hold && !!((cur && cur.time) || (at && at.time));
      const dt = (k) => { const raw = pick(row, h[k]).trim(); const d = parseAnyDate(raw); return d ? isoDate(d) : (raw ? '' : ''); };
      recs.push({
        id: norm(`${item} ${rep}`), group: section || 'Ledger', name: item, label: `${item} ${rep}`.trim(), type: 'ledger',
        lowerBetter, rx: '',
        current: cur && { ...cur, date: dt('current datum') },
        est: estRaw ? { raw: estRaw, num: firstNumber(estRaw) } : null,
        allTime: at && { ...at, date: dt('all-time datum'), dateRaw: pick(row, h['all-time datum']).trim() },
        note: pick(row, h['noot']).trim(),
      });
    }
  }
  return { records: recs, history: hist };
}

// ---- matching a sheet piece to a record -------------------------------------

export function recordFor(piece, benchmark, records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const b = norm(benchmark);
  if (b) {
    if (byId.has(b)) return byId.get(b);
    const km = b.replace(/(\d)k$/, '$1km');
    if (km !== b && byId.has(km)) return byId.get(km);
    // "Row 500m" vs "Row 500 m", "Back Squat 1RM" etc. are handled by norm(); also accept bare names
    const loose = records.find((r) => norm(r.name) === b && (r.type === 'bench'));
    return loose || null;
  }
  // Fallback for named WODs when the sheet has no Benchmark column
  const text = ` ${String(piece || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ')} `;
  let best = null;
  for (const r of records) {
    if (r.type !== 'bench') continue;
    const n = ` ${r.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
    if (text.includes(n) && (!best || n.length > best.n.length)) best = { r, n };
  }
  return best ? best.r : null;
}

// ---- results from the cycle tabs --------------------------------------------

export function resultNum(actual, rec) {
  const a = String(actual ?? '');
  if (!a.trim()) return null;
  if (rec.lowerBetter) {
    const m = /(\d+:\d{2}(?::\d{2})?)/.exec(a);
    if (m) return parseTime(m[1]);
    const mm = /(\d+)\s*mins?(?:\s*(\d+)\s*secs?)?/i.exec(a);
    return mm ? +mm[1] * 60 + (mm[2] ? +mm[2] : 0) : null;
  }
  if (rec.type === 'ledger' && /kg/i.test(a)) {
    const nums = [...a.matchAll(/(\d+(?:[.,]\d+)?)\s*kg/gi)].map((x) => parseFloat(x[1].replace(',', '.')));
    return nums.length ? Math.max(...nums) : null;
  }
  const reps = /(\d+(?:[.,]\d+)?)\s*reps/i.exec(a);
  if (reps) return parseFloat(reps[1].replace(',', '.'));
  return firstNumber(a);
}

// Every logged piece (Actual filled) from the loaded cycle-tab grids
export function collectLogs(grids, cycleStarts = {}) {
  const logs = [];
  for (const [tab, g] of Object.entries(grids || {})) {
    const values = g?.values; if (!values) continue;
    const hi = Sh.findHeader(values); if (hi < 0) continue;
    const { map } = Sh.buildColumnMap(values[hi]);
    for (const r of Sh.parseRows(values, hi, map, `${tab}§`)) {
      if (Sh.status(r) !== 'done' || !r.actual.trim()) continue;
      let date = parseAnyDate(r.loggedAt);
      if (!date) date = Sh.dateFor(cycleStarts[tab] || '', r.week, Math.max(0, r.dayIdx));
      logs.push({ tab, key: r.key, piece: r.piece, benchmark: (r.benchmark || '').trim(), actual: r.actual.trim(), rpe: r.rpe.trim(), badDay: Sh.normBad(r.badDay), pain: r.pain, notes: r.notes, date: isoDate(date) });
    }
  }
  return logs;
}

// ---- judging a result --------------------------------------------------------

export function reference(rec) {
  if (rec.current && rec.current.num != null) return { ...rec.current, kind: 'current' };
  if (rec.est && rec.est.num != null) return { ...rec.est, kind: 'est' };
  if (rec.allTime && rec.allTime.num != null) return { ...rec.allTime, kind: 'allTime' };
  return null;
}
export function ratioTo(rec, num, ref = reference(rec)) {
  if (num == null || !ref || !ref.num) return null;
  return rec.lowerBetter ? ref.num / num : num / ref.num;
}
export function fmtValue(rec, v) {
  if (v == null) return '';
  if (typeof v === 'number') return rec.lowerBetter ? fmtTime(v) : String(v);
  return rec.lowerBetter && v.num != null && v.time ? fmtTime(v.num) : v.raw;
}
export function judge({ ratio, badDay, rpe }) {
  const bad = badDay === 'Ja', maybe = badDay === 'Misschien';
  const lowerBound = bad || maybe;
  const r = parseFloat(String(rpe ?? '').split('-').pop());
  let tone, label;
  if (ratio == null) { tone = bad ? 'bad' : 'unknown'; label = bad ? 'slechte dag (zelf aangegeven)' : 'geen vergelijking mogelijk'; }
  else if (ratio >= 0.98) { tone = 'good'; label = bad ? 'sterk ondanks slechte dag' : 'goede dag'; }
  else if (ratio >= 0.93) { tone = bad ? 'bad' : 'ok'; label = bad ? 'slechte dag' : 'redelijke dag'; }
  else { tone = 'bad'; label = bad ? 'slechte dag' : 'zwakkere dag'; }
  if (ratio != null && ratio >= 0.95 && r && r <= 7) label += ' (voelde licht)';
  if (lowerBound && ratio != null && ratio < 0.98 && !bad) label += ' · ondergrens';
  return { tone, label, lowerBound };
}

// Latest earlier results for a record: ledger history + app logs (newest first)
export function pastResults(rec, { history = {}, logs = [], records = [], exclude = null } = {}) {
  const out = [];
  for (const h of history[rec.id] || []) out.push({ ...h });
  for (const l of logs) {
    if (exclude && l.tab === exclude.tab && l.key === exclude.key) continue;
    const r = recordFor(l.piece, l.benchmark, records);
    if (!r || r.id !== rec.id) continue;
    out.push({ date: l.date, raw: l.actual, num: resultNum(l.actual, rec), rx: '', rpe: l.rpe, badDay: l.badDay, source: 'app', tab: l.tab });
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  for (const o of out) {
    o.ratio = ratioTo(rec, o.num);
    o.verdict = judge({ ratio: o.ratio, badDay: o.badDay, rpe: o.rpe });
  }
  return out;
}

// ---- confidence indication (heuristic, not statistics) ------------------------

export function confidence(rec, { now = new Date(), past = [] } = {}) {
  const ref = reference(rec);
  const reasons = [];
  if (!ref) return { pct: null, label: 'geen data', reasons: ['Nog geen waarde bekend'] };
  let pct = 100;
  const tested = !!(rec.current && rec.current.num != null);
  const date = tested ? rec.current.date : rec.allTime?.date;
  const age = monthsSince(date, now);
  if (age == null) { pct -= 70; reasons.push('Datum onbekend of historisch (−70)'); }
  else {
    const pen = age <= 6 ? 0 : Math.min(70, Math.round((age - 6) * 3.5));
    if (pen) { pct -= pen; reasons.push(`${Math.round(age)} mnd oud, geldig tot 6 mnd (−${pen})`); }
    else reasons.push(`${Math.max(0, Math.round(age))} mnd oud: nog geldig`);
  }
  if (!tested && rec.est) { pct -= 5; reasons.push('Enkel een schatting, geen recente test (−5)'); }
  else if (!tested) { pct -= 10; reasons.push('Enkel all-time waarde, geen recente test (−10)'); }
  if (/conditions-limited|pijn-gecapt|verouderd|on hold|niet 1-op-1|retest pending/i.test(rec.note || '')) { pct -= 10; reasons.push('Noot: beperkt of retest nodig (−10)'); }
  const n = (past || []).length;
  if (n >= 3) { pct += 5; reasons.push(`${n} metingen in de historiek (+5)`); }
  const recent = (past || []).find((p) => p.ratio != null && monthsSince(p.date, now) != null && monthsSince(p.date, now) <= 6 && p.ratio >= 0.97 && p.verdict.tone !== 'unknown');
  if (recent && !tested) { pct += 10; reasons.push('Recente training bevestigt het niveau (+10)'); }
  pct = Math.max(5, Math.min(99, Math.round(pct)));
  return { pct, label: pct >= 70 ? 'hoog' : pct >= 40 ? 'matig' : 'laag', reasons };
}

// Compact "last time" summary for a piece
export function lastFor(rec, opts) {
  const past = pastResults(rec, opts);
  const ref = reference(rec);
  return { past, last: past[0] || null, ref };
}
