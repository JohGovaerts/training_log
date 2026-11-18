// Pure helpers: parsing the training sheet, planning cell writes, time/date utils.
// No DOM, no network -> unit-testable in Node.

export const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
export const DAYS_LONG = ['Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const ALIAS = {
  ma: 0, maandag: 0, mon: 0, monday: 0, di: 1, dinsdag: 1, tue: 1, tuesday: 1,
  wo: 2, woensdag: 2, wed: 2, wednesday: 2, do: 3, donderdag: 3, thu: 3, thursday: 3,
  vr: 4, vrijdag: 4, fri: 4, friday: 4, za: 5, zaterdag: 5, sat: 5, saturday: 5,
  zo: 6, zondag: 6, sun: 6, sunday: 6,
};
export function dayIndex(s) {
  const k = String(s ?? '').trim().toLowerCase().replace(/\.$/, '');
  return k in ALIAS ? ALIAS[k] : -1;
}

// Column header aliases (lowercase). Coach columns are read-only for the app.
const ALIASES = {
  cycle: ['cycle', 'cyclus'], week: ['week'], dag: ['dag', 'day'], focus: ['focus'], piece: ['piece', 'onderdeel'],
  benchmark: ['benchmark', 'pr test', 'test'],
  prescribed: ['prescribed'], intent: ['intent/target', 'intent', 'target'], demo: ['demo link', 'demo'],
  actual: ['actual'], splits: ['rep splits'], rpe: ['rpe'], badDay: ['bad day'],
  pain: ['pain notes'], notes: ['notes'],
  loggedAt: ['gelogd op'], start: ['start'], end: ['einde'], dur: ['duur (min)', 'duur'],
  sStart: ['sessie start'], sEnd: ['sessie einde'], readiness: ['readiness'], polar: ['polar'],
};
// Columns the app adds (to the right of the existing ones) when missing.
export const APP_COLS = {
  loggedAt: 'Gelogd op', start: 'Start', end: 'Einde', dur: 'Duur (min)',
  sStart: 'Sessie start', sEnd: 'Sessie einde',
};
// Added only when first needed (so a sheet that never uses it is left untouched).
export const LAZY_COLS = { readiness: 'Readiness', polar: 'Polar' };
export function ensureCol(map, newHeaders, key) {
  if (key in map) return;
  const next = Math.max(-1, ...Object.values(map)) + 1;
  map[key] = next; newHeaders.push({ col: next, title: LAZY_COLS[key] });
}
const REQUIRED = ['week', 'dag', 'piece'];

export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function a1(tab, row, col) {
  return `'${String(tab).replace(/'/g, "''")}'!${colLetter(col)}${row}`;
}

// Sheet Contract v1: the columns the coach + athlete halves of the sheet should have.
// (App-managed columns are added automatically, so they are not part of this check.)
const EXPECTED = ['cycle', 'week', 'dag', 'focus', 'piece', 'prescribed', 'intent', 'demo', 'actual', 'splits', 'rpe', 'badDay', 'pain', 'notes'];
export const CONTRACT_LABELS = {
  cycle: 'Cycle', week: 'Week', dag: 'Dag', focus: 'Focus', piece: 'Piece', prescribed: 'Prescribed', intent: 'Intent/target',
  demo: 'Demo link', actual: 'Actual', splits: 'Rep splits', rpe: 'RPE', badDay: 'Bad day', pain: 'Pain notes', notes: 'Notes',
};
export function missingExpected(map) { return EXPECTED.filter((k) => !(k in map)).map((k) => CONTRACT_LABELS[k]); }

export function findHeader(values) {
  for (let i = 0; i < Math.min(values.length, 15); i++) {
    const n = (values[i] || []).map((c) => String(c ?? '').trim().toLowerCase());
    if (n.includes('week') && (n.includes('piece') || n.includes('onderdeel'))) return i;
  }
  return -1;
}

