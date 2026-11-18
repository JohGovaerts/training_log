import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Co from '../js/coach.js';

const row = (o) => ({ week: 1, dayIdx: 0, focus: 'Kracht', piece: 'Back squat', prescribed: '5×5 @75%', actual: '', rpe: '', pain: '', notes: '', splits: '', badDay: '', loggedAt: '', ...o });

test('ramp: ends at target, plates per side, strictly increasing', () => {
  const r = Co.buildRamp(140, { bar: 20 });
  assert.equal(r[0].kg, 20); assert.equal(r.at(-1).kg, 140); assert.equal(r.at(-1).reps, 0);
  for (let i = 1; i < r.length; i++) assert(r[i].kg > r[i - 1].kg);
  assert.deepEqual(r.at(-1).perSide, [25, 25, 10]); // 60 per side
  assert.deepEqual(Co.buildRamp(15, { bar: 20 }), []);
});

test('rampTarget: explicit load and non-barbell', () => {
  assert.equal(Co.rampTarget(row({ piece: 'Back squat', prescribed: '3×3 @ 120 kg' }), []), 120);
  assert.equal(Co.rampTarget(row({ piece: 'Sandbag carry', prescribed: '4×20m 60kg' }), []), null);
});

test('share text day and week', () => {
  const rows = [row({ actual: '100×5', rpe: '8', loggedAt: 'x' }), row({ piece: 'WOD', dayIdx: 2 })];
  const d = Co.shareText({ tab: 'Cycle 3', kind: 'day', rows, week: 1, dayIdx: 0 });
  assert(d.includes('Cycle 3') && d.includes('100×5') && d.includes('RPE 8') && d.includes('coachreactie'));
  const w = Co.shareText({ tab: 'Cycle 3', kind: 'week', rows, week: 1, dayIdx: 0 });
  assert(w.includes('Ma (week 1)') && w.includes('Wo (week 1)') && w.includes('(nog niet gelogd)') && w.includes('weekoverzicht'));
});

test('sessionDone needs every piece logged and one real result', () => {
  assert(!Co.sessionDone([row({ actual: 'x', loggedAt: 'y' }), row({ piece: 'b' })], 1, 0));
  assert(Co.sessionDone([row({ actual: 'x', loggedAt: 'y' }), row({ piece: 'b', actual: 'Skip', loggedAt: 'y' })], 1, 0));
  assert(!Co.sessionDone([row({ actual: 'Skip', loggedAt: 'y' })], 1, 0));
});

test('context pack: previous logged week, current week, next plan without results', () => {
  const rows = [row({ week: 1, actual: '100×5', loggedAt: 'y' }), row({ week: 2 }), row({ week: 3, prescribed: 'ramp' })];
  const c = Co.contextPack({ tab: 'Cycle 3', rows, week: 2, dayIdx: 0 });
  assert(c.includes('Vorige week') && c.includes('100×5') && c.includes('Week 2') && c.includes('Week 3 (plan)'));
});

test('cost, month rollover and limits', () => {
  assert.equal(Co.costUsd('claude-sonnet-5-5', { input_tokens: 1e6, output_tokens: 1e5 }), 3);
  const a = Co.addCost(null, 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 }, new Date(2026, 10, 3));
  const b = Co.addCost(a, 'claude-haiku-5-5', { input_tokens: 1000, output_tokens: 1000 }, new Date(2026, 10, 9));
  assert.equal(b.n, 2); assert(Math.abs(b.usd - 0.0012) < 1e-9);
  assert.equal(Co.addCost(b, 'claude-haiku-5-5', { input_tokens: 0, output_tokens: 0 }, new Date(2026, 11, 1)).n, 1);
  const now = new Date(2026, 10, 9);
  assert.equal(Co.limitState({ month: '2026-11', usd: 4.1 }, 5, now).state, 'warn');
  assert.equal(Co.limitState({ month: '2026-11', usd: 5 }, 5, now).state, 'over');
  assert.equal(Co.limitState({ month: '2026-10', usd: 50 }, 5, now).state, 'ok');
  assert.equal(Co.limitState(null, 0, now).state, 'none');
});

