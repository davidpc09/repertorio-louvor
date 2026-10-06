// Sincronização com o Supabase.
//
// O app continua trabalhando com o mesmo "estado" em memória do modo demonstração.
// Este módulo:
//   • puxa do servidor tudo o que a pessoa pode ver (só os ministérios dela);
//   • depois de cada alteração local, envia ao servidor apenas o que mudou;
//   • guarda uma cópia no aparelho para abrir sem internet e reenviar depois;
//   • a cada poucos segundos busca alterações feitas por outras pessoas.
// Cada item (música, setlist…) tem uma "foto" da última versão combinada com o servidor.
// Se o item local difere da foto, ele tem alteração pendente e não é sobrescrito.

import * as api from './client.js';
import * as store from '../store.js';

const POLL_MS = 15000;
const ID_CHECK_EVERY = 6; // a cada 6 buscas confere também o que foi apagado

let userId = null;
let snap = {};          // chave -> JSON da última versão combinada com o servidor
let lastPull = {};      // tabela -> data/hora da última busca
let pollTimer = null;
let pushTimer = null;
let pushing = null;
let pushAgain = false;
let pollCount = 0;
let started = false;
let pendingRender = false;
const statusListeners = new Set();

export const status = { state: 'idle', pending: 0, lastSync: null, error: null };
export function onStatus(fn) { statusListeners.add(fn); fn(status); return () => statusListeners.delete(fn); }
function setStatus(patch) { Object.assign(status, patch); statusListeners.forEach((fn) => { try { fn(status); } catch { /* ok */ } }); }

const cacheKey = () => `repertorio-louvor.cloud.${userId}`;

// ---------- Cópia no aparelho ----------
function loadCache() {
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey()) || 'null');
    if (c?.state) { snap = c.snap || {}; lastPull = c.lastPull || {}; return c.state; }
  } catch { /* ok */ }
  snap = {}; lastPull = {};
  return null;
}

function persist(state) {
  if (!userId) return;
  try { localStorage.setItem(cacheKey(), JSON.stringify({ state, snap, lastPull })); } catch { /* sem espaço */ }
}

// ---------- Conversão entre o servidor e o estado local ----------
const J = (x) => JSON.stringify(x);
const profileOf = (u) => ({ nome: u.name || '', email: u.email || '', funcoes: u.functions || [], indisponiveis: u.unavailable || [], tom_preferido: u.preferredKey || null });
const memberOf = (m) => ({ papel: m.role, pode_editar: !!m.canEdit, ativo: m.active !== false });
const ministryOf = (m) => ({ nome: m.name, config: m.config || {} });
const execOf = (e) => ({ ministerio_id: e.ministryId, musica_id: e.songId, versao_id: e.versionId || null, setlist_id: e.setlistId || null, data: e.date });
const suggestionOf = (g) => ({ ministerio_id: g.ministryId || store.findSong(g.songId)?.ministryId, musica_id: g.songId, usuario_id: g.userId, texto: g.text, status: g.status });

/** Todos os itens locais, com a chave e o JSON usados para comparar com a foto. */
function localEntities(s) {
  const out = new Map();
  for (const u of s.users) {
    out.set(`perfis:${u.id}`, { table: 'perfis', id: u.id, json: J(profileOf(u)), obj: u });
    for (const m of u.memberships || []) out.set(`membros:${m.ministryId}:${u.id}`, { table: 'membros', id: u.id, min: m.ministryId, json: J(memberOf(m)), obj: m });
  }
  for (const m of s.ministries) out.set(`ministerios:${m.id}`, { table: 'ministerios', id: m.id, min: m.id, json: J(ministryOf(m)), obj: m });
  for (const x of s.songs) out.set(`musicas:${x.id}`, { table: 'musicas', id: x.id, min: x.ministryId, json: J(x), obj: x });
  for (const x of s.setlists) out.set(`setlists:${x.id}`, { table: 'setlists', id: x.id, min: x.ministryId, json: J(x), obj: x });
  for (const x of s.executions) out.set(`execucoes:${x.id}`, { table: 'execucoes', id: x.id, min: x.ministryId, json: J(execOf(x)), obj: x });
  for (const x of s.suggestions) out.set(`sugestoes:${x.id}`, { table: 'sugestoes', id: x.id, min: x.ministryId, json: J(suggestionOf(x)), obj: x });
  return out;
}

