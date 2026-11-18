// Coach: pure logic (prompt, context pack, ramp, share text, cost, error mapping) + one fetch to the Anthropic API.
// Nothing here touches the DOM or localStorage, so it is easy to test.
import * as Ld from './loading.js';
import * as Sh from './sheet.js';

export const RULES_VERSION = 3;
export const MODELS = {
  'claude-sonnet-5-5': { label: 'Sonnet 5.5 (aanbevolen)', inUsd: 2, outUsd: 10 },
  'claude-haiku-5-5': { label: 'Haiku 5.5 (goedkoper)', inUsd: 0.1, outUsd: 0.5 },
};
export const API_URL = 'https://api.anthropic.com/v1/messages';
export const COACH_TABS = { profile: 'Coach profiel', memory: 'Coach geheugen', log: 'Coach log' };
export const LOG_HEADER = ['Datum', 'Soort', 'Over', 'Vraag', 'Antwoord', 'Voorstellen', 'Model'];
export const PROFILE_FIELDS = [
  ['Atleet', 'Leeftijd, gewicht, ervaring, werk/dagritme'],
  ['Doelen', 'Waar werk je naartoe? Wedstrijden?'],
  ['Blessures & gezondheid', 'Wat moet de coach weten? Vrijgave door fysio/arts? Zwanger? Zet uitgerekende datum erbij (dd-mm-jjjj).'],
  ['Tijd & schema', 'Trainingsdagen en tijd per sessie'],
  ['Materiaal', 'Wat is er beschikbaar?'],
  ['Voorkeuren', 'Wat vind je leuk, hoe wil je dat de coach communiceert?'],
];

