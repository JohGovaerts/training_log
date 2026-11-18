import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../js/polar.js';
import * as Sh from '../js/sheet.js';

test('configured / baseUrl', () => {
  assert.ok(P.configured({ polarUrl: 'https://x.workers.dev', polarKey: 'k' }));
  assert.ok(!P.configured({ polarUrl: 'https://x', polarKey: '' }));
  assert.ok(!P.configured({}));
  assert.equal(P.baseUrl('https://x.workers.dev/'), 'https://x.workers.dev');
  assert.equal(P.baseUrl(' https://x.workers.dev/mcp '), 'https://x.workers.dev');
});

const EXS = [
  { start: '2026-11-18T09:08:18', durationMin: 3.2, avgHr: 85 },
  { start: '2026-11-18T14:05:00', durationMin: 52, avgHr: 142 },
  { start: '2026-11-18T18:00:00', durationMin: 60, avgHr: 130 },
];
test('matchExercise', () => {
  assert.equal(P.matchExercise(EXS, '14:00', '15:00').avgHr, 142);
  assert.equal(P.matchExercise(EXS, '17:55', '19:00').avgHr, 130);
  assert.equal(P.matchExercise(EXS, '12:00', '12:30'), null);       // niets in de buurt
  assert.equal(P.matchExercise(EXS, '', '').avgHr, 130);            // zonder tijden: langste
  assert.equal(P.matchExercise([], '14:00', '15:00'), null);
  assert.equal(P.matchExercise(null, '14:00', '15:00'), null);
  assert.equal(P.matchExercise(EXS, '14:20', '14:40').avgHr, 142);  // venster binnen de training
});

test('polarText', () => {
  const day = { recharge: { status: 5, ansCharge: -0.4, hrv: 71 }, sleep: { score: 81, asleepMin: 424 } };
  assert.equal(P.polarText(day, null), 'Recharge 5/6 · ANS -0,4 · HRV 71 · Slaap 81 (7u04)');
  assert.equal(P.polarText({ recharge: { status: 6, ansCharge: 10, hrv: 96 } }, { avgHr: 142, maxHr: 171, cardioLoad: 38.4, rpe: 'HARD' }),
    'Recharge 6/6 · ANS +10 · HRV 96 · Training gem HR 142, max 171, load 38,4, RPE HARD');
  assert.equal(P.polarText({}, null), '');
  assert.equal(P.polarText(null, null), '');
  // mag nooit met = + - of een datum beginnen
  assert.ok(!/^[=+\-@\d]/.test(P.polarText(day, null)));
  assert.ok(P.polarText({ recharge: { status: 1, ansCharge: -9 } }, { avgHr: 1 }).length <= 220);
});

test('api: fouten en header', async () => {
  const calls = [];
  const ok = async (url, o) => { calls.push([url, o.headers['X-App-Key']]); return { ok: true, json: async () => ({ ok: true }) }; };
  await P.ping({ polarUrl: 'https://x.dev/', polarKey: ' abc ' }, ok);
  assert.deepEqual(calls[0], ['https://x.dev/api/ping', 'abc']);
  await assert.rejects(() => P.day({ polarUrl: 'https://x.dev', polarKey: 'k' }, '2026-11-18', async () => ({ ok: false, status: 401, json: async () => ({ error: 'ongeldige code' }) })), /ongeldige code/);
  await assert.rejects(() => P.day({ polarUrl: 'https://x.dev', polarKey: 'k' }, '2026-11-18', async () => { throw new TypeError('fail'); }), /Geen verbinding/);
  await assert.rejects(() => P.day({ polarUrl: 'https://x.dev', polarKey: 'k' }, '2026-11-18', async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } })), /500/);
});