function myRole(s, min) {
  const me = s.users.find((u) => u.id === userId);
  return me?.memberships?.find((m) => m.ministryId === min) || null;
}
const isAdminOf = (s, min) => myRole(s, min)?.role === 'admin';
const canEditSongsOf = (s, min) => { const r = myRole(s, min); return !!r && (r.role === 'admin' || r.canEdit); };

function canWrite(s, e, isNew) {
  switch (e.table) {
    case 'perfis': return e.id === userId || s.ministries.some((m) => isAdminOf(s, m.id) && e.obj.memberships?.some((x) => x.ministryId === m.id));
    case 'membros':
    case 'ministerios':
    case 'setlists':
    case 'execucoes': return isAdminOf(s, e.min);
    case 'musicas': return canEditSongsOf(s, e.min);
    case 'sugestoes': return isAdminOf(s, e.min) || (isNew && e.obj.userId === userId);
    default: return false;
  }
}

// ---------- Aplicar o que veio do servidor ----------
function isDirty(local, key) {
  return local.has(key) ? local.get(key).json !== snap[key] : false;
}

function applyServer(s, data, { full }) {
  const local = localEntities(s);
  let changed = false;
  const setSnap = (key, json) => { snap[key] = json; };

  // Ministérios
  if (data.ministerios) {
    const seen = new Set();
    for (const r of data.ministerios) {
      const key = `ministerios:${r.id}`;
      seen.add(r.id);
      if (isDirty(local, key)) continue;
      let m = s.ministries.find((x) => x.id === r.id);
      const config = store.normalizeConfig(r.config);
      if (!m) { m = { id: r.id, name: r.nome, config }; s.ministries.push(m); changed = true; }
      else if (J(ministryOf(m)) !== J({ nome: r.nome, config })) { m.name = r.nome; m.config = config; changed = true; }
      setSnap(key, J(ministryOf(m)));
    }
    for (const m of [...s.ministries]) if (!seen.has(m.id)) { s.ministries.splice(s.ministries.indexOf(m), 1); delete snap[`ministerios:${m.id}`]; changed = true; }
  }

  // Pessoas e participação
  if (data.perfis && data.membros) {
    const byId = new Map(s.users.map((u) => [u.id, u]));
    const memb = new Map();
    for (const r of data.membros) {
      if (!memb.has(r.usuario_id)) memb.set(r.usuario_id, []);
      memb.get(r.usuario_id).push(r);
    }
    const seenUsers = new Set();
    for (const p of data.perfis) {
      seenUsers.add(p.id);
      let u = byId.get(p.id);
      if (!u) { u = { id: p.id, name: '', email: '', functions: [], unavailable: [], memberships: [], active: true }; s.users.push(u); changed = true; }
      const pk = `perfis:${p.id}`;
      if (!isDirty(local, pk)) {
        const next = { nome: p.nome, email: p.email, funcoes: p.funcoes || [], indisponiveis: p.indisponiveis || [], tom_preferido: p.tom_preferido || null };
        if (J(profileOf(u)) !== J(next)) {
          u.name = p.nome || p.email; u.email = p.email; u.functions = p.funcoes || []; u.unavailable = p.indisponiveis || [];
          if (p.tom_preferido) u.preferredKey = p.tom_preferido; else delete u.preferredKey;
          changed = true;
        }
        setSnap(pk, J(profileOf(u)));
      }
      const rows = memb.get(p.id) || [];
      const keep = [];
      for (const r of rows) {
        const mk = `membros:${r.ministerio_id}:${p.id}`;
        let m = u.memberships.find((x) => x.ministryId === r.ministerio_id);
        if (isDirty(local, mk) && m) { keep.push(m); continue; }
        const next = { ministryId: r.ministerio_id, role: r.papel, canEdit: !!r.pode_editar, active: r.ativo !== false };
        if (!m || J(m) !== J(next)) { m = next; changed = true; }
        keep.push(m);
        setSnap(mk, J(memberOf(m)));
      }
      // participações removidas no servidor (a não ser que a remoção local ainda não tenha subido)
      for (const m of u.memberships) {
        const mk = `membros:${m.ministryId}:${p.id}`;
        if (!keep.includes(m) && !rows.some((r) => r.ministerio_id === m.ministryId)) {
          if (snap[mk] !== undefined) { delete snap[mk]; changed = true; } else keep.push(m); // nova local, ainda não enviada
        }
      }
      if (keep.length !== u.memberships.length || keep.some((m, i) => m !== u.memberships[i])) { u.memberships = keep; changed = true; }
      u.active = u.memberships.some((m) => m.active !== false);
    }
    for (const u of [...s.users]) if (!seenUsers.has(u.id)) { s.users.splice(s.users.indexOf(u), 1); delete snap[`perfis:${u.id}`]; changed = true; }
  }

  // Músicas, setlists, execuções e sugestões
  const lists = [
    ['musicas', 'songs', (r) => store.normalizeSong({ ...r.dados, id: r.id, ministryId: r.ministerio_id }), (x) => J(x)],
    ['setlists', 'setlists', (r) => store.normalizeSetlist({ ...r.dados, id: r.id, ministryId: r.ministerio_id, date: r.dados?.date || r.data }), (x) => J(x)],
    ['execucoes', 'executions', (r) => ({ id: r.id, ministryId: r.ministerio_id, songId: r.musica_id, versionId: r.versao_id, setlistId: r.setlist_id, date: r.data }), (x) => J(execOf(x))],
    ['sugestoes', 'suggestions', (r) => ({ id: r.id, ministryId: r.ministerio_id, songId: r.musica_id, userId: r.usuario_id, text: r.texto, status: r.status, createdAt: r.criado_em }), (x) => J(suggestionOf(x))],
  ];
  for (const [table, field, toLocal, jsonOf] of lists) {
    const rows = data[table];
    if (rows) {
      for (const r of rows) {
        const key = `${table}:${r.id}`;
        if (isDirty(local, key)) continue;
        const obj = toLocal(r);
        const arr = s[field];
        const i = arr.findIndex((x) => x.id === r.id);
        if (i < 0) { arr.push(obj); changed = true; }
        else if (jsonOf(arr[i]) !== jsonOf(obj)) { arr[i] = obj; changed = true; }
        setSnap(key, jsonOf(i < 0 ? obj : arr[i]));
      }
    }
    // apagados no servidor
    const ids = data[`${table}_ids`];
    if (ids || (full && rows)) {
      const alive = new Set(ids || rows.map((r) => r.id));
      const arr = s[field];
      for (let i = arr.length - 1; i >= 0; i--) {
        const key = `${table}:${arr[i].id}`;
        if (alive.has(arr[i].id)) continue;
        if (snap[key] === undefined) continue;           // item novo local, ainda não enviado
        if (isDirty(local, key)) continue;
        arr.splice(i, 1);
        delete snap[key];
        changed = true;
      }
    }
  }

  if (data.convites) {
    const inv = data.convites.map((c) => ({ id: c.id, ministryId: c.ministerio_id, name: c.nome, role: c.papel, canEdit: c.pode_editar, functions: c.funcoes || [], createdAt: c.criado_em, expiresAt: c.expira_em }));
    if (J(inv) !== J(s.invites || [])) { s.invites = inv; changed = true; }
  }

  // Ministério atual e listas (tipos de culto, funções, temas) desse ministério
  if (!s.ministries.some((m) => m.id === s.session.ministryId)) s.session.ministryId = s.ministries[0]?.id || null;
  const cur = s.ministries.find((m) => m.id === s.session.ministryId);
  if (cur) s.settings = cur.config;
  return changed;
}

