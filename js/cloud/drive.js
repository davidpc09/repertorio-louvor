// Google Drive do ministério, visto pelo app.
//
// A autorização de longo prazo fica no servidor (função drive-auth). Aqui o app só
// pede uma chave temporária e, com ela, fala direto com o Google: os arquivos vão
// do Google para o celular sem passar por nenhum servidor nosso.

import * as api from './client.js';
import * as store from '../store.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const PASTA = 'application/vnd.google-apps.folder';
const RAIZ = 'Repertório Louvor';

const tokens = new Map();   // ministerioId -> { token, validoAte }
let avisoConexao = null;

export class DriveError extends Error {
  constructor(message, codigo) { super(message); this.codigo = codigo; }
}

/** O ministério já conectou o Drive? (consulta rápida, sem falar com o Google) */
export async function status(ministryId = store.getState().session.ministryId) {
  if (!api.configured || store.mode !== 'cloud') return { conectado: false };
  try {
    const linhas = await api.select('drive_status', `select=*&ministerio_id=${api.eq(ministryId)}`);
    const c = linhas[0];
    return { conectado: !!c, conta: c?.conta_email || null, desde: c?.conectado_em || null };
  } catch {
    return { conectado: false, erro: true };
  }
}

async function chamarFuncao(acao, extra = {}) {
  const ministerioId = extra.ministryId || store.getState().session.ministryId;
  const res = await api.callFunction('drive-auth', { acao, ministerioId, ...extra });
  return res;
}

export async function iniciarConexao(ministryId) {
  const { url } = await chamarFuncao('inicio', { ministryId });
  return url;
}

export async function desconectar(ministryId) {
  tokens.delete(ministryId || store.getState().session.ministryId);
  await chamarFuncao('desconectar', { ministryId });
}

/** Chave temporária para falar com o Google. Reaproveitada enquanto estiver válida. */
async function token(ministryId = store.getState().session.ministryId) {
  const guardado = tokens.get(ministryId);
  if (guardado && guardado.validoAte > Date.now() + 60000) return guardado.token;
  let r;
  try {
    r = await chamarFuncao('token', { ministryId });
  } catch (e) {
    if (e.status === 409) throw new DriveError(e.body?.erro || 'O Google Drive não está conectado.', e.body?.codigo || 'sem_conexao');
    if (e.status === 0) throw new DriveError('Sem internet para falar com o Google Drive.', 'offline');
    throw new DriveError(api.friendlyError(e), 'funcao');
  }
  tokens.set(ministryId, { token: r.access_token, validoAte: Date.now() + (r.expires_in || 3600) * 1000 });
  return r.access_token;
}

export function esquecerToken(ministryId = store.getState().session.ministryId) { tokens.delete(ministryId); }

async function g(caminho, init = {}) {
  const t = await token(init.ministryId);
  const res = await fetch(caminho.startsWith('http') ? caminho : API + caminho, {
    ...init,
    headers: { Authorization: 'Bearer ' + t, ...(init.headers || {}) },
  });
  if (res.status === 401) {
    esquecerToken(init.ministryId);
    throw new DriveError('A chave de acesso ao Drive expirou. Tente de novo.', 'token');
  }
  if (!res.ok) {
    let detalhe = '';
    try { detalhe = (await res.json())?.error?.message || ''; } catch { /* sem corpo */ }
    if (res.status === 403 && /quota|rate/i.test(detalhe)) throw new DriveError('O Google está limitando os pedidos. Espere um minuto e tente de novo.', 'cota');
    if (res.status === 404) throw new DriveError('O arquivo não está mais no Drive do ministério.', 'sumiu');
    throw new DriveError(detalhe || `Erro ${res.status} no Google Drive.`, 'google');
  }
  return res;
}

const escapar = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function acharPasta(nome, paiId) {
  const q = `name='${escapar(nome)}' and mimeType='${PASTA}' and trashed=false` + (paiId ? ` and '${paiId}' in parents` : '');
  const res = await g(`/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10&spaces=drive`);
  return (await res.json()).files?.[0]?.id || null;
}

async function criarPasta(nome, paiId) {
  const res = await g('/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, mimeType: PASTA, ...(paiId ? { parents: [paiId] } : {}) }),
  });
  return (await res.json()).id;
}

async function pastaOuCria(nome, paiId) {
  return (await acharPasta(nome, paiId)) || (await criarPasta(nome, paiId));
}

/** Confere se um id de pasta ainda existe (pode ter sido apagada no Drive). */
async function pastaValida(id) {
  if (!id) return false;
  try {
    const res = await g(`/files/${id}?fields=id,trashed`);
    return !(await res.json()).trashed;
  } catch { return false; }
}

