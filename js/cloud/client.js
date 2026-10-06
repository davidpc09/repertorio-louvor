// Cliente mínimo do Supabase (login + banco), sem bibliotecas externas.
// Usa as APIs REST oficiais: Auth (GoTrue) em /auth/v1 e banco (PostgREST) em /rest/v1.

import * as CFG from '../config.js';

const over = (typeof window !== 'undefined' && window.__REPERTORIO_CONFIG__) || {};
export const URL_BASE = (over.SUPABASE_URL ?? CFG.SUPABASE_URL ?? '').replace(/\/+$/, '');
export const KEY = over.SUPABASE_KEY ?? CFG.SUPABASE_KEY ?? '';
export const GOOGLE_LOGIN = over.GOOGLE_LOGIN ?? CFG.GOOGLE_LOGIN ?? false;
export const configured = !!(URL_BASE && KEY);

const SESSION_KEY = 'repertorio-louvor.auth';
let session = null;
let refreshing = null;
const authListeners = new Set();

export function appUrl() {
  const fixed = over.APP_URL ?? CFG.APP_URL;
  if (fixed) return fixed.replace(/#.*$/, '');
  return location.href.replace(/[#?].*$/, '');
}

export function onAuthChange(fn) { authListeners.add(fn); return () => authListeners.delete(fn); }
function emit() { authListeners.forEach((fn) => { try { fn(session); } catch (e) { console.error(e); } }); }

function save(s) {
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* ok */ }
}

export function getSession() {
  if (session) return session;
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { session = null; }
  return session;
}

export function currentAuthUser() { return getSession()?.user || null; }

function normalizeSession(data) {
  if (!data?.access_token) return null;
  const expiresAt = data.expires_at || Math.floor(Date.now() / 1000) + Number(data.expires_in || 3600);
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: expiresAt, user: data.user || null };
}

// ---------- Erros em português ----------
const MESSAGES = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/email not confirmed/i, 'Confirme seu e-mail pelo link que enviamos antes de entrar.'],
  [/user already registered|already been registered/i, 'Já existe uma conta com este e-mail. Use “Entrar” ou “Esqueci a senha”.'],
  [/password should be at least|weak password/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/rate limit|too many requests|over_email_send_rate_limit/i, 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.'],
  [/unable to validate email|invalid email/i, 'E-mail inválido.'],
  [/signups not allowed/i, 'O cadastro de novas contas está desligado no Supabase.'],
  [/same_password|should be different/i, 'A nova senha precisa ser diferente da atual.'],
  [/row-level security|permission denied|42501/i, 'Você não tem permissão para esta alteração.'],
  [/convite inválido ou vencido/i, 'Este convite é inválido ou já venceu. Peça um novo link ao administrador.'],
  [/failed to fetch|networkerror|load failed/i, 'Sem conexão com o servidor. Verifique a internet.'],
];

export function friendlyError(err) {
  const raw = typeof err === 'string' ? err : (err?.message || err?.msg || err?.error_description || err?.error || JSON.stringify(err));
  for (const [re, msg] of MESSAGES) if (re.test(raw)) return msg;
  return raw;
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.msg || body?.message || body?.error_description || body?.error || `Erro ${status}`);
    this.status = status;
    this.body = body;
    this.code = body?.code || body?.error_code;
  }
}

async function request(path, { method = 'GET', body, headers = {}, auth = true, retry = true } = {}) {
  const h = { apikey: KEY, ...headers };
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  if (auth) {
    const token = await accessToken();
    if (token) h.Authorization = 'Bearer ' + token;
  }
  let res;
  try {
    res = await fetch(URL_BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(0, { message: 'Failed to fetch' });
  }
  const text = await res.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }
  if (res.status === 401 && auth && retry && getSession()?.refresh_token) {
    const ok = await refresh(true);
    if (ok) return request(path, { method, body, headers, auth, retry: false });
  }
  if (!res.ok) throw new ApiError(res.status, data);
  return { data, res };
}

// ---------- Sessão ----------
async function accessToken() {
  const s = getSession();
  if (!s) return null;
  if (s.expires_at - 60 < Date.now() / 1000) await refresh();
  return getSession()?.access_token || null;
}

