import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/sheet.js';

const header = ['Week', 'Dag', 'Focus', 'Piece', 'Prescribed', 'Intent/target', 'Demo link', 'Actual', 'Rep splits', 'RPE', 'Bad day', 'Pain notes', 'Notes'];
const grid = [
  header,
  [1, 'Di', 'Squat', "Warm-up 10'", 'x', 'y'],
  [1, 'Di', 'Squat', 'WOD', '3 rondes: ...', 'Grind', '', '5:21', '', '8', 'No', 'Geen pijn'],
  [1, 'Di', 'Squat', 'WOD', 'again', 'dup'],
  ['', '', '', ''],
  [2, 'zo', 'Eng', 'Run/walk #2', '5\' wandel'],
];

test('colLetter / a1', () => {
  assert.equal(S.colLetter(0), 'A'); assert.equal(S.colLetter(25), 'Z'); assert.equal(S.colLetter(26), 'AA'); assert.equal(S.colLetter(13), 'N');
  assert.equal(S.a1("Cycle's", 5, 7), "'Cycle''s'!H5");
});

test('header detection + column map appends app columns', () => {
  assert.equal(S.findHeader([[], header]), 1);
  const { map, newHeaders, missingReq } = S.buildColumnMap(header);
  assert.equal(map.actual, 7); assert.equal(map.notes, 12);
  assert.deepEqual(newHeaders.map((h) => h.title), ['Gelogd op', 'Start', 'Einde', 'Duur (min)', 'Sessie start', 'Sessie einde']);
  assert.equal(map.loggedAt, 13); assert.equal(map.sEnd, 18); assert.equal(missingReq.length, 0);
  const again = S.buildColumnMap([...header, 'Gelogd op', 'Start']);
  assert.equal(again.map.loggedAt, 13); assert.equal(again.newHeaders[0].title, 'Einde'); assert.equal(again.map.end, 15);
});

test('parseRows: keys, duplicates, blanks, day aliases', () => {
  const { map } = S.buildColumnMap(header);
  const rows = S.parseRows(grid, 0, map);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].key, '1|1|WOD|1'); assert.equal(rows[2].key, '1|1|WOD|2');
  assert.equal(rows[3].dayIdx, 6); assert.equal(rows[1].rowNum, 3);
});

test('status + kinds', () => {
  const { map } = S.buildColumnMap(header);
  const rows = S.parseRows(grid, 0, map);
  assert.equal(S.status(rows[0]), 'open'); assert.equal(S.status(rows[1]), 'done');
  assert.equal(S.status({ actual: 'Skip' }), 'skipped'); assert.equal(S.status({ actual: '--' }), 'skipped');
  assert.equal(S.pieceKind(rows[0]), 'warmup'); assert.equal(S.pieceKind(rows[1]), 'wod'); assert.equal(S.pieceKind(rows[3]), 'cardio');
  assert.equal(S.pieceKind({ piece: 'Back squat full depth (20\')', prescribed: 'Ramp' }), 'strength');
  assert.equal(S.pieceKind({ piece: 'Aerobe basis', prescribed: '5x(3\' Z2 / 1\' easy)' }), 'cardio');
});

test('planWrites, conflicts, applyCells', () => {
  const { map } = S.buildColumnMap(header);
  const g = grid.map((r) => r.slice());
  const rows = S.parseRows(g, 0, map);
  const op = { type: 'piece', key: '1|1|Warm-up 10\'|1'.replace("Warm-up 10'", rows[0].piece), fields: { actual: 'Gedaan', loggedAt: '2026-10-26 18:00' }, base: { actual: '' } };
  const cells = S.planWrites(rows, map, op);
  assert.deepEqual(cells.map((c) => [c.row, c.col]), [[2, 7], [2, 13]]);
  S.applyCells(g, cells);
  assert.equal(g[1][7], 'Gedaan'); assert.equal(g[1][13], '2026-10-26 18:00'); assert.equal(g[1][8], '');
  // conflict: sheet changed by someone else since load
  const row = { actual: 'iets anders' };
  assert.deepEqual(S.findConflicts(row, op), ['actual']);
  assert.deepEqual(S.findConflicts({ actual: 'Gedaan' }, op), []);
  assert.deepEqual(S.findConflicts({ actual: '' }, op), []);
  assert.equal(S.planWrites(rows, map, { type: 'piece', key: 'nope', fields: {} }), null);
  const sess = S.planWrites(rows, map, { type: 'session', week: 1, dayIdx: 1, fields: { sStart: '18:00', sEnd: '19:10' } });
  assert.equal(sess.length, 6); // 3 rows x 2 cols
});

test('time helpers', () => {
  assert.equal(S.minutesBetweenHM('18:05', '19:12'), 67); assert.equal(S.minutesBetweenHM('23:50', '00:10'), 20);
  assert.equal(S.minutesBetweenHM('', '19:12'), null);
  assert.equal(S.fmtElapsed(65000), '01:05'); assert.equal(S.fmtElapsed(3725000), '1:02:05');
  assert.match(S.fmtStamp(Date.now()), /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
});

test('date mapping (week/day <-> calendar)', () => {
  // 2026-10-19 is a Monday = week 1 start
  assert.equal(S.dateFor('2026-10-19', 1, 0).getDate(), 19);
  assert.equal(S.dateFor('2026-10-21', 2, 1).getDate(), 27); // non-Monday start snaps to Monday
  assert.deepEqual(S.todayPosition('2026-10-19', new Date(2026, 9, 26)), { week: 2, dayIdx: 0 });
  assert.deepEqual(S.todayPosition('2026-10-19', new Date(2026, 9, 31)), { week: 2, dayIdx: 5 });
  assert.equal(S.todayPosition('2026-10-19', new Date(2026, 9, 1)), null);
  assert.equal(S.todayPosition('', new Date()), null);
});

test('pain split/join', () => {
  assert.deepEqual(S.splitPain('Geen pijn | Dag erna: stijf'), ['Geen pijn', 'stijf']);
  assert.equal(S.joinPain('Geen pijn', 'stijf'), 'Geen pijn | Dag erna: stijf');
  assert.equal(S.joinPain('', 'ok'), 'Dag erna: ok'); assert.equal(S.joinPain('x', ''), 'x');
  assert.equal(S.normBad('No'), 'Neen'); assert.equal(S.normBad('Misschien '), 'Misschien'); assert.equal(S.normBad('--'), '');
});
