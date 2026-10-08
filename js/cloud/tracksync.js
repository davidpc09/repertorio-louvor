// Ponte entre o Drive do ministério e os arquivos guardados no aparelho.
//
// No Drive fica a cópia do ministério (uma vez, feita por quem edita as músicas).
// No aparelho fica a cópia para tocar offline, baixada por cada pessoa com um toque.

import * as drive from './drive.js';
import * as store from '../store.js';
import { putTrack, deleteTrack, hasTrack, presentTracks, requestPersist, listStored } from '../audio/trackstore.js';

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

/**
 * Envia para o Drive um arquivo que acabou de ser adicionado. Devolve o id no Drive.
 * Se a pasta já tem um arquivo com o mesmo nome e tamanho (outro aparelho enviou antes), reaproveita
 * esse em vez de criar uma segunda cópia.
 */
export async function enviarFaixa(song, version, arquivo, nome, aoProgredir) {
  const pasta = await drive.pastaDaVersao(song, version);
  const nomeFinal = nome || arquivo.name;
  try {
    const igual = (await drive.listarPasta(pasta, song.ministryId)).find((f) => f.name === nomeFinal && f.size === arquivo.size);
    if (igual) { aoProgredir?.(1); return igual.id; }
  } catch { /* sem como conferir: envia mesmo assim */ }
  return drive.enviar(arquivo, pasta, nomeFinal, aoProgredir, song.ministryId);
}

// ---------- Conferência de arquivos repetidos ----------

const chaveRepetida = (t) => {
  const nome = String(t.fileName || t.name || '').trim().toLowerCase();
  if (t.size > 0 && nome) return `n:${nome}|${t.size}`;
  return t.driveFileId ? `d:${t.driveFileId}` : null;
};

/**
 * Compara o que o app conhece com o que está guardado neste aparelho e (se conectado) na pasta do Drive.
 * Só lê: nada é apagado aqui. Devolve um relatório para a tela mostrar e oferecer a limpeza.
 *
 *  aparelho: { arquivos, bytes, orfas[], repetidas[] }
 *    orfas      — guardadas no aparelho, mas a faixa não existe mais em nenhuma música
 *    repetidas  — mesma música/versão com o mesmo arquivo cadastrado mais de uma vez
 *  drive: { conectado, erro, versoes[] }  cada versão: { song, version, noDrive, noApp, repetidos[], sobrando[] }
 *    repetidos  — arquivos extras na pasta com o mesmo nome e tamanho de outro (não usados por nenhuma faixa)
 *    sobrando   — arquivos na pasta que nenhuma faixa usa (só informativo: podem ter sido postos à mão)
 */
