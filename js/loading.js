// Percentage prescriptions ("90% van wk 1 top-3") -> kilo's + hoe laad je de stang. Pure logic, no DOM.
import * as Sh from './sheet.js';

export const PLATES = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1.25, 1, 0.5];
const num = (s) => parseFloat(String(s).replace(',', '.'));

// Heaviest load in a logged result: "5x3@170kg", "145kg", "145"
export function parseKg(actual) {
  const a = String(actual ?? '');
  const m = [...a.matchAll(/(\d+(?:[.,]\d+)?)\s*kg/gi)].map((x) => num(x[1]));
  if (m.length) return Math.max(...m);
  const bare = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(a);
  return bare ? num(bare[1]) : null;
}

// Percentage prescriptions we understand (always tied to a week):
//   "90% van de W1-triple", "105% van wk 1", a following "85%" (same week as the previous one),
//   "@ de W1-triple" (= 100%), "W1-triple + 5%".
// Ignored on purpose: "-10%" (relative to today's top), "@168kg (80%)" (kg given), "80% van 210" (own base).
export function findPercents(text) {
  const t = String(text ?? '');
  const hits = [];
  const wk = (x) => /\b(?:wk|week|w)\s*\.?\s*(\d{1,2})\b/i.exec(x);
  for (const m of t.matchAll(/\bW(\d{1,2})[-\s]?(?:triple|top)(?:-?\d)?\s*\+\s*(\d+(?:[.,]\d+)?)\s*%/gi)) hits.push({ i: m.index, pct: 100 + num(m[2]), week: +m[1] });
  for (const m of t.matchAll(/@\s*(?:de|je|jouw)?\s*W(\d{1,2})[-\s]?(?:triple|top)\b(?!\s*\+)/gi)) hits.push({ i: m.index, pct: 100, week: +m[1] });
  const taken = hits.map((h) => h.i);
  let carry = null;
  for (const m of t.matchAll(/(\d{2,3}(?:[.,]\d+)?)\s*%/g)) {
    const before = t.slice(Math.max(0, m.index - 14), m.index);
    if (/[-−–+]\s*$/.test(before) || /\d[.,]?$/.test(before)) continue;       // -10%, +5%, 75-78%
    if (/kg\s*\(?[±~]?\s*$/i.test(before)) continue;                          // 168kg (80%)
    if (taken.some((i) => m.index > i && m.index < i + 40 && /\+\s*$/.test(t.slice(i, m.index)))) continue;
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 45);
    if (/^\s*van\s*\d/i.test(tail)) continue;                                  // "80% van 210": own base
    const w = wk(tail);
    const pct = num(m[1]);
    if (w) { carry = +w[1]; hits.push({ i: m.index, pct, week: +w[1] }); }
    else if (carry != null && pct >= 50 && pct <= 130) hits.push({ i: m.index, pct, week: carry });
  }
  return hits.sort((x, y) => x.i - y.i).map(({ pct, week }) => ({ pct, week }));
}

const LIFTS = ['front squat', 'back squat', 'overhead squat', 'squat clean', 'power clean', 'squat snatch', 'power snatch', 'clean & jerk', 'strict press', 'push press', 'push jerk', 'deadlift', 'bench press', 'thruster'];
export const baseName = (piece) => String(piece ?? '').replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
// Same lift = same reference, even when the piece name differs per week ("Front squat ramp" vs "Front squat 4×4")
export const liftKey = (piece) => { const n = baseName(piece); return LIFTS.find((l) => n.includes(l)) || n; };

// Top load of the same lift in an earlier week (logged rows of the current tab)
export function refLoad(rows, it, week) {
  const key = liftKey(it.piece);
  const cands = rows.filter((r) => r.week === week && liftKey(r.piece) === key && Sh.status(r) === 'done' && parseKg(r.actual) != null);
  if (!cands.length) return null;
  const r = cands.find((c) => c.dayIdx === it.dayIdx) || cands[0];
  return { kg: parseKg(r.actual), row: r };
}

export const roundTo = (kg, step = 1) => Math.round(kg / step) * step;

// Greedy plates per side; exact=false when the available plates can't hit the target.
export function plates(total, bar = 20, avail = PLATES) {
  let left = Math.max(0, (total - bar) / 2);
  const perSide = [];
  for (const p of avail) while (left + 1e-9 >= p) { perSide.push(p); left -= p; }
  const sum = perSide.reduce((a, b) => a + b, 0);
  return { perSide, exact: left < 1e-6, loaded: bar + 2 * sum, belowBar: total < bar };
}

export const isBarbell = (piece) => /(squat|deadlift|press|clean|snatch|jerk|bench|rdl|thruster)/i.test(piece) && !/sled|sandbag|zak/i.test(piece);

export function calcsFor(it, rows, { bar = 20, step = 1 } = {}) {
  const found = findPercents(`${it.prescribed} ${it.intent}`);
  const seen = new Set();
  const out = [];
  for (const f of found) {
    const id = `${f.pct}|${f.week}`; if (seen.has(id)) continue; seen.add(id);
    if (f.week >= it.week) { out.push({ ...f, missing: true, why: 'Verwijst naar een week die nog niet geweest is.' }); continue; }
    const ref = refLoad(rows, it, f.week);
    if (!ref) { out.push({ ...f, missing: true, why: `Week ${f.week} van dit onderdeel is niet gelogd (of zonder kg).` }); continue; }
    const raw = ref.kg * f.pct / 100;
    const target = roundTo(raw, step);
    out.push({ ...f, refKg: ref.kg, raw, target, barbell: isBarbell(it.piece), bar, ...plates(target, bar) });
  }
  return out;
}

export const fmtKg = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
