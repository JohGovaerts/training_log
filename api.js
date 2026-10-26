// Google sign-in (Identity Services token flow) + minimal Sheets v4 client.
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_KEY = 'logapp.token';

export class AuthError extends Error {}
export class NetError extends Error {}
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function readTok() {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY));
    return t && t.exp > Date.now() + 60000 ? t : null;
  } catch { return null; }
}
export const tokenValid = () => !!readTok();

let gsi = null;
export function loadGsi() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gsi ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gsi = null; reject(new NetError('Google-login kon niet laden (offline?)')); };
    document.head.appendChild(s);
  });
  return gsi;
}

// Call from a click handler. If GIS is already loaded the popup opens synchronously (Safari needs that).
export async function signIn(clientId, { prompt } = {}) {
  if (!window.google?.accounts?.oauth2) await loadGsi();
  return new Promise((resolve, reject) => {
    const tc = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new AuthError(r.error_description || r.error));
        localStorage.setItem(TOKEN_KEY, JSON.stringify({ t: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 }));
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new AuthError(e?.type || 'popup_closed')),
    });
    tc.requestAccessToken(prompt === undefined ? {} : { prompt });
  });
}

export function signOut() {
  const t = readTok();
  try { if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.t, () => {}); } catch {}
  localStorage.removeItem(TOKEN_KEY);
}

async function call(url, opts = {}) {
  const t = readTok();
  if (!t) throw new AuthError('Niet ingelogd');
  let r;
  try {
    r = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${t.t}`, 'Content-Type': 'application/json' } });
  } catch (e) { throw new NetError(e.message || 'Geen verbinding'); }
  if (r.status === 401) { localStorage.removeItem(TOKEN_KEY); throw new AuthError('Sessie verlopen'); }
  if (!r.ok) {
    let m = '';
    try { m = (await r.json()).error?.message; } catch {}
    throw new ApiError(r.status, m || r.statusText);
  }
  return r.json();
}

export function parseSheetId(s) {
  s = String(s || '').trim();
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(s);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
}

const quote = (tab) => `'${String(tab).replace(/'/g, "''")}'`;

export async function getMeta(id) {
  const j = await call(`${SHEETS}/${id}?fields=properties.title,sheets.properties(sheetId,title)`);
  return { title: j.properties?.title || '', tabs: (j.sheets || []).map((s) => s.properties.title) };
}

export async function getValues(id, tab) {
  const j = await call(`${SHEETS}/${id}/values/${encodeURIComponent(quote(tab))}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
  return j.values || [];
}

export async function batchUpdate(id, data) {
  if (!data.length) return;
  await call(`${SHEETS}/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
}
