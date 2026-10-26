import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../js/records.js';

const ledger = [
  ['Sectie', 'Item', 'Rep/Afstand', 'Current PB', 'Current datum', 'Geschatte PB', 'All-time PB', 'All-time datum', 'Δ abs (cur-AT)', 'Δ % (cur-AT)', 'Noot'],
  ['Main Lifts (kg)', 'Back Squat', '1RM', '—', '', '165 (box)', '165', '10-6-2025', '', '', 'tempo box squat'],
  ['Main Lifts (kg)', 'Back Squat', '3RM', '—', '', '', '150', '11-7-2023'],
  ['Main Lifts (kg)', 'Deadlift', '1RM', '210', '1-6-2026', '217.5 (met chalk)', '215.5', '31-5-2025'],
  ['Monostructural', 'Row', '500 m', '—', '', '', '1:26', '5-10-2025'],
  ['Monostructural', 'Row', '2 km', '7:16', '1-6-2026', '', '7:08', '9-11-2023', '+8 s', '1,90%', 'assessment 7:16 conditions-limited'],
  ['Skills & Gym', 'Handstand hold (wall)', 'tijd', '1:15', '1-6-2026', '', '1:15', '1-6-2026'],
  ['Skills & Gym', 'Handstand walk', 'afstand', '21 m', '1-6-2026', '', '90 m', 'historisch'],
  ['Skills & Gym', 'Weighted strict pull-up', '1RM extra last', '—', '', '', '+54 kg', '23-2-2025'],
];
const summary = [
  ['Categorie', 'Workout', 'Current', 'Current datum', 'Rx/Sc', 'All-time best', 'All-time datum', 'Δ abs (cur-AT)', 'Δ % (cur-AT)', 'Noot'],
  ['Olympic', 'Grace', '0:02:40', '2026-06-23', 'Rx', '0:02:40', '2026-06-23', '0 s', '0%', ''],
  ['Light', 'Fran', '0:04:56', '2022-08-27', 'Rx', '0:04:56', '2022-08-27', '0 s', '0%', 'retest-kandidaat (>12 mnd)'],
  ['Long', 'Murph', '0:45:18', '2024-07-14', 'Rx', '0:45:16', '2017-06-09', '+2 s', '0,1%', ''],
  ['Bodyweight', 'Cindy', '391 reps', '2017-06-29', 'Rx', '391 reps', '2017-06-29'],
];
const history = [
  ['Categorie', 'Workout', 'Resultaat', 'Rx/Scaled', 'Datum', 'Noot'],
  ['Olympic', 'Grace', '2 mins 57 secs', 'Rx', '2022-08-27'],
  ['Olympic', 'Grace', '2 mins 40 secs', 'Rx', '2026-06-23', 'meest recent / beste'],
  ['Olympic', 'Grace', '3 mins 7 secs', 'Rx', '2019-11-21'],
  ['Bodyweight', 'Cindy', '13 rounds + 1 Pull-up | 391 reps', 'Rx', '2017-06-29'],
];
const built = R.buildRecords({ ledger, summary, history });
const byId = (id) => built.records.find((r) => r.id === id);

test('parseTime / fmtTime / parseResult', () => {
  assert.equal(R.parseTime('4:56'), 296); assert.equal(R.parseTime('0:04:56'), 296);
  assert.equal(R.parseTime('7 mins 18 secs'), 438); assert.equal(R.parseTime('25 mins'), 1500);
  assert.equal(R.parseTime('2 mins 40 sec\'s'), 160); assert.equal(R.parseTime('24 s'), 24); assert.equal(R.parseTime('abc'), null);
  assert.equal(R.fmtTime(296), '4:56'); assert.equal(R.fmtTime(3725), '1:02:05');
  assert.deepEqual(R.parseResult('13 rounds + 1 Pull-up | 391 reps'), { num: 391, time: false });
  assert.deepEqual(R.parseResult('45 mins 18 secs'), { num: 2718, time: true });
});

test('dates', () => {
  assert.equal(R.isoDate(R.parseAnyDate('1-6-2026')), '2026-06-01');
  assert.equal(R.isoDate(R.parseAnyDate('2026-06-23')), '2026-06-23');
  assert.equal(R.parseAnyDate('historisch'), null);
  assert.equal(R.fmtDateNL('2026-06-01'), '1 jun 2026');
});

test('records: directions, units, dates', () => {
  assert.equal(built.records.length, 8 + 4);
  assert.equal(byId('backsquat1rm').est.num, 165);
  assert.equal(byId('backsquat1rm').current, null);
  assert.equal(byId('backsquat1rm').allTime.date, '2025-06-10');
  assert.equal(byId('row500m').lowerBetter, true);
  assert.equal(byId('row500m').allTime.num, 86);
  assert.equal(byId('deadlift1rm').lowerBetter, false);
  assert.equal(byId('handstandholdwall' + 'tijd').lowerBetter, false);
  assert.equal(byId('handstandholdwalltijd').current.num, 75);
  assert.equal(byId('handstandwalkafstand').allTime.date, '');
  assert.equal(byId('weightedstrictpullup1rmextralast').allTime.num, 54);
  assert.equal(byId('grace').lowerBetter, true); assert.equal(byId('grace').current.num, 160);
  assert.equal(byId('murph').current.num, 2718); assert.equal(byId('murph').allTime.num, 2716);
  assert.equal(byId('cindy').lowerBetter, false); assert.equal(byId('cindy').current.num, 391);
  assert.equal(built.history.grace.length, 3); assert.equal(built.history.grace[0].date, '2026-06-23');
  assert.equal(built.history.cindy[0].num, 391);
});

