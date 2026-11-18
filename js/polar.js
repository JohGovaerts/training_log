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

/** Zacht oordeel over het herstel van die ochtend. Alleen 'low' of 'ok'; null zonder data. */
export function recoveryLevel(dayData) {
  const r = dayData && dayData.recharge, s = dayData && dayData.sleep;
  const reasons = [];
  if (r && r.status != null && r.status <= 3) reasons.push(`Recharge ${r.status}/6`);
  if (r && r.ansStatus != null && r.ansStatus <= 2) reasons.push('ANS ver onder je norm');
  if (s && s.score != null && s.score < 50) reasons.push(`slaapscore ${s.score}`);
  const has = (r && (r.status != null || r.ansStatus != null)) || (s && s.score != null);
  if (!has) return null;
  return { level: reasons.length ? 'low' : 'ok', reasons };
}

/** Alleen het herstel (zonder training), voor de kaart bovenaan. */
export const recoveryText = (dayData) => polarText({ recharge: dayData && dayData.recharge, sleep: dayData && dayData.sleep }, null);
