// Pure helpers for "vorige keer", planned-vs-real time, the week overview, trends and the next-day pain check.
// No DOM, no network -> unit-testable in Node.
import * as Sh from './sheet.js';

const num = (s) => { const m = /[-+]?\d+(?:[.,]\d+)?/.exec(String(s ?? '')); return m ? parseFloat(m[0].replace(',', '.')) : null; };
export const MIN_RE = /\(\s*(\d+)\s*(?:'|’|′|min)\s*\)/;

// "Back squat 5×5 (22')" -> "backsquat": same movement across weeks, whatever the sets, reps or minutes
export function baseName(piece) {
  return String(piece ?? '').toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+\s*[x×]\s*\d+(?:\s*[-–]\s*\d+)?\b/g, ' ')
    .replace(/\b\d+\s*(?:'|’|′|min)\s*$/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
}
export function plannedMin(piece) {
  const s = String(piece ?? '');
  let m = MIN_RE.exec(s) || /(\d+)\s*(?:'|’|′|min)\s*(?:\(\d+\)\s*)?$/i.exec(s);
  return m ? parseInt(m[1], 10) : 0;
}

// ---------- vorige keer ----------
const sortKey = (tab, week, dayIdx) => [Sh.cycleNum(tab) ?? 0, week ?? 0, dayIdx ?? 0];
const cmp = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
export function prevLog(logs, it, tab) {
  const name = baseName(it.piece); if (!name) return null;
  const me = sortKey(tab, it.week, it.dayIdx);
  let best = null, bestK = null;
  for (const l of logs || []) {
    if (l.key === it.key || baseName(l.piece) !== name) continue;
    const k = sortKey(l.tab, l.week, l.dayIdx);
    if (cmp(k, me) >= 0) continue;
    if (!best || cmp(k, bestK) > 0) { best = l; bestK = k; }
  }
  return best;
}

// ---------- planned vs real ----------
export function dayTimes(rows) {
  const planned = rows.reduce((a, r) => a + plannedMin(r.piece), 0);
  const sess = rows.find((r) => r.sStart && r.sEnd);
  if (sess) { const m = Sh.minutesBetweenHM(sess.sStart, sess.sEnd); if (m != null) return { planned, real: m, src: 'sessie' }; }
  const sum = rows.filter((r) => Sh.status(r) === 'done').reduce((a, r) => a + (parseFloat(String(r.dur).replace(',', '.')) || 0), 0);
  return { planned, real: sum > 0 ? Math.round(sum) : null, src: 'onderdelen' };
}
export function overTone(planned, real) {
  if (!planned || real == null) return '';
  const r = real / planned;
  return r > 1.25 ? 'bad' : r > 1.1 ? 'warn' : 'ok';
}

// ---------- strength numbers ----------
const SET_RE = /(\d+(?:[.,]\d+)?)\s*(?:kg)?\s*[x×]\s*(\d+)/gi;
export function parseSets(actual) {
  const out = [];
  for (const m of String(actual ?? '').matchAll(SET_RE)) {
    const kg = parseFloat(m[1].replace(',', '.')), reps = parseInt(m[2], 10);
    if (kg >= 20 && reps >= 1 && reps <= 30) out.push({ kg, reps });
  }
  return out;
}
export const tonnage = (actual) => parseSets(actual).reduce((a, s) => a + s.kg * s.reps, 0);
export function e1rm({ kg, reps }) {
  if (reps === 1) return kg;
  if (reps > 10) return null;
  return kg * 36 / (37 - reps);
}
const NOT_LIFT = /wod|amrap|emom|for ?time|warm|mobil|row|bike|run|cooldown/i;
export function liftSeries(logs) {
  const by = new Map();
  for (const l of logs || []) {
    if (NOT_LIFT.test(l.piece)) continue;
    const best = parseSets(l.actual).map(e1rm).filter((v) => v != null).sort((a, b) => b - a)[0];
    if (!best) continue;
    const name = baseName(l.piece); if (!name) continue;
    if (!by.has(name)) by.set(name, { label: l.piece.replace(/\([^)]*\)/g, '').replace(/\b\d+\s*[x×]\s*\d+(?:\s*[-–]\s*\d+)?\b/g, '').replace(/\s+/g, ' ').trim(), pts: [] });
    by.get(name).pts.push({ k: sortKey(l.tab, l.week, l.dayIdx), date: l.date, v: Math.round(best * 10) / 10, bad: l.badDay === 'Ja' || l.badDay === 'Misschien' });
  }
  return [...by.values()].filter((x) => x.pts.length >= 2)
    .map((x) => ({ ...x, pts: x.pts.sort((a, b) => cmp(a.k, b.k)) }))
    .sort((a, b) => b.pts.length - a.pts.length).slice(0, 8);
}

// ---------- week ----------
export const rpeNum = (s) => {
  const nums = String(s ?? '').match(/\d+(?:[.,]\d+)?/g);
  if (!nums) return null;
  const v = nums.slice(0, 2).map((x) => parseFloat(x.replace(',', '.'))).filter((x) => x >= 1 && x <= 10);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const hasPain = (p) => { const s = String(p ?? '').trim(); return !!s && !/^geen\b|^neen\b|^-+$|^geen pijn/i.test(s.split('|')[0].trim() || s) ; };

export function weekSummary(rows, week) {
  const rs = rows.filter((r) => r.week === week);
  const days = [];
  for (let d = 0; d < 7; d++) {
    const dr = rs.filter((r) => r.dayIdx === d);
    if (!dr.length) continue;
    const done = dr.filter((r) => Sh.status(r) === 'done'), skipped = dr.filter((r) => Sh.status(r) === 'skipped');
    const t = dayTimes(dr);
    days.push({
      dayIdx: d, focus: dr[0].focus, optional: /optioneel/i.test(dr[0].focus), total: dr.length, done: done.length, skipped: skipped.length,
      planned: t.planned, real: t.real, rpe: avg(done.map((r) => rpeNum(r.rpe)).filter((x) => x != null)),
      pain: dr.some((r) => hasPain(r.pain)), bad: dr.some((r) => ['Ja', 'Misschien'].includes(Sh.normBad(r.badDay))),
      tonnage: done.reduce((a, r) => a + (Sh.pieceKind(r) === 'strength' ? tonnage(r.actual) : 0), 0),
    });
  }
  const core = days.filter((d) => !d.optional);
  const real = days.reduce((a, d) => a + (d.real || 0), 0), planned = days.filter((d) => d.real != null).reduce((a, d) => a + d.planned, 0);
  return {
    days,
    sessions: days.filter((d) => d.done > 0).length, sessionsPlanned: days.length,
    coreDone: core.filter((d) => d.done > 0).length, coreTotal: core.length,
    pieces: days.reduce((a, d) => a + d.done, 0), piecesTotal: days.reduce((a, d) => a + d.total, 0), skipped: days.reduce((a, d) => a + d.skipped, 0),
    planned, real, rpe: avg(days.map((d) => d.rpe).filter((x) => x != null)),
    tonnage: days.reduce((a, d) => a + d.tonnage, 0), painDays: days.filter((d) => d.pain).length, badDays: days.filter((d) => d.bad).length,
  };
}

// sessions and average RPE per cycle-week, over every loaded tab
export function weekTrend(grids) {
  const out = [];
  for (const [tab, g] of Object.entries(grids || {})) {
    const values = g?.values; if (!values) continue;
    const hi = Sh.findHeader(values); if (hi < 0) continue;
    const { map } = Sh.buildColumnMap(values[hi]);
    const rows = Sh.parseRows(values, hi, map, `${tab}§`);
    for (const w of [...new Set(rows.map((r) => r.week))]) {
      const s = weekSummary(rows, w);
      if (!s.pieces) continue;
      out.push({ tab, week: w, sessions: s.sessions, rpe: s.rpe, k: sortKey(tab, w, 0) });
    }
  }
  return out.sort((a, b) => cmp(a.k, b.k));
}

// ---------- pain check the day after ----------
export const KNEE_RE = /squat|lunge|jump|sprong|\brun\b|loop|sprint|\bbox\b|skater|step-?up|thruster|wall ?ball|burpee/i;
export function painCandidate(rows, now, answered = {}, tab = '') {
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ok = new Set([1, 2].map((n) => { const d = new Date(now); d.setDate(d.getDate() - n); return day(d); }));
  const groups = new Map();
  for (const r of rows) {
    if (Sh.status(r) !== 'done' || !r.loggedAt) continue;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(r.loggedAt).trim()); if (!m) continue;
    const k = `${r.week}|${r.dayIdx}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ r, date: m[1] });
  }
  // only the most recent session day is ever asked about
  let latest = null;
  for (const [k, items] of groups) {
    const date = items.map((i) => i.date).sort().pop();
    if (!latest || date > latest.date) latest = { k, items, date };
  }
  if (!latest || !ok.has(latest.date)) return null;
  const { k, items, date } = latest;
  const dayRows = items.map((i) => i.r);
  if (answered[`pain|${tab}|${k}`]) return null;
  if (dayRows.some((r) => /\|\s*Dag erna:|^Dag erna:/i.test(r.pain || ''))) return null;
  const painRow = dayRows.find((r) => hasPain(r.pain));
  const moves = dayRows.filter((r) => KNEE_RE.test(`${r.piece} ${r.prescribed}`));
  if (!painRow && !moves.length) return null;
  const last = dayRows.slice().sort((a, b) => String(a.loggedAt).localeCompare(String(b.loggedAt))).pop();
  return { key: last.key, groupKey: k, date, week: last.week, dayIdx: last.dayIdx, pain: last.pain,
    reason: painRow ? 'pijn gemeld' : moves[0].piece.replace(/\([^)]*\)/g, '').trim() };
}
export const painText = (areas, score) => {
  if (!areas.length || areas.includes('Geen klachten')) return 'Geen klachten';
  return `${areas.join(' + ')}${score !== '' && score != null ? ` ${score}/10` : ''}`;
};

// ---------- CSV back-up ----------
export const CSV_COLS = [['cycle', 'Cycle'], ['week', 'Week'], ['dag', 'Dag'], ['focus', 'Focus'], ['piece', 'Piece'], ['benchmark', 'Benchmark'], ['prescribed', 'Prescribed'], ['intent', 'Intent/target'],
  ['actual', 'Actual'], ['splits', 'Rep splits'], ['rpe', 'RPE'], ['badDay', 'Bad day'], ['pain', 'Pain notes'], ['notes', 'Notes'], ['loggedAt', 'Gelogd op'], ['start', 'Start'], ['end', 'Einde'],
  ['dur', 'Duur (min)'], ['sStart', 'Sessie start'], ['sEnd', 'Sessie einde'], ['readiness', 'Readiness']];
const csvCell = (v) => { const t = String(v ?? '').replace(/\r?\n/g, ' / '); return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
// semicolon-separated with a BOM: opens correctly in Excel with Belgian/Dutch settings
export function toCsv(rows) {
  const head = CSV_COLS.map(([, h]) => h).join(';');
  return `\uFEFF${[head, ...rows.map((r) => CSV_COLS.map(([k]) => csvCell(r[k])).join(';'))].join('\r\n')}\r\n`;
}

// ---------- readiness ----------
export const READY_OPTS = { sl: ['Slecht', 'Ok', 'Goed'], sp: ['Geen', 'Matig', 'Veel'], st: ['Laag', 'Matig', 'Hoog'] };
export const READY_LABELS = { sl: 'Slaap', sp: 'Spierpijn', st: 'Stress' };
export const readyText = (r) => ['sl', 'sp', 'st'].map((k) => `${READY_LABELS[k]} ${String(r[k]).toLowerCase()}`).join(' · ');
export const readyComplete = (r) => ['sl', 'sp', 'st'].every((k) => READY_OPTS[k].includes(r[k]));
// rough cost indication for the confirmation dialog
export const estTokens = (chars) => Math.round(chars / 3.6);
