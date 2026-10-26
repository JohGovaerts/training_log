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
  week: ['week'], dag: ['dag', 'day'], focus: ['focus'], piece: ['piece', 'onderdeel'],
  prescribed: ['prescribed'], intent: ['intent/target', 'intent', 'target'], demo: ['demo link', 'demo'],
  actual: ['actual'], splits: ['rep splits'], rpe: ['rpe'], badDay: ['bad day'],
  pain: ['pain notes'], notes: ['notes'],
  loggedAt: ['gelogd op'], start: ['start'], end: ['einde'], dur: ['duur (min)', 'duur'],
  sStart: ['sessie start'], sEnd: ['sessie einde'],
};
// Columns the app adds (to the right of the existing ones) when missing.
export const APP_COLS = {
  loggedAt: 'Gelogd op', start: 'Start', end: 'Einde', dur: 'Duur (min)',
  sStart: 'Sessie start', sEnd: 'Sessie einde',
};
const REQUIRED = ['week', 'dag', 'piece'];

export function colLetter(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function a1(tab, row, col) {
  return `'${String(tab).replace(/'/g, "''")}'!${colLetter(col)}${row}`;
}

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

const FIELDS = ['week', 'dag', 'focus', 'piece', 'prescribed', 'intent', 'demo', 'actual', 'splits', 'rpe',
  'badDay', 'pain', 'notes', 'loggedAt', 'start', 'end', 'dur', 'sStart', 'sEnd'];

export function parseRows(values, headerIdx, map) {
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
    r.key = `${base}|${occ}`;
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
  } else if (op.type === 'session') {
    const targets = rows.filter((x) => x.week === op.week && x.dayIdx === op.dayIdx);
    if (!targets.length) return null;
    for (const r of targets) for (const f of ['sStart', 'sEnd']) {
      if (op.fields[f] !== undefined && f in map) cells.push({ row: r.rowNum, col: map[f], field: f, value: op.fields[f] });
    }
  }
  return cells;
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