test('error mapping', () => {
  assert.equal(Co.mapError({ status: 400, message: 'Your credit balance is too low to access the Anthropic API.' }).kind, 'credits');
  assert.equal(Co.mapError({ status: 400, message: 'You have reached your specified workspace API usage limits.' }).kind, 'credits');
  assert.equal(Co.mapError({ status: 401, message: 'invalid x-api-key' }).kind, 'auth');
  assert.equal(Co.mapError({ status: 429 }).kind, 'rate');
  assert.equal(Co.mapError({ status: 529 }).kind, 'overloaded');
  assert.equal(Co.mapError({ status: 500 }).kind, 'overloaded');
  assert.equal(Co.mapError({ offline: true }).kind, 'offline');
  assert.equal(Co.mapError({ status: 400, message: 'prompt is too long' }).msg, 'prompt is too long');
  assert.equal(Co.mapError({ status: 418, message: 'teapot' }).kind, 'unknown');
  assert(Co.BLOCKING.has('credits') && !Co.BLOCKING.has('rate'));
});

test('callClaude: request shape, success, API error and network error', async () => {
  let seen;
  const ok = async (url, o) => { seen = { url, o }; return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hoi' }], usage: { input_tokens: 5, output_tokens: 2 } }) }; };
  const r = await Co.callClaude({ key: 'k', system: 's', messages: [{ role: 'user', content: 'x' }], fetchImpl: ok });
  assert.equal(r.text, 'hoi'); assert.equal(seen.url, Co.API_URL);
  assert.equal(seen.o.headers['x-api-key'], 'k'); assert.equal(seen.o.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(JSON.parse(seen.o.body).model, 'claude-sonnet-5-5');
  const bad = async () => ({ ok: false, status: 401, statusText: 'x', json: async () => ({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }) });
  await assert.rejects(() => Co.callClaude({ key: 'k', system: '', messages: [], fetchImpl: bad }), (e) => e.info.kind === 'auth');
  const off = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(() => Co.callClaude({ key: 'k', system: '', messages: [], fetchImpl: off }), (e) => e.info.kind === 'offline');
});

test('memory: parse, diff, normalize messages, md escaping', () => {
  assert.equal(Co.parseMemory('geen json'), null);
  const m = Co.parseMemory('Hier: [{"sectie":"Knie","inhoud":"voorstel: squat vrij"},{"sectie":"","inhoud":"x"}]');
  assert.deepEqual(m, [{ sectie: 'Knie', inhoud: 'voorstel: squat vrij' }]);
  assert.deepEqual(Co.memoryDiff([{ sectie: 'Knie', inhoud: 'a' }], [{ sectie: 'Knie', inhoud: 'b' }, { sectie: 'Nieuw', inhoud: 'c' }]).map((x) => x.status), ['gewijzigd', 'nieuw']);
  assert.deepEqual(Co.normalizeMessages([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }, { role: 'user', content: 'c' }]), [{ role: 'user', content: 'b\n\nc' }]);
  assert(!Co.md('<img src=x onerror=alert(1)> **vet**').includes('<img'));
  assert(Co.md('- a\n- b').includes('<li>a</li>'));
  assert.deepEqual(Co.parseTable([['Veld', 'Inhoud'], ['Doelen', 'x'], ['Leeg', '']], ['veld', 'inhoud']), [{ veld: 'Doelen', inhoud: 'x' }]);
});

test('system prompt follows language and embeds profile/memory/context', () => {
  const nl = Co.systemPrompt({ lang: 'nl', profile: [{ veld: 'Doelen', inhoud: 'Open' }], memory: [{ sectie: 'Knie', inhoud: 'ok' }], context: 'CTX' });
  assert(nl.includes('Nederlands') && nl.includes('Doelen: Open') && nl.includes('Knie: ok') && nl.includes('CTX'));
  assert(Co.systemPrompt({ lang: 'en' }).includes('Answer in English'));
});

test('fase 3: frame times, image note, images only on the last user message', () => {
  assert.deepEqual(Co.frameTimes(8, 4), [1, 3, 5, 7]);
  assert.deepEqual(Co.frameTimes(0, 4), [0]);
  const att = [{ kind: 'frame', t: 1, data: 'AAA' }, { kind: 'photo', data: 'BBB' }];
  const msgs = Co.withImages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'vraag' }], att);
  assert.equal(msgs[0].content, 'a');
  assert.equal(msgs[2].content.length, 3);
  assert.equal(msgs[2].content[0].source.data, 'AAA');
  assert(msgs[2].content[2].text.includes('1 frames') && msgs[2].content[2].text.includes('vraag'));
  assert.equal(Co.withImages([{ role: 'user', content: 'x' }], []).at(0).content, 'x');
});

