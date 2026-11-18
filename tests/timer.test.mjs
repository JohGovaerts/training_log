import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../js/timer.js';

test('parseDur', () => {
  assert.equal(T.parseDur("3'"), 180); assert.equal(T.parseDur("2'30"), 150); assert.equal(T.parseDur('1:30'), 90);
  assert.equal(T.parseDur('90s'), 90); assert.equal(T.parseDur('20 sec'), 20); assert.equal(T.parseDur('2 min'), 120);
  assert.equal(T.parseDur('12'), 720); assert.equal(T.parseDur('45', 's'), 45); assert.equal(T.parseDur('abc'), null);
});

test('parseTimer: EMOM, E2MOM, moves', () => {
  assert.deepEqual(T.parseTimer("EMOM 10': 14 wall balls"), { type: 'emom', total: 600, interval: 60, moves: [] });
  assert.deepEqual(T.parseTimer("EMOM 12 min: 14 wall balls | 12 burpees | 10 KB swings"), { type: 'emom', total: 720, interval: 60, moves: ['14 wall balls', '12 burpees', '10 KB swings'] });
  assert.deepEqual(T.parseTimer("E2MOM 12'"), { type: 'emom', total: 720, interval: 120, moves: [] });
  assert.equal(T.parseTimer('Gewoon een tekst'), null);
});

test('parseTimer: AMRAP, work/rest, tabata, for time, rest', () => {
  assert.deepEqual(T.parseTimer("AMRAP 12': 5 pull-ups, 10 push-ups"), { type: 'amrap', total: 720 });
  assert.deepEqual(T.parseTimer("5 × 3' werk / 2' rust"), { type: 'workrest', rounds: 5, work: 180, rest: 120 });
  assert.deepEqual(T.parseTimer("5 rondes: 3' werk, 2' rust"), { type: 'workrest', rounds: 5, work: 180, rest: 120 });
  assert.deepEqual(T.parseTimer('40s werk / 20s rust x 8'), { type: 'workrest', rounds: 8, work: 40, rest: 20 });
  assert.deepEqual(T.parseTimer('Tabata echo bike'), { type: 'workrest', rounds: 8, work: 20, rest: 10 });
  assert.deepEqual(T.parseTimer('For time, TC 12\', target 9\''), { type: 'fortime', cap: 720, target: 540 });
  assert.deepEqual(T.parseTimer('For time: 3 rondes'), { type: 'fortime', cap: null, target: null });
  assert.deepEqual(T.parseTimer("5×3 @ 100 kg, rust 2'30"), { type: 'rest', rest: 150, sets: 5 });
  assert.deepEqual(T.parseTimer("3×8 @ 60 kg, 90s rust"), { type: 'rest', rest: 90, sets: 3 });
  // an EMOM wins over a rest hint
  assert.equal(T.parseTimer("EMOM 10', rust 30s").type, 'emom');
});

test('plan: EMOM 10 has countdown + 10 intervals and the right clock', () => {
  const p = T.buildPlan({ type: 'emom', total: 600, interval: 60, moves: ['A', 'B'] });
  assert.equal(p.segs.length, 11); assert.equal(p.total, 610);
  let s = T.stateAt(p, 3000); assert.equal(s.phase, 'countdown'); assert.equal(Math.ceil(s.segLeft), 7);
  s = T.stateAt(p, 10000 + 22000); assert.equal(s.phase, 'work'); assert.equal(s.seg.sub, 'interval 1 van 10'); assert.equal(Math.round(s.segLeft), 38); assert.equal(s.seg.move, 'A');
  s = T.stateAt(p, 10000 + 61000); assert.equal(s.seg.sub, 'interval 2 van 10'); assert.equal(s.seg.move, 'B'); assert.equal(s.seg.next, 'Volgende: A');
  s = T.stateAt(p, 610000); assert.equal(s.done, true);
});

test('events: countdown pips, go, warn 10 s before each interval end, start of the next, end', () => {
  const p = T.buildPlan({ type: 'emom', total: 120, interval: 60, moves: [] });
  const ev = T.planEvents(p);
  const at = (type) => ev.filter((e) => e.type === type).map((e) => e.at);
  assert.deepEqual(at('pip'), [7000, 8000, 9000]);
  assert.deepEqual(at('go'), [10000]);
  assert.deepEqual(at('work'), [70000]);          // start of the second interval
  assert.deepEqual(at('warn'), [60000, 120000]);  // 10 s before 70 000 and 130 000
  assert.deepEqual(at('end'), [130000]);
});