// ---------- Buscar do servidor ----------
async function pull({ full = false, checkIds: forceIds = false } = {}) {
  const s = store.getState();
  const started = new Date(Date.now() - 5000).toISOString(); // margem para relógios diferentes
  const data = {};
  [data.perfis, data.membros, data.ministerios] = await Promise.all([
    api.select('perfis', 'select=*'),
    api.select('membros', 'select=*'),
    api.select('ministerios', 'select=id,nome,config'),
  ]);
  const mins = data.ministerios.map((m) => m.id);
  const adminMins = data.membros.filter((r) => r.usuario_id === userId && r.papel === 'admin' && r.ativo).map((r) => r.ministerio_id);
  if (mins.length) {
    const since = (t) => (!full && lastPull[t] ? `&atualizado_em=gt.${encodeURIComponent(lastPull[t])}` : '');
    const inMin = `ministerio_id=${api.inList(mins)}`;
    const checkIds = !full && (forceIds || pollCount % ID_CHECK_EVERY === 0);
    const jobs = {
      musicas: api.select('musicas', `select=*&${inMin}${since('musicas')}`),
      setlists: api.select('setlists', `select=*&${inMin}${since('setlists')}`),
      execucoes: api.select('execucoes', `select=*&${inMin}${since('execucoes')}`),
      sugestoes: api.select('sugestoes', `select=*&${inMin}${since('sugestoes')}`),
      convites: adminMins.length ? api.select('convites', `select=*&ministerio_id=${api.inList(adminMins)}&order=criado_em.desc`) : Promise.resolve([]),
    };
    if (checkIds) for (const t of ['musicas', 'setlists', 'execucoes', 'sugestoes']) jobs[`${t}_ids`] = api.select(t, `select=id&${inMin}`).then((r) => r.map((x) => x.id));
    const keys = Object.keys(jobs);
    const vals = await Promise.all(Object.values(jobs));
    keys.forEach((k, i) => { data[k] = vals[i]; });
  } else {
    Object.assign(data, { musicas: [], setlists: [], execucoes: [], sugestoes: [], convites: [] });
    full = true;
  }
  let changed = false;
  store.commit((st) => { changed = applyServer(st, data, { full }); }, { silent: true, fromSync: true });
  for (const t of ['musicas', 'setlists', 'execucoes', 'sugestoes']) lastPull[t] = started;
  pollCount++;
  persist(store.getState());
  void s;
  return changed;
}

