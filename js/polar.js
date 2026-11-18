// Optionele Polar-koppeling via je eigen Cloudflare Worker (zie polar-worker-v1.zip).
// Pure helpers (testbaar) + een kleine fetch-client. Niets hiervan draait zonder URL en code in ⚙.

export const configured = (s) => !!(s && String(s.polarUrl || '').trim() && String(s.polarKey || '').trim());
export const baseUrl = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/\/(mcp|sse|api)$/i, '');

export async function api(s, path, fetchImpl = fetch) {
  let r;
  try { r = await fetchImpl(baseUrl(s.polarUrl) + path, { headers: { 'X-App-Key': String(s.polarKey).trim() } }); }
  catch { throw new Error('Geen verbinding met je Polar-Worker (adres of netwerk?)'); }
  let j = null; try { j = await r.json(); } catch { /* geen json */ }
  if (!r.ok) throw new Error((j && j.error) || `Polar-fout ${r.status}`);
  return j;
}
export const ping = (s, f) => api(s, '/api/ping', f);
export const day = (s, date, f) => api(s, `/api/day?date=${encodeURIComponent(date)}`, f);

export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const hmMin = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? +m[1] * 60 + +m[2] : null; };
const startMin = (e) => { const m = /T(\d{2}):(\d{2})/.exec(e?.start || ''); return m ? +m[1] * 60 + +m[2] : null; };

/** Kies de training die het best overlapt met het sessievenster (±10 min speling). Zonder tijden: de langste. */
export function matchExercise(exs, sStart, sEnd, slack = 10) {
  const list = (exs || []).filter((e) => startMin(e) != null);
  if (!list.length) return null;
  const a = hmMin(sStart), b = hmMin(sEnd);
  if (a == null || b == null) return list.slice().sort((x, y) => (y.durationMin || 0) - (x.durationMin || 0))[0];
  let best = null, bestOv = 0;
  for (const e of list) {
    const s = startMin(e), t = s + (e.durationMin || 0);
    const ov = Math.min(t, b + slack) - Math.max(s, a - slack);
    if (ov > bestOv) { best = e; bestOv = ov; }
  }
  return best;
}

const dec = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString().replace('.', ',');
const hm = (min) => `${Math.floor(min / 60)}u${String(Math.round(min % 60)).padStart(2, '0')}`;

/** Eén regel voor de sheet-kolom `Polar`: herstel van die ochtend + de gekoppelde training. */
export function polarText(dayData, ex) {
  const parts = [];
  const r = dayData && dayData.recharge;
  if (r && r.status != null) parts.push(`Recharge ${r.status}/6`);
  if (r && r.ansCharge != null) parts.push(`ANS ${r.ansCharge > 0 ? '+' : ''}${dec(r.ansCharge)}`);
  if (r && r.hrv != null) parts.push(`HRV ${Math.round(r.hrv)}`);
  const s = dayData && dayData.sleep;
  if (s && s.score != null) parts.push(`Slaap ${s.score}${s.asleepMin ? ` (${hm(s.asleepMin)})` : ''}`);
  if (ex) {
    const t = [];
    if (ex.avgHr != null) t.push(`gem HR ${ex.avgHr}`);
    if (ex.maxHr != null) t.push(`max ${ex.maxHr}`);
    if (ex.cardioLoad != null) t.push(`load ${dec(ex.cardioLoad)}`);
    if (ex.rpe) t.push(`RPE ${ex.rpe}`);
    if (t.length) parts.push(`Training ${t.join(", ")}`);
  }
  return parts.join(' · ').slice(0, 220);
}

/**
 * Oordeel over het herstel van vandaag: 'ok' (groen), 'mid' (oranje), 'low' (rood). null zonder data.
 * Combineert Polar (Recharge, ANS, slaapscore) met je eigen readiness-antwoorden (tekst uit de sheet).
 */