test('sheet: polar is een lazy kolom die op elke rij van de dag landt', () => {
  const header = ['Cycle', 'Week', 'Dag', 'Focus', 'Piece', 'Prescribed', 'Actual', 'Gelogd op'];
  const { map, newHeaders } = Sh.buildColumnMap(header);
  assert.ok(!('polar' in map)); assert.equal(newHeaders.some((h) => h.title === 'Polar'), false);
  Sh.ensureCol(map, newHeaders, 'polar');
  assert.equal(newHeaders.at(-1).title, 'Polar');
  const values = [header, [3, 2, 'Wo', 'K', "A (10')", 'x', '', ''], [3, 2, 'Wo', 'K', "B (10')", 'y', '', '']];
  const rows = Sh.parseRows(values, 0, map, 't§');
  const cells = Sh.planWrites(rows, map, { type: 'session', week: 2, dayIdx: 2, fields: { polar: 'Recharge 5/6' } });
  assert.equal(cells.length, 2); assert.ok(cells.every((c) => c.field === 'polar' && c.col === map.polar));
});

test('recoveryLevel', () => {
  assert.equal(P.recoveryLevel(null), null);
  assert.equal(P.recoveryLevel({}), null);
  const ok = P.recoveryLevel({ recharge: { status: 5, ansStatus: 3 }, sleep: { score: 81 } });
  assert.equal(ok.level, 'ok'); assert.equal(ok.label, 'goed'); assert.deepEqual(ok.reasons, []);
  const low = P.recoveryLevel({ recharge: { status: 3, ansStatus: 2 }, sleep: { score: 36 } });
  assert.equal(low.level, 'low'); assert.equal(low.reasons.length, 3);
  assert.equal(P.recoveryLevel({ sleep: { score: 40 } }).level, 'low');          // slaap < 45 = rood
  assert.equal(P.recoveryLevel({ sleep: { score: 50 } }).level, 'mid');          // 45-59 = oranje
  assert.equal(P.recoveryLevel({ recharge: { status: 3, ansStatus: 4 }, sleep: { score: 80 } }).level, 'mid');
  assert.equal(P.recoveryLevel({ recharge: { status: 3, ansStatus: 2 }, sleep: { score: 80 } }).level, 'low'); // 2 oranje = rood
  assert.equal(P.recoveryLevel({ recharge: { status: 2, ansStatus: 4 }, sleep: { score: 80 } }).level, 'low');
  assert.equal(P.recoveryLevel({ recharge: { status: 4, ansStatus: 3 }, sleep: { score: 60 } }).level, 'ok');
  // eigen antwoorden tellen mee
  const good = { recharge: { status: 5, ansStatus: 4 }, sleep: { score: 80 } };
  assert.equal(P.recoveryLevel(good, 'Slaap goed · Spierpijn veel · Stress laag').level, 'mid');
  assert.equal(P.recoveryLevel(good, 'Slaap goed · Spierpijn veel · Stress hoog').level, 'low');
  assert.equal(P.recoveryLevel(good, 'Slaap goed · Spierpijn matig · Stress matig').level, 'ok');
  assert.equal(P.recoveryLevel({}, 'Slaap slecht · Spierpijn geen · Stress laag').level, 'mid'); // zonder Polar: eigen antwoorden
  assert.equal(P.recoveryLevel({ sleep: { score: 80 } }, 'Slaap slecht · Spierpijn geen · Stress laag').level, 'ok'); // Polar-slaap wint
  assert.equal(P.recoveryText({ recharge: { status: 5, ansCharge: -0.4 }, sleep: { score: 81, asleepMin: 424 }, exercises: [] }), 'Recharge 5/6 · ANS -0,4 · Slaap 81 (7u04)');
});

test('sleepAnswer', () => {
  assert.equal(P.sleepAnswer(null), null);
  assert.equal(P.sleepAnswer({}), null);
  assert.equal(P.sleepAnswer({ sleep: null }), null);
  assert.equal(P.sleepAnswer({ sleep: { score: 81 } }), 'Goed');
  assert.equal(P.sleepAnswer({ sleep: { score: 70 } }), 'Goed');
  assert.equal(P.sleepAnswer({ sleep: { score: 63 } }), 'Ok');
  assert.equal(P.sleepAnswer({ sleep: { score: 36 } }), 'Slecht');
});
