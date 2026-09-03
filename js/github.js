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

function authHeaders() {
  const headers = { Accept: 'application/vnd.github+json' };
  const token = getToken();
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

// Reads through the GitHub API so we get the file's current sha, needed to
// write an update.
export async function fetchViaApi() {
  const url = `${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}?ref=${CONFIG.branch}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) throw new Error(`api-read-failed:${res.status}`);
  const json = await res.json();
  return { data: JSON.parse(b64ToUtf8(json.content)), sha: json.sha };
}

export async function verifyToken() {
  if (!hasToken()) return false;
  const res = await fetch(`${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}`, { headers: authHeaders() });
  return res.ok;
}

export async function saveState(data, message) {
  if (!hasToken()) throw new Error('no-token');
  const { sha } = await fetchViaApi();
  const res = await fetch(`${API_BASE}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dataPath}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: message || 'Update Silk Road trade data',
      content: utf8ToB64(JSON.stringify(data, null, 2)),
      sha,
      branch: CONFIG.branch,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`save-failed:${res.status}:${err.message || ''}`);
  }
  return res.json();
}