test('fase 4: parse proposals, strip tags, ignore broken blocks', () => {
  const t = 'Doe lichter.\n<voorstel>[{"week":3,"dag":"Za","piece":"Back squat","prescribed":"3×3 @ 100 kg","reden":"knie"},{"week":3}]</voorstel>';
  const r = Co.parseProposals(t);
  assert.equal(r.text, 'Doe lichter.');
  assert.equal(r.proposals.length, 1);
  assert.equal(r.proposals[0].new, '3×3 @ 100 kg');
  assert.deepEqual(Co.parseProposals('x <voorstel>{kapot</voorstel>'), { text: 'x', proposals: [] });
});

test('fase 4: resolveProposal only accepts unlogged, existing, changed rows', () => {
  const rows = [row({ week: 3, dayIdx: 5, piece: "Back squat (20')", prescribed: '5×5', key: 'k', rowNum: 7 }), row({ week: 3, dayIdx: 5, piece: 'WOD', actual: '4:00', rowNum: 8 })];
  const p = { week: 3, dag: 'Za', piece: 'Back squat', new: '3×3', reason: '' };
  const ok = Co.resolveProposal(p, rows);
  assert.equal(ok.status, 'nieuw'); assert.equal(ok.rowNum, 7); assert.equal(ok.old, '5×5'); assert.equal(ok.piece, "Back squat (20')");
  assert.equal(Co.resolveProposal({ ...p, piece: 'WOD' }, rows).status, 'ongeldig');
  assert.equal(Co.resolveProposal({ ...p, piece: 'Yoga' }, rows).status, 'ongeldig');
  assert.equal(Co.resolveProposal({ ...p, new: '5×5' }, rows).status, 'ongeldig');
  assert.equal(Co.resolveProposal({ ...p, dag: 'Zo' }, rows).status, 'ongeldig');
});

test('prompt caching: system sent as cached block, cache tokens priced', async () => {
  let body;
  await Co.callClaude({ key: 'k', system: 'SYS', messages: [], fetchImpl: async (u, o) => { body = JSON.parse(o.body); return { ok: true, json: async () => ({ content: [], usage: {} }) }; } });
  assert.deepEqual(body.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
  // 1M cache reads on Sonnet cost 0.1 × $2
  assert(Math.abs(Co.costUsd('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }) - 0.2) < 1e-9);
  assert(Math.abs(Co.costUsd('claude-sonnet-5-5', { cache_creation_input_tokens: 1e6 }) - 2.5) < 1e-9);
});

test('coach log entry shape and proposal line', () => {
  const e = Co.logEntry({ soort: 'Weekoverzicht', over: 'W3', antwoord: 'x'.repeat(9000), props: [{ week: 3, dag: 'Za', piece: 'Back squat', old: '5×5', new: '3×3', status: 'toegepast', reason: 'knie' }], model: 'm', at: new Date(2026, 10, 18, 9, 5) });
  assert.equal(e.length, Co.LOG_HEADER.length);
  assert.equal(e[0], '2026-11-18 09:05'); assert.equal(e[4].length, 8000);
  assert.equal(e[5], 'W3 Za Back squat: 5×5 → 3×3 (toegepast) — knie');
});