// ---------- Enviar para o servidor ----------
export function schedulePush(delay = 700) {
  if (!started) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => push(), delay);
  setStatus({ pending: countPending() });
}

function countPending() {
  const s = store.getState();
  if (!s) return 0;
  const local = localEntities(s);
  let n = 0;
  for (const [k, e] of local) if (snap[k] !== e.json) n++;
  for (const k of Object.keys(snap)) if (!local.has(k) && /^(musicas|setlists|execucoes|sugestoes|membros):/.test(k)) n++;
  return n;
}

export async function push() {
  if (!started) return;
  if (pushing) { pushAgain = true; return pushing; }
  pushing = (async () => {
    try {
      setStatus({ state: 'syncing' });
      await doPush();
      setStatus({ state: 'ok', error: null, lastSync: new Date(), pending: countPending() });
    } catch (e) {
      const offline = e.status === 0;
      setStatus({ state: offline ? 'offline' : 'error', error: offline ? null : api.friendlyError(e), pending: countPending() });
    } finally {
      pushing = null;
      persist(store.getState());
      if (pushAgain) { pushAgain = false; schedulePush(200); }
    }
  })();
  return pushing;
}

async function doPush() {
  const s = store.getState();
  const local = localEntities(s);
  const changes = {};
  const reverts = [];
  for (const [key, e] of local) {
    if (snap[key] === e.json) continue;
    const isNew = snap[key] === undefined;
    if (!canWrite(s, e, isNew)) {
      if (e.table === 'setlists') await answerRosterIfMine(s, e, key);
      reverts.push(key);
      continue;
    }
    (changes[e.table] ||= []).push({ key, e, json: e.json, isNew });
  }
  const deletions = [];
  for (const key of Object.keys(snap)) {
    if (local.has(key)) continue;
    const [table, a, b] = key.split(':');
    if (!['musicas', 'setlists', 'execucoes', 'sugestoes', 'membros'].includes(table)) continue;
    deletions.push({ key, table, id: a, user: b, min: table === 'membros' ? a : null });
  }

  const errors = [];
  const ok = (items) => items.forEach((it) => { snap[it.key] = it.json; });

  // perfis: só atualização (o perfil é criado no servidor)
  for (const it of changes.perfis || []) {
    try { await api.update('perfis', `id=${api.eq(it.e.id)}`, profileOf(it.e.obj)); ok([it]); } catch (err) { errors.push(err); }
  }
  for (const it of changes.ministerios || []) {
    try { await api.update('ministerios', `id=${api.eq(it.e.id)}`, ministryOf(it.e.obj)); ok([it]); } catch (err) { errors.push(err); }
  }
  await batch('membros', changes.membros, (it) => ({ ministerio_id: it.e.min, usuario_id: it.e.id, ...memberOf(it.e.obj) }), 'ministerio_id,usuario_id');
  await batch('musicas', changes.musicas, (it) => ({ id: it.e.id, ministerio_id: it.e.min, dados: it.e.obj }));
  await batch('setlists', changes.setlists, (it) => ({ id: it.e.id, ministerio_id: it.e.min, data: it.e.obj.date || null, dados: it.e.obj }));
  await batch('execucoes', changes.execucoes, (it) => ({ id: it.e.id, ...execOf(it.e.obj) }));
  // sugestões: membro só pode criar; administrador responde
  for (const it of changes.sugestoes || []) {
    try {
      if (it.isNew) await api.insert('sugestoes', [{ id: it.e.id, ...suggestionOf(it.e.obj) }]);
      else await api.update('sugestoes', `id=${api.eq(it.e.id)}`, { status: it.e.obj.status, texto: it.e.obj.text });
      ok([it]);
    } catch (err) { errors.push(err); }
  }

  // apagar (dependentes primeiro)
  for (const table of ['sugestoes', 'execucoes', 'setlists', 'musicas', 'membros']) {
    for (const d of deletions.filter((x) => x.table === table)) {
      try {
        if (table === 'membros') await api.remove('membros', `ministerio_id=${api.eq(d.id)}&usuario_id=${api.eq(d.user)}`);
        else await api.remove(table, `id=${api.eq(d.id)}`);
        delete snap[d.key];
      } catch (err) { errors.push(err); }
    }
  }

  // alterações sem permissão voltam ao que está no servidor
  if (reverts.length) revert(reverts);
  if (errors.length) {
    const offline = errors.find((e) => e.status === 0);
    throw offline || errors[0];
  }

  async function batch(table, items, toRow, onConflict = 'id') {
    if (!items?.length) return;
    try {
      await api.upsert(table, items.map(toRow), onConflict);
      ok(items);
    } catch (err) {
      if (err.status === 0 || items.length === 1) { errors.push(err); return; }
      // um item com problema não pode travar os outros: tenta um por um
      for (const it of items) {
        try { await api.upsert(table, [toRow(it)], onConflict); ok([it]); } catch (e2) { errors.push(e2); }
      }
    }
  }
}

