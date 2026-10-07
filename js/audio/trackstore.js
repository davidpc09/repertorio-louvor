// Guarda os áudios das multipistas no próprio aparelho (IndexedDB) para tocar sem internet.
// Se o navegador bloquear o armazenamento, os arquivos ficam só na memória enquanto a página estiver aberta.

const DB = 'repertorio-louvor-audio';
const STORE = 'tracks';
const memory = new Map();
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const st = t.objectStore(STORE);
    const out = fn(st);
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const key = (versionId, trackId) => `${versionId}/${trackId}`;

/** Salva o arquivo. Retorna true se ficou guardado no aparelho, false se só na memória. */
export async function putTrack(versionId, trackId, blob) {
  memory.set(key(versionId, trackId), blob);
  const db = await openDb();
  if (!db) return false;
  try {
    await tx(db, 'readwrite', (st) => st.put(blob, key(versionId, trackId)));
    requestPersist();
    return true;
  } catch { return false; }
}

export async function getTrack(versionId, trackId) {
  const k = key(versionId, trackId);
  if (memory.has(k)) return memory.get(k);
  const db = await openDb();
  if (!db) return null;
  try {
    let req;
    await tx(db, 'readonly', (st) => { req = st.get(k); return req; });
    const blob = req.result || null;
    if (blob) memory.set(k, blob);
    return blob;
  } catch { return null; }
}

/** O arquivo já está neste aparelho? (não carrega o conteúdo) */
export async function hasTrack(versionId, trackId) {
  const k = key(versionId, trackId);
  if (memory.has(k)) return true;
  const db = await openDb();
  if (!db) return false;
  try {
    let req;
    await tx(db, 'readonly', (st) => { req = st.getKey(k); return req; });
    return req.result !== undefined;
  } catch { return false; }
}

/** Quais faixas de uma versão já estão aqui. Devolve um Set de ids. */
export async function presentTracks(versionId, trackIds) {
  const out = new Set();
  for (const id of trackIds) if (await hasTrack(versionId, id)) out.add(id);
  return out;
}

export async function deleteTrack(versionId, trackId) {
  memory.delete(key(versionId, trackId));
  const db = await openDb();
  if (!db) return;
  try { await tx(db, 'readwrite', (st) => st.delete(key(versionId, trackId))); } catch { /* ok */ }
}

export async function clearAllTracks() {
  memory.clear();
  const db = await openDb();
  if (!db) return;
  try { await tx(db, 'readwrite', (st) => st.clear()); } catch { /* ok */ }
}

/** Pede ao navegador para não apagar os arquivos (importante no iPhone). */
export async function requestPersist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ok */ }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage.estimate();
    const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1).replace('.', ',') + ' MB';
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    return `${mb(e.usage || 0)} de ${mb(e.quota || 0)} disponíveis${persisted ? ' · protegido contra limpeza automática' : ''}`;
  } catch { return 'não disponível neste navegador'; }
}