export const LEVEL_LABEL = { ok: 'goed', mid: 'matig', low: 'laag' };
export function recoveryLevel(dayData, readyText = '') {
  const r = dayData && dayData.recharge, s = dayData && dayData.sleep;
  const red = [], orange = [];
  if (r && r.status != null) { if (r.status <= 2) red.push(`Recharge ${r.status}/6`); else if (r.status === 3) orange.push(`Recharge ${r.status}/6`); }
  if (r && r.ansStatus != null) { if (r.ansStatus <= 1) red.push('ANS ver onder je norm'); else if (r.ansStatus === 2) orange.push('ANS onder je norm'); }
  if (s && s.score != null) { if (s.score < 45) red.push(`slaapscore ${s.score}`); else if (s.score < 60) orange.push(`slaapscore ${s.score}`); }
  const t = String(readyText || '').toLowerCase();
  if (t.includes('spierpijn veel')) orange.push('veel spierpijn');
  if (t.includes('stress hoog')) orange.push('hoge stress');
  if (t.includes('slaap slecht') && !(s && s.score != null)) orange.push('slecht geslapen');
  const has = (r && (r.status != null || r.ansStatus != null)) || (s && s.score != null) || /slaap |spierpijn |stress /.test(t);
  if (!has) return null;
  const level = red.length || orange.length >= 2 ? 'low' : orange.length ? 'mid' : 'ok';
  return { level, label: LEVEL_LABEL[level], reasons: [...red, ...orange] };
}

/** Alleen het herstel (zonder training), voor de kaart bovenaan. */
export const recoveryText = (dayData) => polarText({ recharge: dayData && dayData.recharge, sleep: dayData && dayData.sleep }, null);

/** Slaapantwoord voor de readiness-check, uit de slaapscore van Polar. null = geen data van deze nacht. */
export function sleepAnswer(dayData) {
  const s = dayData && dayData.sleep;
  if (!s || s.score == null) return null;
  return s.score >= 70 ? 'Goed' : s.score >= 50 ? 'Ok' : 'Slecht';
}

/** Eén woord per tegel: laag/normaal/hoog (vaste schaal) of lager/normaal/beter (t.o.v. jouw eigen gemiddelde). */
export function tileWords(dayData) {
  const r = (dayData && dayData.recharge) || {}, s = (dayData && dayData.sleep) || {};
  const out = { recharge: null, ans: null, hrv: null, sleep: null };
  if (r.status != null) out.recharge = r.status <= 3 ? 'laag' : r.status === 4 ? 'normaal' : 'hoog';
  if (r.ansStatus != null) out.ans = { 1: 'veel lager', 2: 'lager', 3: 'normaal', 4: 'beter', 5: 'veel beter' }[r.ansStatus] || null;
  const b = r.hrvBaseline;
  if (r.hrv != null && b && b.avg > 0 && b.n >= 3) { const q = r.hrv / b.avg; out.hrv = q <= 0.9 ? 'lager' : q >= 1.1 ? 'beter' : 'normaal'; }
  if (s.score != null) out.sleep = s.score < 60 ? 'laag' : s.score < 80 ? 'normaal' : 'hoog';
  return out;
}

export const HELP = [
  ['Recharge', 'Hoe goed je lichaam vannacht heeft hersteld, van 1 (slecht) tot 6 (heel goed). Woord: laag, normaal of hoog.'],
  ['ANS charge', 'Hoe je zenuwstelsel hersteld is, vergeleken met jouw eigen gemiddelde van de laatste weken. 0 is je normaal, plus is beter, min is lager. Woord: lager, normaal of beter dan jouw gewoonte.'],
  ['HRV', 'Hoeveel de tijd tussen je hartslagen schommelt. Hoger is meestal beter hersteld. Het getal zegt alleen iets vergeleken met je eigen gemiddelde van de nachten ervoor. Woord: lager, normaal of beter dan dat gemiddelde.'],
  ['Slaap', 'De slaapscore van Polar (0–100) en hoeveel uur je sliep. Woord: laag onder 60, hoog vanaf 80.'],
  ['Kleur', 'Groen: geen aandachtspunten. Oranje: één aandachtspunt. Rood: een duidelijk slecht cijfer of twee aandachtspunten. Je eigen antwoorden (spierpijn, stress) tellen mee.'],
];