/** Membro confirmando/recusando a própria escala: vai por uma função própria do servidor. */
async function answerRosterIfMine(s, e, key) {
  if (!snap[key]) return;
  let before;
  try { before = JSON.parse(snap[key]); } catch { return; }
  for (const r of e.obj.roster || []) {
    if (r.userId !== userId) continue;
    const old = (before.roster || []).find((x) => x.id === r.id);
    if (old && old.status !== r.status) {
      await api.rpc('responder_escala', { p_setlist: e.id, p_item: r.id, p_status: r.status });
      const nb = { ...before, roster: before.roster.map((x) => (x.id === r.id ? { ...x, status: r.status } : x)) };
      snap[key] = J(nb);
    }
  }
}

function revert(keys) {
  store.commit((s) => {
    for (const key of keys) {
      const json = snap[key];
      const [table, id, extra] = key.split(':');
      if (json !== undefined && table === 'ministerios') {
        const m = s.ministries.find((x) => x.id === id);
        const v = JSON.parse(json);
        if (m) { m.name = v.nome; m.config = store.normalizeConfig(v.config); if (s.session.ministryId === m.id) s.settings = m.config; }
        continue;
      }
      if (json !== undefined && table === 'perfis') {
        const u = s.users.find((x) => x.id === id);
        const v = JSON.parse(json);
        if (u) { u.name = v.nome; u.email = v.email; u.functions = v.funcoes; u.unavailable = v.indisponiveis; }
        continue;
      }
      if (json !== undefined && table === 'membros') {
        const u = s.users.find((x) => x.id === extra);
        const m = u?.memberships.find((x) => x.ministryId === id);
        const v = JSON.parse(json);
        if (m) { m.role = v.papel; m.canEdit = v.pode_editar; m.active = v.ativo; }
        continue;
      }
      const map = { musicas: 'songs', setlists: 'setlists', execucoes: null, sugestoes: null };
      if (!map[table] || json === undefined) continue;
      const arr = s[map[table]];
      const i = arr.findIndex((x) => x.id === id);
      const obj = JSON.parse(json);
      if (i >= 0) arr[i] = obj; else arr.push(obj);
    }
  }, { silent: true, fromSync: true });
  // o JSON da foto agora coincide; itens sem foto (novos sem permissão) são descartados
  store.commit((s) => {
    const local = localEntities(s);
    for (const key of keys) if (snap[key] === undefined && local.has(key)) {
      const [table, id] = key.split(':');
      const map = { musicas: 'songs', setlists: 'setlists', execucoes: 'executions', sugestoes: 'suggestions' };
      if (map[table]) s[map[table]] = s[map[table]].filter((x) => x.id !== id);
    }
  }, { silent: true, fromSync: true });
  // o que ainda não deu para desfazer fica como está, sem tentar reenviar sem parar
  const after = localEntities(store.getState());
  for (const key of keys) if (after.has(key) && snap[key] !== after.get(key).json && snap[key] !== undefined) snap[key] = after.get(key).json;
  maybeRender(true);
}