// ---------- prompt ----------
export function systemPrompt({ lang = 'nl', profile = [], memory = [], context = '' } = {}) {
  const nl = lang !== 'en';
  const rules = nl ? [
    'Je bent een OPEX-geïnspireerde trainingscoach in de Training Log-app van één atleet. Je coacht langetermijn: elke cyclus is een stap in een doorlopende progressie.',
    'Antwoord in het Nederlands, kort en leesbaar op een telefoon: eerst het antwoord, dan het waarom in één of twee zinnen. Gebruik kg.',
    'Veiligheid en gezondheid gaan altijd voor ambitie. Wijzig nooit zelf een vrijgave (fysio/arts); bij nieuwe pijn: vraag welke beweging, welk soort pijn, tijdens of erna, en stel een alternatief voor.',
    'Een slechte dag, ziekte, drukke week of "vervangen door les" is nooit een reden om af te schalen. Resultaten onder slechte omstandigheden zijn een ondergrens.',
    'Verzin geen cijfers. Gebruik alleen wat in de context staat; mis je iets, vraag het of zeg het.',
    'Na een sessie: wat ging goed, één aandachtspunt, en welke aanpassing je voorstelt (of "geen aanpassing"). Voorstellen voor het programma zijn voorstellen: de atleet beslist, jij past niets zelf aan.',
    'Bij uitleg over oefeningen of opbouw (ramps): concreet, met sets × reps en percentages of RPE, en maximaal één cue per fout.',
    'Bij foto\'s of frames uit een video: je ziet geen snelheid of timing, alleen posities; zeg dat eerlijk. Geef één belangrijkste fout en één cue, bevestig of de standaard gehaald is, en vraag zo nodig een betere hoek of slow-motion.',
    'Zwangerschap (staat in profiel of geheugen)? Dan gaat dit voor al het andere: de uitspraak van arts/vroedvrouw gaat voor het programma, geen maximale pogingen of PR\'s, stuur op RPE (zelf 2–3 reps in reserve), minder val-/impactrisico, geen zware buikbelasting, geen oververhitting. Bereken de zwangerschapsweek uit de uitgerekende datum en de datum van vandaag. Bij bloedverlies, vochtverlies, regelmatige pijnlijke weeën, pijn op de borst, ernstige hoofdpijn, duizeligheid of minder kindsbewegingen: meteen stoppen en arts/vroedvrouw bellen. Geen calorie- of gewichtsadvies. Verwijs voor de volledige zwangerschapsplanning naar het coach-project.',
    'Wil je het plan van een nog niet gelogd onderdeel wijzigen? Zet NA je uitleg een blok <voorstel>[{"week":3,"dag":"Za","piece":"exacte pieceNaam uit de context","prescribed":"nieuwe tekst","reden":"korte reden"}]</voorstel>. Alleen voor onderdelen die "(nog niet gelogd)" zijn, nooit voor vrijgaves, en alleen als het echt nodig is. De atleet keurt elk voorstel goed of af.',
  ] : [
    'You are an OPEX-inspired training coach inside one athlete\'s Training Log app. You coach long term: every cycle is a step in a continuous progression.',
    'Answer in English, short and readable on a phone: answer first, then the why in one or two sentences. Use kg.',
    'Health and safety always come before ambition. Never change a clearance (physio/doctor) yourself; for new pain ask which movement, what kind, during or after, and suggest an alternative.',
    'A bad day, illness, a busy week or "replaced by class" is never a reason to scale down. Results under poor conditions are a lower bound.',
    'Do not invent numbers. Use only what is in the context; if something is missing, ask or say so.',
    'After a session: what went well, one point of attention, and which adjustment you propose (or "no adjustment"). Programme changes are proposals: the athlete decides, you change nothing yourself.',
    'When explaining exercises or build-ups (ramps): be concrete, with sets × reps and percentages or RPE, and at most one cue per fault.',
    'For photos or video frames: you see positions, not speed or timing, and you say so. Give the single most important fault and one cue, confirm whether the standard was met, and ask for a better angle or slow motion if needed.',
    'Pregnancy (in profile or memory)? That overrides everything else: the doctor/midwife\'s advice beats the programme, no maximal attempts or PRs, steer on RPE (2–3 reps in reserve), less fall/impact risk, no heavy abdominal loading, avoid overheating. Compute the week of pregnancy from the due date and today\'s date. With bleeding, fluid leakage, regular painful contractions, chest pain, severe headache, dizziness or reduced fetal movement: stop at once and call the doctor/midwife. No calorie or weight advice. Refer to the coach project for full pregnancy planning.',
    'To change the plan of a piece that is not logged yet, put AFTER your explanation a block <voorstel>[{"week":3,"dag":"Za","piece":"exact piece name from the context","prescribed":"new text","reden":"short reason"}]</voorstel>. Only for pieces marked "(nog niet gelogd)", never for clearances, and only when really needed. The athlete approves or rejects every proposal.',
  ];
  const prof = profile.filter((p) => p.inhoud).map((p) => `- ${p.veld}: ${p.inhoud}`).join('\n');
  const mem = memory.filter((m) => m.inhoud).map((m) => `- ${m.sectie}: ${m.inhoud}`).join('\n');
  return [
    rules.join('\n'),
    `${nl ? 'Regelversie' : 'Rules version'}: ${RULES_VERSION}`,
    `${nl ? 'Vandaag' : 'Today'}: ${new Date().toISOString().slice(0, 10)}`,
    `## ${nl ? 'Profiel van de atleet' : 'Athlete profile'}\n${prof || (nl ? '(nog niet ingevuld)' : '(not filled in yet)')}`,
    `## ${nl ? 'Coachgeheugen' : 'Coach memory'}\n${mem || (nl ? '(nog leeg)' : '(empty)')}`,
    context ? `## ${nl ? 'Huidige cyclus' : 'Current cycle'}\n${context}` : '',
  ].filter(Boolean).join('\n\n');
}

// ---------- context pack ----------
const clip = (s, n = 160) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const DAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];
const logged = (r) => !!(r.actual || r.loggedAt);