export function buildColumnMap(headerRow) {
  const norm = (headerRow || []).map((c) => String(c ?? '').trim().toLowerCase());
  const map = {};
  for (const [k, al] of Object.entries(ALIASES)) {
    const i = norm.findIndex((n) => al.includes(n));
    if (i >= 0) map[k] = i;
  }
  const missingReq = REQUIRED.filter((k) => !(k in map));
  let last = -1;
  norm.forEach((n, i) => { if (n) last = i; });
  let next = last + 1;
  const newHeaders = [];
  for (const k of Object.keys(APP_COLS)) {
    if (!(k in map)) { map[k] = next; newHeaders.push({ col: next, title: APP_COLS[k] }); next++; }
  }
  return { map, newHeaders, missingReq };
}

const FIELDS = ['cycle', 'week', 'dag', 'focus', 'piece', 'benchmark', 'prescribed', 'intent', 'demo', 'actual', 'splits', 'rpe',
  'badDay', 'pain', 'notes', 'loggedAt', 'start', 'end', 'dur', 'sStart', 'sEnd', 'readiness', 'polar'];

export function parseRows(values, headerIdx, map, prefix = '') {
  const rows = [];
  const seen = new Map();
  for (let i = headerIdx + 1; i < values.length; i++) {
    const raw = values[i] || [];
    const get = (k) => (k in map ? String(raw[map[k]] ?? '') : '');
    const weekS = get('week').trim();
    const piece = get('piece').trim();
    if (!weekS && !piece) continue;
    const week = parseInt(weekS, 10);
    if (!Number.isFinite(week) || !piece) continue;
    const r = { rowNum: i + 1 };
    for (const f of FIELDS) r[f] = get(f);
    r.week = week;
    r.piece = piece;
    r.dayIdx = dayIndex(r.dag);
    const base = `${week}|${r.dayIdx}|${piece}`;
    const occ = (seen.get(base) || 0) + 1;
    seen.set(base, occ);
    r.key = `${prefix}${base}|${occ}`;
    rows.push(r);
  }
  return rows;
}

export function status(r) {
  const a = (r.actual || '').trim();
  if (/^(skip|skipped|--+|—|-)$/i.test(a) || /^skipped$/i.test((r.splits || '').trim())) return 'skipped';
  if ((r.loggedAt || '').trim() || a || (r.rpe || '').trim()) return 'done';
  return 'open';
}

export function pieceKind(r) {
  const n = (r.piece || '').toLowerCase();
  const p = (r.prescribed || '').toLowerCase();
  if (/warm-?up/.test(n)) return 'warmup';
  if (/mobility|mobiliteit/.test(n)) return 'mobility';
  if (/\bwod\b/.test(n) || /\b(amrap|emom|for time|rondes|rounds)\b/.test(p)) return 'wod';
  if (/run\/walk|aerobe|bike|rower|\brow\b/.test(n)) return 'cardio';
  return 'strength';
}

// splits: 'show' | 'more' | 'hide'
export function fieldsFor(kind) {
  switch (kind) {
    case 'warmup':
    case 'mobility':
      return { quick: 'Gedaan', actualLabel: 'Opmerking', splits: 'hide', rpe: false, badDay: false, pain: true, notes: true };
    case 'wod':
      return { actualLabel: 'Score / tijd', splits: 'show', rpe: true, badDay: true, pain: true, notes: true };
    case 'cardio':
      return { actualLabel: 'Afstand / tijd / HR', splits: 'hide', rpe: true, badDay: true, pain: true, notes: true };
    default:
      return { actualLabel: 'Gewichten / top set', splits: 'more', rpe: true, badDay: true, pain: true, notes: true };
  }
}

export function normBad(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['no', 'neen', 'nee', 'n'].includes(s)) return 'Neen';
  if (['yes', 'ja', 'j', 'y'].includes(s)) return 'Ja';
  if (['maybe', 'misschien'].includes(s)) return 'Misschien';
  return '';
}

const AFTER_RE = /\s*\|\s*Dag erna:\s*/;
export function splitPain(s) {
  const parts = String(s ?? '').split(AFTER_RE);
  return [parts[0] || '', parts.slice(1).join(' | ')];
}
export function joinPain(pain, after) {
  const p = (pain || '').trim();
  const a = (after || '').trim();
  return a ? (p ? `${p} | Dag erna: ${a}` : `Dag erna: ${a}`) : p;
}

