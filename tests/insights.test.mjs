import test from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/insights.js';

test('baseName ignores minutes and sets x reps', () => {
  assert.equal(I.baseName("Back squat 5×5 (22')"), I.baseName("Back squat 4x3 (20')"));
  assert.notEqual(I.baseName("Back squat (20')"), I.baseName("Front squat (20')"));
});
test('plannedMin', () => {
  assert.equal(I.plannedMin("Back squat 5×5 (22')"), 22);
  assert.equal(I.plannedMin("Warm-up 10'"), 10);
  assert.equal(I.plannedMin('Cooldown (5 min)'), 5);
  assert.equal(I.plannedMin('Geen minuten'), 0);
});
test('prevLog picks the latest earlier log of the same movement', () => {
  const logs = [
    { tab: 'Cycle 2', key: 'a', week: 5, dayIdx: 0, piece: "Back squat 3×3 (20')", actual: '120×3' },
    { tab: 'Cycle 3', key: 'b', week: 1, dayIdx: 0, piece: "Back squat 5×5 (22')", actual: '100×5' },
    { tab: 'Cycle 3', key: 'c', week: 2, dayIdx: 0, piece: "Back squat 5×5 (22')", actual: '105×5' },
    { tab: 'Cycle 3', key: 'd', week: 3, dayIdx: 0, piece: "Back squat 5×5 (22')", actual: '110×5' },
  ];
  assert.equal(I.prevLog(logs, { key: 'c', week: 2, dayIdx: 0, piece: "Back squat 5×5 (22')" }, 'Cycle 3').key, 'b');
  assert.equal(I.prevLog(logs, { key: 'b', week: 1, dayIdx: 0, piece: "Back squat 5×5 (22')" }, 'Cycle 3').key, 'a');
  assert.equal(I.prevLog(logs, { key: 'x', week: 1, dayIdx: 0, piece: 'Snatch' }, 'Cycle 3'), null);
});
test('dayTimes: session time wins, else sum of piece durations', () => {
  const rows = [{ piece: "A (20')", sStart: '18:00', sEnd: '19:18', dur: '', actual: 'x', loggedAt: 'x' }, { piece: "B (10')", sStart: '18:00', sEnd: '19:18' }];
  assert.deepEqual(I.dayTimes(rows), { planned: 30, real: 78, src: 'sessie' });
  const r2 = [{ piece: "A (20')", dur: '22', actual: 'x' }, { piece: "B (10')", dur: '12', actual: 'x' }, { piece: "C (5')", dur: '', actual: '' }];
  assert.deepEqual(I.dayTimes(r2), { planned: 35, real: 34, src: 'onderdelen' });
  assert.equal(I.overTone(60, 78), 'bad'); assert.equal(I.overTone(60, 62), 'ok'); assert.equal(I.overTone(60, 68), 'warn');
});
test('sets, tonnage and e1RM', () => {
  assert.deepEqual(I.parseSets('60×5, 80x3, 100 kg × 2').map((s) => s.kg), [60, 80, 100]);
  assert.equal(I.tonnage('100×5, 110×3'), 830);
  assert.equal(I.e1rm({ kg: 100, reps: 1 }), 100);
  assert.ok(Math.abs(I.e1rm({ kg: 100, reps: 5 }) - 112.5) < 0.1);
  assert.equal(I.e1rm({ kg: 50, reps: 15 }), null);
});
test('liftSeries needs two points and skips WODs', () => {
  const logs = [
    { tab: 'Cycle 3', key: '1', week: 1, dayIdx: 0, piece: "Back squat 5×5 (20')", actual: '100×5', date: '2026-10-01' },
    { tab: 'Cycle 3', key: '2', week: 2, dayIdx: 0, piece: "Back squat 5×5 (20')", actual: '105×5', date: '2026-10-08' },
    { tab: 'Cycle 3', key: '3', week: 1, dayIdx: 1, piece: "Fran WOD", actual: '21×15', date: '2026-10-02' },
    { tab: 'Cycle 3', key: '4', week: 1, dayIdx: 2, piece: "Press (10')", actual: '60×5', date: '2026-10-03' },
  ];
  const s = I.liftSeries(logs);
  assert.equal(s.length, 1); assert.equal(s[0].pts.length, 2); assert.ok(s[0].pts[1].v > s[0].pts[0].v);
});
test('rpeNum', () => { assert.equal(I.rpeNum('8-9'), 8.5); assert.equal(I.rpeNum('7'), 7); assert.equal(I.rpeNum(''), null); });
const mkRow = (o) => ({ cycle: '3', week: 1, dayIdx: 0, dag: 'Ma', focus: 'Kracht', piece: "Back squat (20')", prescribed: '', actual: '', rpe: '', pain: '', badDay: '', loggedAt: '', dur: '', sStart: '', sEnd: '', ...o });
test('weekSummary', () => {
  const rows = [
    mkRow({ actual: '100×5', rpe: '8', loggedAt: '2026-11-16 18:00', dur: '25' }),
    mkRow({ piece: "Core (10')", actual: 'skip' }),
    mkRow({ dayIdx: 2, dag: 'Wo', focus: 'Optioneel conditioning', piece: "Row (15')" }),
  ];
  const s = I.weekSummary(rows, 1);
  assert.equal(s.sessionsPlanned, 2); assert.equal(s.sessions, 1); assert.equal(s.coreDone, 1); assert.equal(s.coreTotal, 1);
  assert.equal(s.skipped, 1); assert.equal(s.tonnage, 500); assert.equal(s.rpe, 8); assert.equal(s.real, 25); assert.equal(s.planned, 30);
});
test('painCandidate: yesterday, knee movement or pain note, not answered twice', () => {
  const now = new Date(2026, 10, 18, 9, 0);
  const rows = [mkRow({ piece: "Back squat (20')", actual: '100×5', loggedAt: '2026-11-17 18:30' })];
  const c = I.painCandidate(rows, now, {}, 'Cycle 3');
  assert.ok(c && c.reason.includes('Back squat'));
  assert.equal(I.painCandidate(rows, now, { 'pain|Cycle 3|1|0': 1 }, 'Cycle 3'), null);
  assert.equal(I.painCandidate(rows, new Date(2026, 10, 21), {}, 'Cycle 3'), null);
  assert.equal(I.painCandidate([mkRow({ piece: "Strict press (15')", actual: '60×5', loggedAt: '2026-11-17 18:30' })], now, {}, 'Cycle 3'), null);
  assert.ok(I.painCandidate([mkRow({ piece: "Strict press (15')", actual: '60×5', pain: 'Lichte last', loggedAt: '2026-11-17 18:30' })], now, {}, 'Cycle 3'));
  assert.equal(I.painCandidate([mkRow({ actual: '100×5', pain: 'Lichte last | Dag erna: knie 2/10', loggedAt: '2026-11-17 18:30' })], now, {}, 'Cycle 3'), null);
  assert.equal(I.painCandidate([mkRow({ actual: '100×5', pain: 'Geen pijn', piece: 'Press', loggedAt: '2026-11-17 18:30' })], now, {}, 'Cycle 3'), null);
});
test('painText', () => {
  assert.equal(I.painText(['Geen klachten'], ''), 'Geen klachten');
  assert.equal(I.painText(['Knie'], 2), 'Knie 2/10');
  assert.equal(I.painText(['Knie', 'Rug'], ''), 'Knie + Rug');
});
test('toCsv: BOM, semicolons, quotes, newlines', () => {
  const csv = I.toCsv([{ cycle: '3', week: 1, dag: 'Ma', piece: 'Squat; zwaar', actual: '100×5\n105×3', notes: 'zei "ok"' }]);
  assert.ok(csv.startsWith('\uFEFFCycle;Week;Dag;'));
  assert.ok(csv.includes('"Squat; zwaar"') && csv.includes('100×5 / 105×3') && csv.includes('"zei ""ok"""'));
});
test('readiness text and completeness', () => {
  const r = { sl: 'Goed', sp: 'Matig', st: 'Laag' };
  assert.equal(I.readyText(r), 'Slaap goed · Spierpijn matig · Stress laag');
  assert.ok(I.readyComplete(r)); assert.ok(!I.readyComplete({ sl: 'Goed', sp: '', st: 'Laag' }));
});