export function pieceLine(r, { plan = true } = {}) {
  const res = [r.actual && `resultaat: ${clip(r.actual, 120)}`, r.splits && `splits: ${clip(r.splits, 60)}`, r.rpe && `RPE ${r.rpe}`,
    r.badDay && /^(ja|misschien)$/i.test(r.badDay) && `slechte dag: ${r.badDay}`, r.pain && `pijn: ${clip(r.pain, 80)}`, r.notes && `notitie: ${clip(r.notes, 100)}`].filter(Boolean);
  const head = `${r.piece}${plan && r.prescribed ? ` — plan: ${clip(r.prescribed, 120)}` : ''}`;
  return `- ${head}${res.length ? ` → ${res.join('; ')}` : logged(r) ? '' : ' → (nog niet gelogd)'}`;
}

function dayBlock(rows, week, dayIdx, opts) {
  const rs = rows.filter((r) => r.week === week && r.dayIdx === dayIdx);
  if (!rs.length) return '';
  const ready = (rs.find((r) => r.readiness) || {}).readiness;
  const polar = (rs.find((r) => r.polar) || {}).polar;
  return `${DAYS[dayIdx]} (week ${week}) — ${clip(rs[0].focus, 60)}${ready ? `\nReadiness bij start: ${clip(ready, 80)}` : ''}${polar ? `\nPolar: ${clip(polar, 160)}` : ''}\n${rs.map((r) => pieceLine(r, opts)).join('\n')}`;
}

export function sessionSummary(rows, week, dayIdx) { return dayBlock(rows, week, dayIdx, { plan: true }); }

export function weekSummary(rows, week) {
  const days = [...new Set(rows.filter((r) => r.week === week).map((r) => r.dayIdx))].sort((a, b) => a - b);
  return days.map((d) => dayBlock(rows, week, d, { plan: true })).join('\n\n');
}

export function contextPack({ tab = '', rows = [], week = 1, dayIdx = 0 } = {}) {
  const parts = [`Tabblad: ${tab}. Nu: week ${week}, ${DAYS[dayIdx] || ''}.`];
  const prev = rows.filter((r) => r.week === week - 1 && logged(r));
  if (prev.length) parts.push(`### Vorige week (gelogd)\n${weekSummary(prev, week - 1)}`);
  const cur = weekSummary(rows, week);
  if (cur) parts.push(`### Week ${week}\n${cur}`);
  const next = rows.filter((r) => r.week === week + 1);
  if (next.length) parts.push(`### Week ${week + 1} (plan)\n${weekSummary(next.map((r) => ({ ...r, actual: '', rpe: '', pain: '', notes: '', splits: '' })), week + 1).split('\n').slice(0, 24).join('\n')}`);
  return parts.join('\n\n');
}

export const sessionDone = (rows, week, dayIdx) => {
  const rs = rows.filter((r) => r.week === week && r.dayIdx === dayIdx);
  return rs.length > 0 && rs.every(logged) && rs.some((r) => r.actual && !/^skip/i.test(r.actual));
};

// ---------- share text (Fase 1: no key needed) ----------
export function shareText({ tab, kind = 'day', rows, week, dayIdx }) {
  const body = kind === 'week' ? weekSummary(rows, week) : sessionSummary(rows, week, dayIdx);
  const ask = kind === 'week'
    ? 'Maak een weekoverzicht: wat ging goed, aandachtspunten, en wat stel je voor voor volgende week?'
    : 'Geef me je coachreactie op deze sessie: wat ging goed, één aandachtspunt, en welke aanpassing stel je voor?';
  return `Training Log — ${tab}\n\n${body}\n\n${ask}`;
}