/** Pasta raiz do ministério, guardada no cadastro para não procurar toda vez. */
export async function pastaRaiz(ministryId = store.getState().session.ministryId) {
  const m = store.getState().ministries.find((x) => x.id === ministryId);
  const guardado = m?.config?.driveFolderId;
  if (guardado && (await pastaValida(guardado))) return guardado;
  const id = await pastaOuCria(RAIZ, null);
  // fica no "config" do ministério, que a sincronização já leva para o servidor
  store.commit((s) => {
    const x = s.ministries.find((y) => y.id === ministryId);
    if (x) { x.config = { ...(x.config || {}), driveFolderId: id }; }
  }, { silent: true });
  return id;
}

const limpo = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 90) || 'Sem nome';

/** Pasta da versão: Repertório Louvor › Música - Artista › Versão › VS. Cria o que faltar. */
export async function pastaDaVersao(song, version) {
  const raiz = await pastaRaiz(song.ministryId);
  let pastaMusica = song.driveFolderId;
  if (!(await pastaValida(pastaMusica))) {
    pastaMusica = await pastaOuCria(limpo(song.artist ? `${song.title} - ${song.artist}` : song.title), raiz);
    store.commit((s) => { const x = s.songs.find((y) => y.id === song.id); if (x) x.driveFolderId = pastaMusica; }, { silent: true });
  }
  let pastaVersao = version.driveFolderId;
  if (!(await pastaValida(pastaVersao))) {
    pastaVersao = await pastaOuCria(limpo(version.name || 'Original'), pastaMusica);
  }
  const vs = await pastaOuCria('VS', pastaVersao);
  store.commit((s) => {
    for (const sg of s.songs) {
      const v = sg.versions.find((y) => y.id === version.id);
      if (v) { v.driveFolderId = pastaVersao; v.driveVsId = vs; }
    }
  }, { silent: true });
  return vs;
}

/** Envia um arquivo para a pasta, com progresso (0 a 1). Devolve o id no Drive. */
export async function enviar(arquivo, pastaId, nome, aoProgredir, ministryId) {
  const t = await token(ministryId);
  // sessão retomável: suporta arquivos grandes e dá progresso real
  const inicio = await fetch(`${UPLOAD}?uploadType=resumable&fields=id,size`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': arquivo.type || 'audio/mpeg', 'X-Upload-Content-Length': String(arquivo.size) },
    body: JSON.stringify({ name: nome || arquivo.name, parents: [pastaId] }),
  });
  if (!inicio.ok) {
    if (inicio.status === 401) { esquecerToken(ministryId); throw new DriveError('A chave de acesso ao Drive expirou. Tente de novo.', 'token'); }
    throw new DriveError(`Não consegui começar o envio (erro ${inicio.status}).`, 'google');
  }
  const destino = inicio.headers.get('Location');
  if (!destino) throw new DriveError('O Google não devolveu o endereço de envio.', 'google');

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', destino);
    xhr.setRequestHeader('Content-Type', arquivo.type || 'audio/mpeg');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) aoProgredir?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).id); } catch { reject(new DriveError('Resposta inesperada do Google ao enviar.', 'google')); }
      } else reject(new DriveError(`O envio falhou (erro ${xhr.status}).`, 'google'));
    };
    xhr.onerror = () => reject(new DriveError('A conexão caiu durante o envio.', 'offline'));
    xhr.onabort = () => reject(new DriveError('Envio cancelado.', 'cancelado'));
    xhr.send(arquivo);
  });
}

/** Baixa o arquivo do Drive, com progresso (0 a 1). Devolve um Blob. */
export async function baixar(fileId, aoProgredir, ministryId, sinal) {
  const t = await token(ministryId);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${API}/files/${fileId}?alt=media&supportsAllDrives=true`);
    xhr.setRequestHeader('Authorization', 'Bearer ' + t);
    xhr.responseType = 'blob';
    xhr.onprogress = (e) => { if (e.lengthComputable) aoProgredir?.(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) { aoProgredir?.(1); resolve(xhr.response); return; }
      if (xhr.status === 401) { esquecerToken(ministryId); reject(new DriveError('A chave de acesso ao Drive expirou. Tente de novo.', 'token')); return; }
      if (xhr.status === 404) { reject(new DriveError('O arquivo não está mais no Drive do ministério.', 'sumiu')); return; }
      reject(new DriveError(`O download falhou (erro ${xhr.status}).`, 'google'));
    };
    xhr.onerror = () => reject(new DriveError('A conexão caiu durante o download.', 'offline'));
    xhr.onabort = () => reject(new DriveError('Download cancelado.', 'cancelado'));
    sinal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send();
  });
}

export async function apagar(fileId, ministryId) {
  try { await g(`/files/${fileId}`, { method: 'DELETE', ministryId }); } catch (e) { if (e.codigo !== 'sumiu') throw e; }
}

/** Link para abrir a pasta no Drive, no navegador. */
export const linkDaPasta = (id) => `https://drive.google.com/drive/folders/${id}`;

/** Mensagem única de "precisa conectar", para não repetir texto nas telas. */
export function mensagemSemConexao() {
  return avisoConexao || (avisoConexao = 'O Google Drive ainda não foi conectado. Um administrador faz isso uma vez em Mais › Google Drive.');
}