// ---------- Ciclo ----------
function safeToRender() {
  if (document.querySelector('.modal-backdrop, .worship')) return false;
  const a = document.activeElement;
  if (a && a.matches?.('input, textarea, select') && a.closest('#app')) return false;
  const h = location.hash;
  if (/\/editar|\/nova|\/player|\/importar|\/convite/.test(h)) return false;
  return true;
}

function maybeRender(changed) {
  if (changed) pendingRender = true;
  if (pendingRender && safeToRender()) { pendingRender = false; store.notify(); }
}

async function tick(manual = false) {
  if (!started) return;
  if (document.visibilityState === 'hidden') return;
  try {
    if (countPending()) await push();
    setStatus({ state: 'syncing' });
    const changed = await pull({ checkIds: manual === true });
    setStatus({ state: 'ok', error: null, lastSync: new Date(), pending: countPending() });
    maybeRender(changed);
  } catch (e) {
    setStatus({ state: e.status === 0 ? 'offline' : 'error', error: e.status === 0 ? null : api.friendlyError(e) });
  }
}

/** Abre a sessão: carrega a cópia local, garante o perfil, aceita convite pendente e busca tudo. */
export async function start(uid, { onFirstData } = {}) {
  stop();
  userId = uid;
  const cached = loadCache();
  store.loadCloud(cached, uid);
  started = true;
  store.onCommit((opts) => { if (!opts?.fromSync) schedulePush(); });
  store.setPersister((st) => persist(st));
  const hadCache = !!cached;
  if (hadCache) onFirstData?.();
  try {
    setStatus({ state: 'syncing' });
    const nome = api.currentAuthUser()?.user_metadata?.nome || null;
    await api.rpc('garantir_perfil', { p_nome: nome });
    await acceptPendingInvite();
    await pull({ full: true });
    if (countPending()) await push();
    setStatus({ state: 'ok', lastSync: new Date(), error: null, pending: countPending() });
  } catch (e) {
    setStatus({ state: e.status === 0 ? 'offline' : 'error', error: e.status === 0 ? null : api.friendlyError(e) });
    if (!hadCache && e.status !== 0) throw e;
  }
  if (!hadCache) onFirstData?.(); else maybeRender(true);
  clearInterval(pollTimer);
  pollTimer = setInterval(tick, POLL_MS);
  window.addEventListener('online', tick);
  document.addEventListener('visibilitychange', onVisible);
}

