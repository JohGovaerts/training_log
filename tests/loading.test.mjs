import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/loading.js';

const row = (o) => ({ week: 1, dayIdx: 1, piece: "Back squat full depth (20')", actual: '', skipped: false, ...o });

test('parseKg', () => {
  assert.equal(L.parseKg('145kg'), 145);
  assert.equal(L.parseKg('5x3@170kg\nmax hang: 30s'), 170);
  assert.equal(L.parseKg('142,5'), 142.5);
  assert.equal(L.parseKg('11:31'), null);
});

test('findPercents: only with a week reference, not -10% or kg (80%)', () => {
  assert.deepEqual(L.findPercents('3x3 @ 90% van je wk 1 triple'), [{ pct: 90, week: 1 }]);
  assert.deepEqual(L.findPercents('3x5 @ 60% van wk5-top (deload)'), [{ pct: 60, week: 5 }]);
  assert.deepEqual(L.findPercents('Top-3 RPE8.5, dan 3x3 @ -8%'), []);
  assert.deepEqual(L.findPercents('5x3 @168kg (80%)'), []);
});

test('plates: 130 kg on 20 kg bar, 15 kg bar, exactness', () => {
  assert.deepEqual(L.plates(130, 20).perSide, [25, 25, 5]);
  assert.deepEqual(L.plates(127.5, 20).perSide, [25, 25, 2.5, 1.25]);
  assert.deepEqual(L.plates(100, 15).perSide, [25, 15, 2.5]);
  assert.equal(L.plates(100, 15).exact, true);
  assert.equal(L.plates(15, 15).perSide.length, 0);
  assert.equal(L.plates(10, 20).belowBar, true);
});

test('calcsFor uses the week-1 log of the same piece', () => {
  const rows = [row({ week: 1, actual: '145kg', status: 'done' })];
  const it = row({ week: 5, prescribed: 'Top-3, dan 3x3 @ 90% van wk 1 triple', intent: '' });
  // Sh.status needs a real row shape; use parsed-like objects
  const fake = [{ week: 1, dayIdx: 1, piece: "Back squat full depth (20')", actual: '145kg', loggedAt: '2026-11-03 19:00', skipped: false }];
  const cs = L.calcsFor(it, fake, { bar: 20 });
  assert.equal(cs.length, 1);
  assert.equal(cs[0].refKg, 145);
  assert.equal(cs[0].target, 131);
  assert.deepEqual(cs[0].perSide, [25, 25, 5, 0.5]);
  assert.equal(cs[0].barbell, true);
  const miss = L.calcsFor(it, [], { bar: 20 });
  assert.equal(miss[0].missing, true);
  const future = L.calcsFor({ ...it, week: 1 }, fake, { bar: 20 });
  assert.equal(future[0].missing, true);
});

// Real Cycle 3 prescriptions
test('Cycle 3 notations', () => {
  const f = L.findPercents;
  assert.deepEqual(f('4×4 front squat @ 90% van de W1-triple, RPE7. Rust 2\'30. Spotter arms.'), [{ pct: 90, week: 1 }]);
  assert.deepEqual(f('4×3 front squat @ de W1-triple, RPE8. Rust 3\'.'), [{ pct: 100, week: 1 }]);
  assert.deepEqual(f('3×3 front squat @ 105% van de W1-triple, RPE8,5. Daarna 2×5 @ 85%. Rust 3\'.'), [{ pct: 105, week: 1 }, { pct: 85, week: 1 }]);
  assert.deepEqual(f('Ramp naar een triple op RPE9 (richt W1-triple + 5%), daarna 2×3 @ -10%. Rust 3\'.'), [{ pct: 105, week: 1 }]);
  assert.deepEqual(f('Ramp naar een triple op RPE8, daarna 2×3 @ -10% van die triple.'), []);
  assert.deepEqual(f('5×5 back squat @ 75-78% van 160 kg (120-125 kg), RPE7.'), []);
  assert.deepEqual(f('3×3 deadlift @ 165 kg (±80% van 210), RPE7.'), []);
  assert.deepEqual(f('Ramp naar een triple op RPE9 (richt 152,5-155 kg), daarna 3×3 @ -8%.'), []);
});

test('lift key links differently named pieces; real W1 -> W2 front squat', () => {
  assert.equal(L.liftKey("Front squat ramp (15')"), L.liftKey("Front squat 4×4 (18')"));
  assert.notEqual(L.liftKey("Back squat 5×5 (22')"), L.liftKey("Front squat 4×4 (18')"));
  const w1 = [
    { week: 1, dayIdx: 1, piece: "Front squat ramp (15')", actual: '110kg', loggedAt: '2026-10-27 18:42', skipped: false },
    { week: 1, dayIdx: 1, piece: "Warm-up (10')", actual: 'Gedaan', loggedAt: '2026-10-27 17:47' },
  ];
  const it = { week: 2, dayIdx: 1, piece: "Front squat 4×4 (18')", prescribed: '4×4 front squat @ 90% van de W1-triple, RPE7.', intent: '' };
  const [c] = L.calcsFor(it, w1, { bar: 20 });
  assert.equal(c.refKg, 110);
  assert.equal(c.target, 99);
  assert.deepEqual(c.perSide, [25, 10, 2.5, 2]);   // 20 + 2*39.5 = 99
});

test('explicit loads and ramps from real Cycle 3 text', () => {
  assert.deepEqual(L.findLoads('Ramp: 60×5, 80×3, 100×2, 115×2, 125×1, dan een triple op RPE8 (richt 135-142,5 kg). Rust 3\'.'), [60, 80, 100, 115, 125, 135, 142.5]);
  assert.deepEqual(L.findLoads('5×5 back squat @ 75-78% van 160 kg (120-125 kg), RPE7.'), [120, 125]);
  assert.deepEqual(L.findLoads('4×3 gewogen strict pull-ups @ +20 kg, RPE7.'), []);
  assert.deepEqual(L.findLoads('4×(1+2): squat clean + 2 pause front squat (3s) @ 95 kg, RPE7-8.'), [95]);
  assert.deepEqual(L.findLoads('3×8 Bulgarian split squat per been met 2×16 kg'), []);
  assert.equal(L.loadsFor({ piece: "Bulgarian split squat (10')", prescribed: '2×24 kg' }).length, 0);
  assert.equal(L.loadsFor({ piece: "Strict press 5×3 (12')", prescribed: '5×3 strict press @ 65 kg, RPE7.' })[0].perSide.join(','), '20,2.5');
  assert.equal(L.loadsFor({ piece: "Strict press 5×3 (12')", prescribed: '5×3 @ 65 kg' }, { bar: 15 })[0].perSide.join(','), '25');
});