// ---------- ramp (Fase 1) ----------
export const RAMP_STEPS = [[0, 8, 'lege stang'], [0.4, 5], [0.55, 3], [0.7, 3], [0.8, 2], [0.9, 1]];
export function buildRamp(targetKg, { bar = 20, avail } = {}) {
  if (!(targetKg > bar)) return [];
  const out = [];
  for (const [p, reps, label] of RAMP_STEPS) {
    const kg = p === 0 ? bar : Math.max(bar, Ld.roundTo(targetKg * p, 2.5));
    if (out.length && kg <= out[out.length - 1].kg) continue;
    if (kg >= targetKg) continue;
    out.push({ pct: Math.round(p * 100), reps, kg, label, ...Ld.plates(kg, bar, avail) });
  }
  out.push({ pct: 100, reps: 0, kg: targetKg, label: 'top', ...Ld.plates(targetKg, bar, avail) });
  return out;
}
export function rampTarget(it, rows, { bar = 20 } = {}) {
  if (!Ld.isBarbell(it.piece)) return null;
  const cs = Ld.calcsFor(it, rows, { bar }).filter((c) => !c.missing);
  if (cs.length) return Math.max(...cs.map((c) => c.target));
  const ls = Ld.findLoads(it.prescribed).filter((kg) => kg > bar);
  return ls.length ? Math.max(...ls) : null;
}

// ---------- cost & errors ----------
export const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export function costUsd(model, usage = {}) {
  const m = MODELS[model] || MODELS['claude-sonnet-5-5'];
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return (inTok * m.inUsd + (usage.output_tokens || 0) * m.outUsd) / 1e6;
}
export function addCost(cost, model, usage, now = new Date()) {
  const mk = monthKey(now);
  const c = cost && cost.month === mk ? cost : { month: mk, usd: 0, n: 0, tin: 0, tout: 0 };
  return { month: mk, usd: c.usd + costUsd(model, usage), n: c.n + 1, tin: c.tin + (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0), tout: c.tout + (usage.output_tokens || 0) };
}
export function limitState(cost, limitUsd, now = new Date()) {
  const used = cost && cost.month === monthKey(now) ? cost.usd : 0;
  if (!(limitUsd > 0)) return { used, state: 'none', pct: 0 };
  const pct = used / limitUsd;
  return { used, pct, state: pct >= 1 ? 'over' : pct >= 0.8 ? 'warn' : 'ok' };
}
export const fmtUsd = (n) => `$${(n || 0).toFixed(n >= 1 ? 2 : 3)}`;

// kind: credits | auth | rate | overloaded | offline | applimit | bad | unknown
export function mapError({ status = 0, message = '', type = '', offline = false } = {}) {
  const m = String(message || '');
  if (offline) return { kind: 'offline', title: 'Geen verbinding', msg: 'De coach heeft internet nodig. Loggen, records en de ramp-calculator werken gewoon door.' };
  if (/credit balance|billing|usage limit|spend limit|spending limit|monthly limit|workspace.*limit/i.test(m) || (status === 400 && /credit/i.test(m))) {
    return { kind: 'credits', title: 'Coach pauzeert: tegoed of limiet bereikt', msg: 'Je Anthropic-tegoed is op of je maandelijkse bestedingslimiet is bereikt. Laad op of verhoog de limiet in console.anthropic.com → Billing; daarna werkt de coach meteen weer.' };
  }
  if (status === 401 || type === 'authentication_error') return { kind: 'auth', title: 'API-sleutel ongeldig', msg: 'Anthropic accepteert deze sleutel niet (ingetrokken of verkeerd gekopieerd). Maak een nieuwe aan in de Console en plak hem in ⚙ Instellingen.' };
  if (status === 403) return { kind: 'auth', title: 'Geen toegang', msg: m ? `Anthropic weigert de aanvraag: ${m}` : 'Deze sleutel mag dit model of deze workspace niet gebruiken.' };
  if (status === 429 || type === 'rate_limit_error') return { kind: 'rate', title: 'Even te veel aanvragen', msg: 'Je zit aan de snelheidslimiet. Probeer het over een minuut opnieuw.' };
  if (status === 529 || status >= 500 || type === 'overloaded_error') return { kind: 'overloaded', title: 'Anthropic is druk', msg: 'De dienst is tijdelijk overbelast of onbereikbaar. Probeer het zo opnieuw; je logs zijn niet verloren.' };
  if (status === 400 || status === 413) return { kind: 'bad', title: 'Aanvraag geweigerd', msg: m || 'De aanvraag was te groot of ongeldig.' };
  return { kind: 'unknown', title: 'Onverwachte fout', msg: m || `Status ${status || '?'}` };
}
export const BLOCKING = new Set(['credits', 'auth', 'applimit']);