// ---- writing --------------------------------------------------------------

// op: {type:'piece', key, fields, base?}  |  {type:'session', week, dayIdx, fields:{sStart,sEnd}}
export function planWrites(rows, map, op) {
  const cells = [];
  if (op.type === 'piece') {
    const r = rows.find((x) => x.key === op.key);
    if (!r) return null;
    for (const [f, value] of Object.entries(op.fields)) if (f in map) cells.push({ row: r.rowNum, col: map[f], field: f, value });
  } else if (op.type === 'extra') {
    return [];                      // a new row: appended separately (see extraRow)
  } else if (op.type === 'session') {
    const targets = rows.filter((x) => x.week === op.week && x.dayIdx === op.dayIdx);
    if (!targets.length) return null;
    for (const r of targets) for (const f of ['sStart', 'sEnd', 'readiness', 'polar']) {
      if (op.fields[f] !== undefined && f in map) cells.push({ row: r.rowNum, col: map[f], field: f, value: op.fields[f] });
    }
  }
  return cells;
}

// ---- moving pieces to another day/week --------------------------------------
// op: { type:'move', moves:[{ key, week, dayIdx }] }. Only open (unlogged) rows move. Pure: works on a copy of `values`.
// Returns { cells, moves:[{from,dest}], grid, moved, skipped, renamed } where `cells` use the row numbers before reordering.
const DAY_LEVEL = ['sStart', 'sEnd', 'readiness', 'polar'];
const numbered = (name, taken) => {
  if (!taken.has(name)) return name;
  const m = /^(.*) \((\d+)\)$/.exec(name);
  const stem = m && +m[2] < 50 ? m[1] : name;
  for (let n = m && +m[2] < 50 ? +m[2] + 1 : 2; n < 200; n++) if (!taken.has(`${stem} (${n})`)) return `${stem} (${n})`;
  return name;
};
export function planMove(values, hi, map, op, prefix = '') {
  const rows = parseRows(values, hi, map, prefix);
  const items = [], skipped = [];
  for (const m of op.moves || []) {
    const r = rows.find((x) => x.key === m.key);
    if (!r || status(r) !== 'open') skipped.push(m); else items.push({ m, r });
  }
  const moving = new Set(items.map((i) => i.r.rowNum));
  const taken = new Map();                                    // `${week}|${dayIdx}` -> Set(names)
  const add = (w, d, name) => { const k = `${w}|${d}`; if (!taken.has(k)) taken.set(k, new Set()); taken.get(k).add(name); };
  for (const r of rows) if (!moving.has(r.rowNum)) add(r.week, r.dayIdx, r.piece);
  const cells = [], renamed = [];
  for (const { m, r } of items) {
    const k = `${m.week}|${m.dayIdx}`, set = taken.get(k) || new Set();
    const name = numbered(m.piece || r.piece, set);
    add(m.week, m.dayIdx, name);
    cells.push({ row: r.rowNum, col: map.week, value: String(m.week) }, { row: r.rowNum, col: map.dag, value: DAYS[m.dayIdx] });
    if (name !== r.piece) { cells.push({ row: r.rowNum, col: map.piece, value: name }); renamed.push({ from: r.piece, to: name }); }
    r.__final = name;
    for (const f of DAY_LEVEL) if (f in map && String(r[f] || '').trim()) cells.push({ row: r.rowNum, col: map[f], value: '' });
  }
  const sim = values.map((x) => x.slice());
  applyCells(sim, cells);
  const arrs = items.map((i) => sim[i.r.rowNum - 1]);
  const pos = (row) => { const w = parseInt(String(row[map.week] ?? '').trim(), 10); return Number.isFinite(w) ? w * 10 + Math.max(0, dayIndex(row[map.dag])) : null; };
  const moves = [];
  const pending = new Set(arrs);                              // moved rows not placed yet: they do not count as anchors
  items.forEach(({ m }, i) => {
    const arr = arrs[i], from = sim.indexOf(arr);
    sim.splice(from, 1);
    const target = m.week * 10 + m.dayIdx;
    let last = null, firstGreater = null;
    for (const row of sim) {
      if (pending.has(row)) continue;
      const p = pos(row); if (p == null) continue;
      if (p === target) last = row; else if (p > target && !firstGreater) firstGreater = row;
    }
    // sheet header rows (index <= hi) are never anchors: pos() is null for them
    let dest = last ? sim.indexOf(last) + 1 : firstGreater ? sim.indexOf(firstGreater) : sim.length;
    if (m.afterName !== undefined) {                          // undo: back to the original place inside the day
      const group = sim.filter((row) => !pending.has(row) && pos(row) === target);
      if (m.afterName === null && group.length) dest = sim.indexOf(group[0]);
      else if (m.afterName !== null) { const a = group.find((row) => String(row[map.piece] ?? '').trim() === m.afterName); if (a) dest = sim.indexOf(a) + 1; }
    }
    sim.splice(dest, 0, arr); pending.delete(arr);
    if (dest !== from) moves.push({ from, dest: dest <= from ? dest : dest + 1 });
  });
  const placed = items.map(({ m, r }, i) => ({ oldKey: m.key, newRowNum: sim.indexOf(arrs[i]) + 1, from: { week: r.week, dayIdx: r.dayIdx, piece: r.piece }, name: r.__final }));
  return { cells, moves, grid: sim, moved: items.length, skipped, renamed, placed };
}