function onVisible() { if (document.visibilityState === 'visible') tick(); }

export function stop() {
  started = false;
  clearInterval(pollTimer);
  clearTimeout(pushTimer);
  window.removeEventListener('online', tick);
  document.removeEventListener('visibilitychange', onVisible);
  setStatus({ state: 'idle', pending: 0, error: null });
}

export async function refreshNow() { await tick(true); }

// ---------- Ações que não passam pela comparação ----------
const PENDING_INVITE = 'repertorio-louvor.convite';

export function rememberInvite(code) { try { localStorage.setItem(PENDING_INVITE, code); } catch { /* ok */ } }
export function pendingInvite() { try { return localStorage.getItem(PENDING_INVITE); } catch { return null; } }
export function forgetInvite() { try { localStorage.removeItem(PENDING_INVITE); } catch { /* ok */ } }

let lastJoined = null;
export function takeJoined() { const j = lastJoined; lastJoined = null; return j; }
async function acceptPendingInvite() {
  const code = pendingInvite();
  if (!code) return;
  try {
    const min = await api.rpc('aceitar_convite', { p_codigo: code });
    lastJoined = min;
    store.commit((s) => { s.session.ministryId = min; }, { silent: true, fromSync: true });
  } catch (e) {
    if (e.status === 0) return; // tenta de novo quando houver internet
    lastJoined = { error: api.friendlyError(e) };
  }
  forgetInvite();
}

export async function joinWithCode(code) {
  rememberInvite(code);
  await acceptPendingInvite();
  await pull({ full: true });
  maybeRender(true);
  return takeJoined();
}

export async function createMinistry(nome) {
  const id = await api.rpc('criar_ministerio', { p_nome: nome, p_config: store.normalizeConfig({}) });
  store.commit((s) => { s.session.ministryId = id; }, { silent: true, fromSync: true });
  await pull({ full: true });
  return id;
}

function randomCode(n = 24) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => chars[b % chars.length]).join('');
}

export function inviteLink(code) { return `${api.appUrl()}#/convite/${code}`; }

export async function createInvite({ ministryId, name, role, canEdit, functions }) {
  const id = randomCode();
  await api.insert('convites', [{ id, ministerio_id: ministryId, nome: name || '', papel: role || 'membro', pode_editar: !!canEdit, funcoes: functions || [] }]);
  await pull();
  maybeRender(true);
  return inviteLink(id);
}

export async function deleteInvite(id) {
  await api.remove('convites', `id=${api.eq(id)}`);
  await pull();
  maybeRender(true);
}

export async function leaveMinistry(min) {
  await api.rpc('sair_do_ministerio', { p_min: min });
  await pull({ full: true });
  maybeRender(true);
}

export function currentUserId() { return userId; }