// ---------- API ----------
export class CoachError extends Error { constructor(info) { super(info.msg); this.info = info; } }

export async function callClaude({ key, model = 'claude-sonnet-5-5', system, messages, maxTokens = 900, fetchImpl }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  let r;
  try {
    r = await f(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: system ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system, messages }),
    });
  } catch (e) {
    throw new CoachError(mapError({ offline: true, message: e.message }));
  }
  let j = null;
  try { j = await r.json(); } catch { /* non-JSON error page */ }
  if (!r.ok) throw new CoachError(mapError({ status: r.status, message: j?.error?.message || r.statusText, type: j?.error?.type }));
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
  return { text, usage: j.usage || {}, stop: j.stop_reason };
}

// ---------- memory proposal ----------
export function memoryPrompt({ memory = [], reply = '', lang = 'nl' }) {
  const cur = memory.map((m) => `- ${m.sectie}: ${m.inhoud}`).join('\n') || '(leeg)';
  return `Hieronder staat het huidige coachgeheugen en je laatste analyse. Stel een bijgewerkt geheugen voor: korte, duurzame feiten (max 12 secties, elk max 500 tekens), geen dagcijfers die snel verouderen, geen verzonnen informatie. Wijzigingen aan vrijgaves/blessures neem je op als "voorstel: …" zodat de atleet ze bevestigt.\n\nHuidig geheugen:\n${cur}\n\nLaatste analyse:\n${reply}\n\nAntwoord ALLEEN met JSON: [{"sectie":"…","inhoud":"…"}]${lang === 'en' ? ' (content in English)' : ' (inhoud in het Nederlands)'}.`;
}
export function parseMemory(text) {
  const m = /\[[\s\S]*\]/.exec(String(text || '')); if (!m) return null;
  try {
    const a = JSON.parse(m[0]);
    if (!Array.isArray(a)) return null;
    const out = a.filter((x) => x && typeof x.sectie === 'string' && typeof x.inhoud === 'string' && x.sectie.trim() && x.inhoud.trim())
      .slice(0, 12).map((x) => ({ sectie: x.sectie.trim().slice(0, 60), inhoud: x.inhoud.trim().slice(0, 600) }));
    return out.length ? out : null;
  } catch { return null; }
}
export const memoryDiff = (oldM, newM) => {
  const o = new Map(oldM.map((m) => [m.sectie, m.inhoud]));
  return newM.map((m) => ({ ...m, status: !o.has(m.sectie) ? 'nieuw' : o.get(m.sectie) === m.inhoud ? 'gelijk' : 'gewijzigd' }));
};