export function findConflicts(row, op) {
  if (op.type !== 'piece' || !op.base || !row) return [];
  const out = [];
  for (const f of Object.keys(op.base)) {
    if (!(f in op.fields)) continue;
    const cur = String(row[f] ?? '').trim();
    const base = String(op.base[f] ?? '').trim();
    const nv = String(op.fields[f] ?? '').trim();
    if (cur !== base && cur !== nv) out.push(f);
  }
  return out;
}

export function applyCells(grid, cells) {
  for (const { row, col, value } of cells) {
    while (grid.length < row) grid.push([]);
    const r = grid[row - 1];
    while (r.length <= col) r.push('');
    r[col] = value;
  }
}

// ---- dates & times --------------------------------------------------------

const p2 = (n) => String(n).padStart(2, '0');
export const fmtHM = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
export const fmtStamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${fmtHM(ms)}`; };
export function fmtElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${p2(m)}:${p2(x)}` : `${p2(m)}:${p2(x)}`;
}
export function minutesBetweenHM(a, b) {
  const pa = /^(\d{1,2}):(\d{2})$/.exec(a || ''), pb = /^(\d{1,2}):(\d{2})$/.exec(b || '');
  if (!pa || !pb) return null;
  let d = (+pb[1] * 60 + +pb[2]) - (+pa[1] * 60 + +pa[2]);
  if (d < 0) d += 1440;
  return d;
}
export const round1 = (n) => Math.round(n * 10) / 10;

export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
export function dateFor(cycleStart, week, dayIdx) {
  const s = parseDate(cycleStart);
  if (!s) return null;
  const d = mondayOf(s);
  d.setDate(d.getDate() + (week - 1) * 7 + dayIdx);
  return d;
}
export function todayPosition(cycleStart, now = new Date()) {
  const s = parseDate(cycleStart);
  if (!s) return null;
  const m0 = mondayOf(s);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((t - m0) / 864e5);
  if (diff < 0) return null;
  return { week: Math.floor(diff / 7) + 1, dayIdx: diff % 7 };
}

// ---- cycle tabs (Sheet Contract v2: one workbook, one tab per cycle) -------

export const cycleNum = (tab) => { const m = /^\s*cycle\s*(\d+)/i.exec(String(tab || '')); return m ? +m[1] : null; };
export function cycleTabs(tabs) {
  return (tabs || []).filter((t) => cycleNum(t) != null).sort((a, b) => cycleNum(b) - cycleNum(a));
}

// A new row for the sheet (extra session or class), laid out by the column map.
export function extraRow(map, fields) {
  const n = Math.max(-1, ...Object.values(map)) + 1;
  const row = Array(n).fill('');
  for (const [f, v] of Object.entries(fields)) if (f in map) row[map[f]] = String(v ?? '');
  return row;
}
