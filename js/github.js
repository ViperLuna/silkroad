import { CONFIG } from './config.js';

const API_BASE = 'https://api.github.com';

export function getToken() {
  return localStorage.getItem(CONFIG.tokenStorageKey) || '';
}

export function setToken(token) {
  if (token) localStorage.setItem(CONFIG.tokenStorageKey, token);
  else localStorage.removeItem(CONFIG.tokenStorageKey);
}

export function hasToken() {
  return !!getToken();
}

function authHeaders(tokenOverride) {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = tokenOverride !== undefined ? tokenOverride : getToken();
  if (token) headers.Authorization = `token ${token}`;
  return headers;
}

function b64ToUtf8(b64) {
  return decodeURIComponent(escape(atob(b64)));
}

function utf8ToB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

// Reads straight from the deployed site — no auth needed, works before a
// token is ever configured.
export async function fetchPublicData() {
  const res = await fetch(`./${CONFIG.dataPath}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('public-fetch-failed');
  return res.json();
}

// The most recently confirmed sha for data/db.json — from either a GET or
// a successful write. Saves prefer this over a fresh GET (see saveState)
// because GitHub's read path can lag a moment behind a write it just
// accepted, so a GET fired right after a save can still return the
// version that write just replaced.
let knownSha = null;

// Reads through the GitHub API so we get the file's current sha, needed to
// write an update.
export async function fetchViaApi() {
  const url = `${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}?ref=${CONFIG.branch}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`api-read-failed:${res.status}`);
  const json = await res.json();
  knownSha = json.sha;
  return { data: JSON.parse(b64ToUtf8(json.content)), sha: json.sha };
}

// Checks a token against the repo without requiring it to be saved first,
// so a candidate token can be verified before it's ever written to storage.
export async function verifyToken(tokenOverride) {
  const token = tokenOverride !== undefined ? tokenOverride : getToken();
  if (!token) return false;
  const res = await fetch(`${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}`, { headers: authHeaders(token) });
  return res.ok;
}

async function putContents(data, message, sha) {
  return fetch(`${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || 'Update Silk Road trade data',
      content: utf8ToB64(JSON.stringify(data, null, 2)),
      sha,
      branch: CONFIG.branch,
    }),
  });
}

// GitHub requires the file's current version ("sha") on every write, and
// rejects the write (409/422) if that sha is stale by the time the request
// lands. The first attempt uses `knownSha` (from the last successful
// read/write) instead of firing a fresh GET, since GitHub's read path can
// briefly lag behind a write it just accepted — a GET fired moments after
// a save can return the very version that save just replaced. Only on an
// actual conflict (which does mean something genuinely else touched the
// file — e.g. this app open in another tab/device) does it fall back to a
// real GET, retrying a few times with backoff.
const MAX_SAVE_ATTEMPTS = 4;

export async function saveState(data, message) {
  if (!hasToken()) throw new Error('no-token');
  if (!knownSha) await fetchViaApi();
  let res = await putContents(data, message, knownSha);
  for (let attempt = 2; !res.ok && (res.status === 409 || res.status === 422) && attempt <= MAX_SAVE_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, 300 * (attempt - 1)));
    await fetchViaApi();
    res = await putContents(data, message, knownSha);
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`save-failed:${res.status}:${err.message || ''}`);
  }
  const json = await res.json();
  knownSha = json.content.sha;
  return json;
}