export async function auditar({ ministryId = store.getState().session.ministryId, comDrive = true, aoProgredir } = {}) {
  const s = store.getState();
  const todas = new Map();
  for (const song of s.songs) for (const v of song.versions) todas.set(v.id, { song, version: v });

  const guardados = await listStored();
  const orfas = guardados.filter((g) => {
    const f = todas.get(g.versionId);
    return !f || !f.version.tracks.some((t) => t.id === g.trackId);
  }).map((g) => ({ ...g, song: todas.get(g.versionId)?.song || null, version: todas.get(g.versionId)?.version || null }));

  const repetidas = [];
  for (const { song, version } of todas.values()) {
    if (song.ministryId !== ministryId) continue;
    const grupos = new Map();
    for (const t of version.tracks || []) {
      const k = chaveRepetida(t);
      if (!k) continue;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(t);
    }
    for (const lista of grupos.values()) {
      if (lista.length < 2) continue;
      // fica a faixa mais "completa": a que tem cópia no Drive e a que já está neste aparelho
      const nota = new Map();
      for (const t of lista) nota.set(t, (t.driveFileId ? 2 : 0) + ((await hasTrack(version.id, t.id)) ? 1 : 0));
      const ordenada = [...lista].sort((a, b) => nota.get(b) - nota.get(a));
      repetidas.push({ song, version, manter: ordenada[0], extras: ordenada.slice(1) });
    }
  }

  const relatorio = {
    aparelho: { arquivos: guardados.length, bytes: guardados.reduce((n, g) => n + g.size, 0), orfas, repetidas },
    drive: { conectado: false, erro: null, versoes: [] },
  };
  if (!comDrive || store.mode !== 'cloud') return relatorio;

  let st = { conectado: false };
  try { st = await conectado(ministryId); } catch { /* offline */ }
  relatorio.drive.conectado = !!st.conectado;
  if (!st.conectado) return relatorio;

  const usados = new Set();
  for (const { version } of todas.values()) for (const t of version.tracks || []) if (t.driveFileId) usados.add(t.driveFileId);
  const alvo = [...todas.values()].filter(({ song, version }) => song.ministryId === ministryId && version.driveVsId);
  for (let i = 0; i < alvo.length; i++) {
    const { song, version } = alvo[i];
    aoProgredir?.({ indice: i + 1, total: alvo.length, musica: song.title });
    try {
      const arquivos = await drive.listarPasta(version.driveVsId, ministryId);
      const grupos = new Map();
      for (const f of arquivos) {
        const k = `${f.name.toLowerCase()}|${f.size}`;
        if (!grupos.has(k)) grupos.set(k, []);
        grupos.get(k).push(f);
      }
      const repetidos = [];
      for (const lista of grupos.values()) {
        if (lista.length < 2) continue;
        // fica o que alguma faixa usa; se nenhum for usado, fica o primeiro
        const manter = lista.find((f) => usados.has(f.id)) || lista[0];
        for (const f of lista) if (f.id !== manter.id && !usados.has(f.id)) repetidos.push(f);
      }
      const repetidosIds = new Set(repetidos.map((f) => f.id));
      relatorio.drive.versoes.push({
        song, version,
        noDrive: arquivos.length,
        noApp: (version.tracks || []).filter((t) => t.driveFileId).length,
        repetidos,
        sobrando: arquivos.filter((f) => !usados.has(f.id) && !repetidosIds.has(f.id)),
      });
    } catch (e) {
      if (e.codigo === 'offline' || e.codigo === 'sem_conexao') { relatorio.drive.erro = e.message; break; }
      relatorio.drive.versoes.push({ song, version, erro: e.message, noDrive: 0, noApp: 0, repetidos: [], sobrando: [] });
    }
  }
  return relatorio;
}

/** Apaga do aparelho as cópias que não pertencem a nenhuma faixa. */
export async function limparOrfas(orfas) {
  for (const o of orfas) await deleteTrack(o.versionId, o.trackId);
  return orfas.length;
}

/**
 * Tira da versão as faixas repetidas (fica a primeira de cada grupo), apaga a cópia do aparelho e manda para a
 * lixeira do Drive o arquivo extra, se ele não for o mesmo arquivo da faixa que ficou.
 */
export async function removerRepetidas(repetidas) {
  let n = 0;
  const falhas = [];
  for (const { song, version, manter, extras } of repetidas) {
    for (const t of extras) {
      try {
        await deleteTrack(version.id, t.id);
        if (t.driveFileId && t.driveFileId !== manter.driveFileId) await apagarDoDriveLixeira(t.driveFileId, song.ministryId);
        store.commit((s) => {
          for (const sg of s.songs) {
            const v = sg.versions.find((x) => x.id === version.id);
            if (v) v.tracks = v.tracks.filter((x) => x.id !== t.id);
          }
        }, { silent: true });
        n++;
      } catch (e) { falhas.push(`${song.title} — ${t.name}: ${e.message}`); }
    }
  }
  return { removidas: n, falhas };
}

/** Manda arquivos repetidos da pasta do Drive para a lixeira (recuperável por 30 dias). */
export async function limparRepetidosDoDrive(arquivos, ministryId = store.getState().session.ministryId) {
  let n = 0;
  const falhas = [];
  for (const f of arquivos) {
    try { await drive.paraLixeira(f.id, ministryId); n++; } catch (e) { falhas.push(`${f.name}: ${e.message}`); }
  }
  return { removidos: n, falhas };
}

async function apagarDoDriveLixeira(fileId, ministryId) {
  const st = await conectado(ministryId);
  if (st.conectado) await drive.paraLixeira(fileId, ministryId);
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