export function refresh(force = false) {
  const s = getSession();
  if (!s?.refresh_token) return Promise.resolve(false);
  if (!force && s.expires_at - 60 > Date.now() / 1000) return Promise.resolve(true);
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const { data } = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token }, auth: false });
      save(normalizeSession(data));
      return true;
    } catch (e) {
      // sem internet: mantém a sessão para abrir offline; token recusado: encerra
      if (e.status === 400 || e.status === 401 || e.status === 403) { save(null); emit(); }
      return false;
    } finally { refreshing = null; }
  })();
  return refreshing;
}

export async function signUp(email, password, nome) {
  const { data } = await request('/auth/v1/signup?redirect_to=' + encodeURIComponent(appUrl()), {
    method: 'POST', auth: false, body: { email, password, data: { nome } },
  });
  const s = normalizeSession(data);
  if (s) { save(s); emit(); return { session: s }; }
  return { needsConfirmation: true };
}

export async function signIn(email, password) {
  const { data } = await request('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email, password } });
  save(normalizeSession(data));
  emit();
  return session;
}

export async function signOut() {
  try { await request('/auth/v1/logout', { method: 'POST' }); } catch { /* ok */ }
  save(null);
  emit();
}

export async function resetPassword(email) {
  await request('/auth/v1/recover?redirect_to=' + encodeURIComponent(appUrl()), { method: 'POST', auth: false, body: { email } });
}

export async function resendConfirmation(email) {
  await request('/auth/v1/resend', { method: 'POST', auth: false, body: { type: 'signup', email, options: { email_redirect_to: appUrl() } } });
}

export async function updatePassword(password) {
  const { data } = await request('/auth/v1/user', { method: 'PUT', body: { password } });
  const s = getSession();
  if (s) save({ ...s, user: data });
}

export async function fetchUser() {
  const { data } = await request('/auth/v1/user');
  const s = getSession();
  if (s) save({ ...s, user: data });
  return data;
}

export function googleSignInUrl() {
  return `${URL_BASE}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(appUrl())}`;
}

/**
 * Trata o retorno dos links de e-mail (confirmação, redefinição de senha) e do login Google.
 * O Supabase devolve os dados no "#" do endereço: #access_token=...&type=recovery
 * Retorna { type, error } ou null quando não há nada para tratar.
 */
export async function handleAuthRedirect() {
  const hash = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error|error_description)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  history.replaceState(null, '', location.pathname + location.search + '#/');
  if (p.get('error') || p.get('error_description')) {
    return { error: friendlyError(p.get('error_description') || p.get('error')), type: p.get('type') };
  }
  const s = normalizeSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token'), expires_in: p.get('expires_in'), expires_at: Number(p.get('expires_at')) || undefined });
  save(s);
  try { await fetchUser(); } catch { /* ok */ }
  emit();
  return { type: p.get('type') || 'signin' };
}

// ---------- Banco (PostgREST) ----------
const enc = encodeURIComponent;
export const inList = (ids) => `in.(${ids.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(',')})`;

/** GET com paginação automática (o Supabase devolve no máximo 1000 linhas por vez). */
export async function select(table, query = '') {
  const out = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data } = await request(`/rest/v1/${table}?${query}${query ? '&' : ''}limit=${page}&offset=${from}`);
    out.push(...(data || []));
    if (!data || data.length < page) break;
  }
  return out;
}

export async function upsert(table, rows, onConflict = 'id') {
  if (!rows.length) return;
  await request(`/rest/v1/${table}?on_conflict=${enc(onConflict)}`, {
    method: 'POST', body: rows, headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}

export async function insert(table, rows) {
  if (!rows.length) return;
  await request(`/rest/v1/${table}`, { method: 'POST', body: rows, headers: { Prefer: 'return=minimal' } });
}

export async function update(table, filter, patch) {
  await request(`/rest/v1/${table}?${filter}`, { method: 'PATCH', body: patch, headers: { Prefer: 'return=minimal' } });
}

export async function remove(table, filter) {
  await request(`/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}

export async function rpc(fn, args = {}, { auth = true } = {}) {
  const { data } = await request(`/rest/v1/rpc/${fn}`, { method: 'POST', body: args, auth });
  return data;
}

export const eq = (v) => 'eq.' + enc(v);