test('recordFor: Benchmark column, aliases and name fallback', () => {
  const rs = built.records;
  assert.equal(R.recordFor('x', 'Row 500m', rs).id, 'row500m');
  assert.equal(R.recordFor('x', 'Row 2k', rs).id, 'row2km');
  assert.equal(R.recordFor('x', 'Back Squat 1RM', rs).id, 'backsquat1rm');
  assert.equal(R.recordFor('x', 'Fran', rs).id, 'fran');
  assert.equal(R.recordFor("Grace (12')", '', rs).id, 'grace');
  assert.equal(R.recordFor('Back squat full depth (20\')', '', rs), null, 'lifts need an explicit Benchmark key');
  assert.equal(R.recordFor('x', 'Onbekend', rs), null);
});

test('resultNum from logged text', () => {
  assert.equal(R.resultNum('7:20 (RPE 9)', byId('row2km')), 440);
  assert.equal(R.resultNum('1:27.5', byId('row500m')), 87);
  assert.equal(R.resultNum('150kg x3, 155kg x1', byId('backsquat1rm')), 155);
  assert.equal(R.resultNum('18 reps', byId('cindy')), 18);
  assert.equal(R.resultNum('', byId('row2km')), null);
});

test('judge: good / ok / bad day, bad-day flag, lower bound', () => {
  assert.equal(R.judge({ ratio: 1.01, badDay: 'Neen', rpe: '9' }).tone, 'good');
  assert.equal(R.judge({ ratio: 0.95, badDay: 'Neen', rpe: '8' }).tone, 'ok');
  assert.equal(R.judge({ ratio: 0.90, badDay: 'Neen' }).tone, 'bad');
  const b = R.judge({ ratio: 0.95, badDay: 'Ja' }); assert.equal(b.tone, 'bad'); assert.equal(b.lowerBound, true);
  assert.match(R.judge({ ratio: 1.02, badDay: 'Ja' }).label, /ondanks slechte dag/);
  assert.equal(R.judge({ ratio: null, badDay: '' }).tone, 'unknown');
  assert.match(R.judge({ ratio: 0.97, badDay: 'Neen', rpe: '7' }).label, /voelde licht/);
});

test('ratio: lower-is-better vs higher-is-better', () => {
  assert.ok(Math.abs(R.ratioTo(byId('row2km'), 440) - 436 / 440) < 1e-9);
  assert.ok(R.ratioTo(byId('row2km'), 430) > 1);
  assert.ok(Math.abs(R.ratioTo(byId('deadlift1rm'), 199.5) - 0.95) < 1e-9);
});

test('pastResults merges ledger history + app logs, newest first, excludes itself', () => {
  const logs = [
    { tab: 'Cycle 3', key: 'Cycle 3§1|1|Row 2k|1', piece: 'Row 2k test', benchmark: 'Row 2k', actual: '7:20', rpe: '9', badDay: 'Neen', date: '2026-11-03' },
    { tab: 'Cycle 3', key: 'Cycle 3§2|1|Row 2k|1', piece: 'Row 2k test', benchmark: 'Row 2k', actual: '7:10', rpe: '9', badDay: 'Ja', date: '2026-12-01' },
  ];
  const past = R.pastResults(byId('row2km'), { history: built.history, logs, records: built.records, exclude: { tab: 'Cycle 3', key: 'Cycle 3§2|1|Row 2k|1' } });
  assert.equal(past.length, 1); assert.equal(past[0].raw, '7:20'); assert.equal(past[0].source, 'app');
  assert.equal(past[0].verdict.tone, 'good');
  const g = R.pastResults(byId('grace'), { history: built.history, logs: [], records: built.records });
  assert.deepEqual(g.map((x) => x.date), ['2026-06-23', '2022-08-27', '2019-11-21']);
  assert.equal(g[0].verdict.tone, 'good');
  assert.equal(g[1].verdict.tone, 'bad');
});

test('confidence: fresh tested > old estimate > old all-time; reasons present', () => {
  const now = new Date(2026, 9, 26);
  const dl = R.confidence(byId('deadlift1rm'), { now });
  const bs = R.confidence(byId('backsquat1rm'), { now });
  const hs = R.confidence(byId('weightedstrictpullup1rmextralast'), { now });
  const fran = R.confidence(byId('fran'), { now });
  assert.ok(dl.pct >= 90, 'deadlift 5 mnd oud: ' + dl.pct);
  assert.ok(bs.pct < dl.pct && bs.pct > hs.pct);
  assert.ok(hs.pct < bs.pct);
  assert.ok(fran.pct < 40, 'Fran 2022: ' + fran.pct);
  assert.ok(dl.reasons.length >= 1);
  assert.equal(R.confidence({ current: null, est: null, allTime: null }, { now }).pct, null);
});

test('collectLogs reads logged rows of several tabs', () => {
  const H = ['Cycle', 'Week', 'Dag', 'Focus', 'Piece', 'Benchmark', 'Prescribed', 'Intent/target', 'Demo link', 'Actual', 'Rep splits', 'RPE', 'Bad day', 'Pain notes', 'Notes', 'Gelogd op'];
  const g = { 'Cycle 3': { values: [H, [3, 1, 'Di', 'F', 'Row 2k test', 'Row 2k', 'x', 'y', '', '7:20', '', '9', 'Neen', '', '', '2026-11-03 07:10'], [3, 1, 'Wo', 'F', 'Open', 'Fran', 'x', 'y']] } };
  const logs = R.collectLogs(g, {});
  assert.equal(logs.length, 1); assert.equal(logs[0].benchmark, 'Row 2k'); assert.equal(logs[0].date, '2026-11-03'); assert.equal(logs[0].badDay, 'Neen');
});