test('work/rest: colours alternate, short intervals get no warning, last round has no trailing rest', () => {
  const p = T.buildPlan({ type: 'workrest', rounds: 3, work: 20, rest: 10 });
  assert.deepEqual(p.segs.map((s) => s.kind), ['countdown', 'work', 'rest', 'work', 'rest', 'work']);
  const ev = T.planEvents(p);
  assert.equal(ev.filter((e) => e.type === 'warn').length, 0);
  assert.equal(ev.filter((e) => e.type === 'rest').length, 2);
  const p2 = T.buildPlan({ type: 'workrest', rounds: 2, work: 180, rest: 120 });
  assert.equal(T.planEvents(p2).filter((e) => e.type === 'warn').length, 3);   // work, rest, work each warn once
});

test('for time: counts up from zero after the countdown, target and cap signals, cap ends it', () => {
  const p = T.buildPlan({ type: 'fortime', cap: 720, target: 540 });
  let s = T.stateAt(p, 10000 + 7000); assert.equal(Math.round(s.elapsed), 7); assert.equal(s.phase, 'work');
  s = T.stateAt(p, 10000 + 545000); assert.equal(s.overTarget, true);
  s = T.stateAt(p, 10000 + 720000); assert.equal(s.done, true); assert.equal(s.capHit, true);
  const ev = T.planEvents(p); assert.ok(ev.find((e) => e.type === 'target' && e.at === 550000)); assert.ok(ev.find((e) => e.type === 'end' && e.at === 730000));
  const open = T.buildPlan({ type: 'fortime' }); assert.equal(open.total, null);
  assert.equal(T.stateAt(open, 10000 + 3600000).done, false);
});

test('amrap + rest', () => {
  const p = T.buildPlan({ type: 'amrap', total: 720 });
  assert.equal(T.stateAt(p, 10000 + 300000).segLeft, 420);
  assert.deepEqual(T.planEvents(p).filter((e) => e.type === 'warn').map((e) => e.at), [720000]);
  const r = T.buildPlan({ type: 'rest', rest: 150, sets: 5 });
  assert.equal(r.segs.length, 1); assert.deepEqual(T.planEvents(r).filter((e) => e.type === 'pip').map((e) => e.at), [147000, 148000, 149000]);
  assert.equal(T.stateAt(r, 150000).done, true);
});

test('resultText + runElapsed', () => {
  assert.equal(T.resultText({ type: 'fortime', cap: 720 }, { elapsedS: 754 }), '12:34');
  assert.equal(T.resultText({ type: 'fortime', cap: 720 }, { capHit: true }), 'TC 12:00 bereikt');
  assert.equal(T.resultText({ type: 'amrap' }, { rounds: 7, reps: 12 }), '7 rondes + 12 reps');
  assert.equal(T.resultText({ type: 'amrap' }, { rounds: 7 }), '7 rondes');
  assert.equal(T.runElapsed({ startMs: 1000, accMs: 500, running: true }, 4000), 3500);
  assert.equal(T.runElapsed({ startMs: 1000, accMs: 500, running: false }, 4000), 500);
});

test('scheduler schedules each event once, a little ahead, and skips the past on resume', () => {
  const played = [];
  const b = { play: (t, d) => played.push([t, Math.round(d * 10) / 10]), cancel() {} };
  const sig = [];
  const sc = new T.Scheduler(b, (e) => sig.push(e.type));
  sc.reset([{ at: 1000, type: 'pip' }, { at: 5000, type: 'go' }], 0);
  sc.step(0); assert.equal(played.length, 1);
  sc.step(100); assert.equal(played.length, 1);
  sc.step(4000); assert.deepEqual(played.at(-1), ['go', 1]);
  const sc2 = new T.Scheduler(b, () => {}); sc2.reset([{ at: 1000, type: 'pip' }, { at: 5000, type: 'go' }], 3000);
  const n = played.length; sc2.step(3000); assert.equal(played.length, n);   // 5000 is outside the look-ahead, 1000 is past
});
