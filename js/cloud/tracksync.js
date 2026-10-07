// Ponte entre o Drive do ministério e os arquivos guardados no aparelho.
//
// No Drive fica a cópia do ministério (uma vez, feita por quem edita as músicas).
// No aparelho fica a cópia para tocar offline, baixada por cada pessoa com um toque.

import * as drive from './drive.js';
import * as store from '../store.js';
import { putTrack, deleteTrack, hasTrack, presentTracks, requestPersist } from '../audio/trackstore.js';

/** O ministério tem o Drive conectado? Consulta uma vez e guarda. */
let statusCache = null;
export async function conectado(ministryId = store.getState().session.ministryId) {
  if (statusCache && statusCache.id === ministryId && Date.now() - statusCache.quando < 300000) return statusCache.valor;
  const st = await drive.status(ministryId);
  statusCache = { id: ministryId, quando: Date.now(), valor: st };
  return st;
}
export function esquecerStatus() { statusCache = null; }

/** Situação das faixas de uma versão neste aparelho. */
export async function situacao(version) {
  const ids = (version.tracks || []).map((t) => t.id);
  const aqui = await presentTracks(version.id, ids);
  const naNuvem = (version.tracks || []).filter((t) => t.driveFileId);
  const baixaveis = naNuvem.filter((t) => !aqui.has(t.id));
  return {
    total: ids.length,
    aqui: aqui.size,
    presentes: aqui,
    naNuvem: naNuvem.length,
    baixaveis,
    soLocais: (version.tracks || []).filter((t) => !t.driveFileId && !aqui.has(t.id)),
    bytes: baixaveis.reduce((n, t) => n + (t.size || 0), 0),
    completo: ids.length > 0 && aqui.size === ids.length,
  };
}

/**
 * Baixa para este aparelho as faixas da versão que ainda não estão aqui.
 * aoProgredir recebe { faixa, indice, total, fracao, geral } para a barra.
 */
export async function baixarVersao(song, version, { aoProgredir, sinal } = {}) {
  const st = await situacao(version);
  if (!st.baixaveis.length) return { baixadas: 0, falhas: [], jaTinha: st.aqui };
  const total = st.baixaveis.length;
  const falhas = [];
  let baixadas = 0;
  await requestPersist();
  for (let i = 0; i < total; i++) {
    if (sinal?.aborted) break;
    const t = st.baixaveis[i];
    try {
      const blob = await drive.baixar(t.driveFileId, (f) => {
        aoProgredir?.({ faixa: t.name, indice: i + 1, total, fracao: f, geral: (i + f) / total });
      }, song.ministryId, sinal);
      const guardou = await putTrack(version.id, t.id, blob);
      if (!guardou) falhas.push(`${t.name}: o navegador não deixou guardar no aparelho`);
      else baixadas++;
      // tamanho real, para a próxima vez mostrar o peso certo
      if (blob.size && blob.size !== t.size && store.canEditSongs()) {
        store.commit((s) => {
          for (const sg of s.songs) {
            const v = sg.versions.find((x) => x.id === version.id);
            if (v) { const y = v.tracks.find((z) => z.id === t.id); if (y) y.size = blob.size; }
          }
        }, { silent: true });
      }
    } catch (e) {
      if (e.codigo === 'cancelado') break;
      falhas.push(`${t.name}: ${e.message}`);
      if (e.codigo === 'offline' || e.codigo === 'sem_conexao') break;
    }
  }
  return { baixadas, falhas, jaTinha: st.aqui };
}

/** Baixa tudo o que o setlist precisa. aoProgredir recebe { musica, indice, total, geral }. */
export async function baixarSetlist(setlist, { aoProgredir, sinal } = {}) {
  const itens = (setlist.items || []).map((it) => {
    const song = store.findSong(it.songId);
    const version = song?.versions.find((v) => v.id === it.versionId) || song?.versions[0];
    return song && version ? { song, version } : null;
  }).filter(Boolean);
  const falhas = [];
  let baixadas = 0;
  for (let i = 0; i < itens.length; i++) {
    if (sinal?.aborted) break;
    const { song, version } = itens[i];
    const r = await baixarVersao(song, version, {
      sinal,
      aoProgredir: (p) => aoProgredir?.({ musica: song.title, indice: i + 1, total: itens.length, geral: (i + p.geral) / itens.length, faixa: p.faixa }),
    });
    baixadas += r.baixadas;
    falhas.push(...r.falhas.map((f) => `${song.title} — ${f}`));
  }
  return { baixadas, falhas, musicas: itens.length };
}

/** Envia para o Drive um arquivo que acabou de ser adicionado. Devolve o id no Drive. */
export async function enviarFaixa(song, version, arquivo, nome, aoProgredir) {
  const pasta = await drive.pastaDaVersao(song, version);
  return drive.enviar(arquivo, pasta, nome || arquivo.name, aoProgredir, song.ministryId);
}

/** Apaga a cópia do ministério no Drive (quando a faixa é removida da versão). */
export async function apagarDoDrive(fileId, ministryId) {
  const st = await conectado(ministryId);
  if (st.conectado) await drive.apagar(fileId, ministryId);
}

/** Apaga do aparelho (continua no Drive, pode baixar de novo). */
export async function liberarVersao(version) {
  for (const t of version.tracks || []) if (await hasTrack(version.id, t.id)) await deleteTrack(version.id, t.id);
}

export const mb = (n) => !n ? '—' : (n / 1048576).toFixed(n > 10485760 ? 0 : 1).replace('.', ',') + ' MB';