// ---------- tiny markdown (escape first, then **bold**, lists, line breaks) ----------
const escH = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function md(text) {
  const lines = escH(text).split(/\r?\n/);
  const out = []; let list = false;
  for (const raw of lines) {
    const line = raw.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/, '<b>$1</b>');
    const li = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (li) { if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${li[1]}</li>`); continue; }
    if (list) { out.push('</ul>'); list = false; }
    out.push(line.trim() ? `<p>${line}</p>` : '');
  }
  if (list) out.push('</ul>');
  return out.join('');
}

// The API wants strictly alternating turns that start with "user".
export function normalizeMessages(msgs) {
  const out = [];
  for (const m of msgs) {
    if (!m || !m.content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += `\n\n${m.content}`;
    else out.push({ role: m.role, content: m.content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export function parseTable(values, cols) {
  return (values || []).slice(1).map((r) => cols.reduce((o, k, i) => ({ ...o, [k]: String(r[i] ?? '').trim() }), {})).filter((o) => Object.values(o)[1]);
}

// ---------- Fase 3: images / video frames ----------
export const MAX_IMAGES = 10;
export function frameTimes(duration, n = 8) {
  if (!(duration > 0)) return [0];
  return Array.from({ length: n }, (_, i) => Math.round(((i + 0.5) / n) * duration * 100) / 100);
}
export function imageNote(att) {
  const frames = att.filter((a) => a.kind === 'frame');
  const photos = att.filter((a) => a.kind === 'photo').length;
  const parts = [];
  if (photos) parts.push(`${photos} foto(\'s)`);
  if (frames.length) parts.push(`${frames.length} frames uit een video op t = ${frames.map((f) => `${f.t}s`).join(', ')} (je ziet geen snelheid, enkel posities)`);
  return `[Bijlagen: ${parts.join(' en ')}]`;
}
// Put the images in front of the text of the LAST user message only (history stays text-only, so it stays cheap).
export function withImages(messages, att) {
  if (!att || !att.length) return messages;
  const out = messages.map((m) => ({ ...m }));
  const last = out[out.length - 1];
  last.content = [...att.map((a) => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: a.data } })), { type: 'text', text: `${imageNote(att)}\n\n${last.content}` }];
  return out;
}

// ---------- Fase 4: proposals to change Prescribed ----------
export function parseProposals(text) {
  const re = /<voorstel>([\s\S]*?)<\/voorstel>/gi;
  let props = [];
  const clean = String(text || '').replace(re, (_, body) => {
    try { const a = JSON.parse(body); if (Array.isArray(a)) props = props.concat(a); } catch { /* ignore a broken block */ }
    return '';
  }).replace(/<\/?voorstel>/gi, '').trim();
  props = props.filter((p) => p && p.week != null && p.dag && p.piece && typeof p.prescribed === 'string' && p.prescribed.trim()).slice(0, 6)
    .map((p) => ({ week: +p.week, dag: String(p.dag), piece: String(p.piece), new: p.prescribed.trim(), reason: String(p.reden || p.reason || '') }));
  return { text: clean, proposals: props };
}
// Find the row a proposal is about. Only rows that are not logged can be changed.
export function resolveProposal(p, rows) {
  const di = Sh.dayIndex(p.dag);
  const same = rows.filter((r) => r.week === p.week && r.dayIdx === di);
  const norm = (x) => String(x).toLowerCase().replace(/\s+/g, ' ').trim();
  const row = same.find((r) => norm(r.piece) === norm(p.piece)) || same.find((r) => norm(r.piece).includes(norm(p.piece)) || norm(p.piece).includes(norm(r.piece)));
  if (!row) return { ...p, status: 'ongeldig', why: 'Onderdeel niet gevonden in de planning.' };
  if (row.actual || row.loggedAt) return { ...p, status: 'ongeldig', why: 'Dit onderdeel is al gelogd; het plan wordt niet meer aangepast.' };
  if (row.prescribed.trim() === p.new) return { ...p, status: 'ongeldig', why: 'Staat al zo in de planning.' };
  return { ...p, piece: row.piece, key: row.key, rowNum: row.rowNum, old: row.prescribed, status: 'nieuw' };
}

// ---------- Coach log (one row per reaction / overview / applied change; the Project can read this tab) ----------
const p2 = (n) => String(n).padStart(2, '0');
export const stamp = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
export function propLine(p) { return `W${p.week} ${p.dag} ${p.piece}: ${p.old ?? '?'} → ${p.new}${p.status && p.status !== 'nieuw' ? ` (${p.status})` : ''}${p.reason ? ` — ${p.reason}` : ''}`; }
export function logEntry({ soort, over = '', vraag = '', antwoord = '', props = [], model = '', at = new Date() }) {
  return [stamp(at), soort, over, String(vraag).slice(0, 300), String(antwoord).slice(0, 8000), props.map(propLine).join('\n'), model];
}
