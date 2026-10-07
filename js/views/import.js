import { el, clear, select, toast, uid, normalize, splitList, emptyState, downloadBlob, pill } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { readSpreadsheet, autoMap, SONG_FIELDS, HISTORY_FIELDS, parseDate, buildTemplateXlsx } from '../importer.js';
import { normalizeKey } from '../music.js';

export function renderImport() {
  if (!store.canAddSongs()) return emptyState('Sem permissão', 'Peça ao administrador a permissão de adicionar músicas.', null);
  const canHistory = store.isAdmin();

  const state = { book: null, sheetIdx: 0, kind: 'songs', headerRow: 0, map: {}, dupMode: 'skip', createMissing: true };
  const stepBox = el('div', { class: 'stack', style: { gap: '16px' } });

  const fileInput = el('input', { type: 'file', accept: '.xlsx,.xls,.csv,.ods,.tsv,.txt', hidden: true, id: 'import-file' });
  const drop = el('label', { class: 'drop', for: 'import-file' },
    icon('upload', 28), el('b', null, 'Escolha ou arraste a planilha'), el('span', { class: 'small' }, '.xlsx, .csv ou .ods · arquivos .xls antigos precisam ser salvos como .xlsx'));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) load(fileInput.files[0]); });

  async function load(file) {
    clear(stepBox).appendChild(el('p', { class: 'muted' }, 'Lendo ' + file.name + '…'));
    try {
      const book = await readSpreadsheet(file);
      book.sheets = book.sheets.filter((s) => s.rows.length);
      if (!book.sheets.length) throw new Error('A planilha está vazia.');
      state.book = book;
      state.fileName = file.name;
      state.sheetIdx = 0;
      guessKind();
      drawMapping();
    } catch (e) {
      clear(stepBox).appendChild(el('div', { class: 'notice bad' }, e.message || String(e)));
    }
  }

  function sheet() { return state.book.sheets[state.sheetIdx]; }
  function header() { return sheet().rows[state.headerRow] || []; }
  function fields() { return state.kind === 'songs' ? SONG_FIELDS : HISTORY_FIELDS; }
  function guessKind() {
    const h = header().map(normalize);
    const hasDate = h.some((c) => ['data', 'dia', 'date'].includes(c));
    state.kind = canHistory && hasDate && h.length <= 6 ? 'history' : 'songs';
    state.map = autoMap(header(), fields());
  }

  function mappedRows() {
    const rows = sheet().rows.slice(state.headerRow + 1);
    return rows.map((r) => {
      const o = {};
      for (const f of fields()) o[f.key] = state.map[f.key] !== undefined ? (r[state.map[f.key]] || '').trim() : '';
      return o;
    });
  }

  function drawMapping() {
    clear(stepBox);
    const book = state.book;
    const h = header();
    const colOptions = [['', '— não importar —'], ...h.map((c, i) => [String(i), c ? `${c} (coluna ${String.fromCharCode(65 + (i % 26))})` : `Coluna ${String.fromCharCode(65 + (i % 26))}`])];
    const preview = mappedRows().slice(0, 5);

    stepBox.append(
      el('section', { class: 'card stack' },
        el('div', { class: 'card-head' }, el('h2', null, '2. Confira as colunas'), el('span', { class: 'small muted' }, `${state.fileName} · ${sheet().rows.length - 1 - state.headerRow} linhas`)),
        el('div', { class: 'form-grid' },
          book.sheets.length > 1 ? el('div', { class: 'field' }, el('label', null, 'Aba'), select(book.sheets.map((s, i) => [String(i), s.name]), String(state.sheetIdx), { onchange: (e) => { state.sheetIdx = Number(e.target.value); state.headerRow = 0; guessKind(); drawMapping(); } })) : null,
          el('div', { class: 'field' }, el('label', null, 'O que esta aba contém'), select(canHistory ? [['songs', 'Cadastro de músicas'], ['history', 'Histórico (músicas tocadas por data)']] : [['songs', 'Cadastro de músicas']], state.kind, { onchange: (e) => { state.kind = e.target.value; state.map = autoMap(header(), fields()); drawMapping(); } })),
          el('div', { class: 'field' }, el('label', null, 'Linha do cabeçalho'), select(sheet().rows.slice(0, 10).map((r, i) => [String(i), `Linha ${i + 1}: ${r.filter(Boolean).slice(0, 3).join(', ')}`]), String(state.headerRow), { onchange: (e) => { state.headerRow = Number(e.target.value); state.map = autoMap(header(), fields()); drawMapping(); } }))),
        el('div', { class: 'form-grid' },
          fields().map((f) => el('div', { class: 'field' },
            el('label', null, f.label + (f.required ? ' *' : '')),
            select(colOptions, state.map[f.key] !== undefined ? String(state.map[f.key]) : '', { onchange: (e) => { if (e.target.value === '') delete state.map[f.key]; else state.map[f.key] = Number(e.target.value); drawMapping(); } })))),
        el('p', { class: 'small muted' }, state.kind === 'songs' ? 'Temas e cultos podem vir na mesma célula separados por ponto e vírgula.' : 'Datas como 04/10/2026 ou 2026-10-04. Músicas são encontradas pelo título (e artista, se houver).')),
      el('section', { class: 'stack' },
        el('span', { class: 'label' }, 'Prévia das primeiras linhas'),
        el('div', { class: 'table-wrap' }, el('table', null,
          el('thead', null, el('tr', null, fields().filter((f) => state.map[f.key] !== undefined).map((f) => el('th', null, f.label)))),
          el('tbody', null, preview.map((r) => el('tr', null, fields().filter((f) => state.map[f.key] !== undefined).map((f) => el('td', null, r[f.key])))))))),
      analysisBox());
  }

  function analysisBox() {
    const missing = fields().filter((f) => f.required && state.map[f.key] === undefined && !(state.kind === 'songs' && f.key === 'artist'));
    if (missing.length) return el('div', { class: 'notice warn' }, 'Escolha a coluna de: ' + missing.map((f) => f.label).join(', '));
    const rows = mappedRows();
    const songs = store.songsOfMinistry();

    if (state.kind === 'songs') {
      let novas = 0; let dup = 0; let invalid = 0; let newVersions = 0;
      const seen = new Set();
      for (const r of rows) {
        if (!r.title) { invalid++; continue; }
        const k = normalize(r.title) + '|' + normalize(r.artist);
        const existing = songs.find((s) => normalize(s.title) === normalize(r.title) && (!r.artist || normalize(s.artist) === normalize(r.artist)));
        if (existing || seen.has(k)) {
          dup++;
          if (existing && r.version && !existing.versions.some((v) => normalize(v.name) === normalize(r.version))) newVersions++;
        } else novas++;
        seen.add(k);
      }
      return el('section', { class: 'card stack' },
        el('h2', null, '3. Importar'),
        el('div', { class: 'row' }, pill(`${novas} novas`, 'ok'), pill(`${dup} já existem`, dup ? 'warn' : ''), invalid ? pill(`${invalid} sem título (ignoradas)`, 'bad') : null),
        dup ? el('div', { class: 'field' }, el('label', null, 'Músicas que já existem'),
          select(store.canEditSongs() ? [['skip', 'Ignorar'], ['fill', 'Completar só os campos vazios'], ['version', `Criar nova versão quando a coluna Versão for diferente (${newVersions})`]] : [['skip', 'Ignorar (você não tem permissão para editar músicas)']], state.dupMode, { onchange: (e) => { state.dupMode = e.target.value; } })) : null,
        el('div', null, el('button', { class: 'btn primary', onclick: applySongs }, icon('check'), `Importar ${novas} músicas`)));
    }
    // histórico
    let ok = 0; let unknown = 0; let badDate = 0;
    const unknownTitles = new Set();
    for (const r of rows) {
      if (!r.title) continue;
      if (!parseDate(r.date)) { badDate++; continue; }
      if (findSong(songs, r)) ok++; else { unknown++; unknownTitles.add(r.title); }
    }
    const cb = el('input', { type: 'checkbox', checked: state.createMissing, id: 'create-missing', onchange: (e) => { state.createMissing = e.target.checked; } });
    return el('section', { class: 'card stack' },
      el('h2', null, '3. Importar histórico'),
      el('div', { class: 'row' }, pill(`${ok} execuções reconhecidas`, 'ok'), unknown ? pill(`${unknown} de músicas não cadastradas`, 'warn') : null, badDate ? pill(`${badDate} com data inválida (ignoradas)`, 'bad') : null),
      unknown ? el('label', { class: 'row small', for: 'create-missing' }, cb, `Cadastrar as ${unknownTitles.size} músicas que faltam`) : null,
      el('div', null, el('button', { class: 'btn primary', onclick: applyHistory }, icon('check'), 'Importar histórico')));
  }

  function findSong(songs, r) {
    return songs.find((s) => normalize(s.title) === normalize(r.title) && (!r.artist || normalize(s.artist) === normalize(r.artist)))
      || songs.find((s) => normalize(s.title) === normalize(r.title));
  }

  function applySongs() {
    const rows = mappedRows();
    let created = 0; let updated = 0; let versions = 0;
    store.commit((st) => {
      const mid = st.session.ministryId;
      for (const r of rows) {
        if (!r.title) continue;
        const pool = st.songs.filter((s) => s.ministryId === mid);
        const existing = pool.find((s) => normalize(s.title) === normalize(r.title) && (!r.artist || normalize(s.artist) === normalize(r.artist)));
        const vData = {
          name: r.version || 'Original', keyOriginal: normalizeKey(r.key), keyMinistry: normalizeKey(r.key),
          bpm: Number(String(r.bpm).replace(',', '.')) || null, timeSig: /^\d+\/\d+$/.test(r.timeSig) ? r.timeSig : '4/4', youtube: /^https?:/.test(r.youtube) ? r.youtube : '',
        };
        if (!existing) {
          st.songs.push(store.newSong({ ministryId: mid, title: r.title, artist: r.artist, composer: r.composer, notes: r.notes, themes: splitList(r.themes), services: splitList(r.services), versions: [store.newVersion(vData)] }));
          created++;
          continue;
        }
        if (state.dupMode === 'fill') {
          const v = existing.versions[0];
          if (!existing.composer && r.composer) existing.composer = r.composer;
          if (!existing.notes && r.notes) existing.notes = r.notes;
          if (!existing.themes.length) existing.themes = splitList(r.themes);
          if (!existing.services.length) existing.services = splitList(r.services);
          if (v) { if (!v.keyOriginal) v.keyOriginal = vData.keyOriginal; if (!v.keyMinistry) v.keyMinistry = vData.keyMinistry; if (!v.bpm) v.bpm = vData.bpm; if (!v.youtube) v.youtube = vData.youtube; }
          updated++;
        } else if (state.dupMode === 'version' && r.version && !existing.versions.some((v) => normalize(v.name) === normalize(r.version))) {
          existing.versions.push(store.newVersion(vData));
          versions++;
        }
      }
      for (const s of st.songs) for (const t of s.themes) if (!st.settings.themes.includes(t)) st.settings.themes.push(t);
    }, { silent: true });
    done(`${created} músicas cadastradas` + (updated ? `, ${updated} completadas` : '') + (versions ? `, ${versions} novas versões` : ''));
  }

  function applyHistory() {
    const rows = mappedRows();
    let count = 0; let createdSongs = 0;
    store.commit((st) => {
      const mid = st.session.ministryId;
      for (const r of rows) {
        const date = parseDate(r.date);
        if (!r.title || !date) continue;
        let song = findSong(st.songs.filter((s) => s.ministryId === mid), r);
        if (!song) {
          if (!state.createMissing) continue;
          song = store.newSong({ ministryId: mid, title: r.title, artist: r.artist || '', versions: [store.newVersion({ keyOriginal: normalizeKey(r.key), keyMinistry: normalizeKey(r.key) })] });
          st.songs.push(song);
          createdSongs++;
        }
        if (st.executions.some((e) => e.songId === song.id && e.date === date)) continue;
        st.executions.push({ id: uid('e'), ministryId: mid, songId: song.id, versionId: song.versions[0]?.id, setlistId: null, date, imported: true });
        count++;
      }
    }, { silent: true });
    done(`${count} execuções importadas` + (createdSongs ? ` e ${createdSongs} músicas cadastradas` : ''));
  }

  function done(msg) {
    toast('Importação concluída');
    clear(stepBox).append(
      el('div', { class: 'notice ok' }, msg + '.'),
      el('div', { class: 'row' }, el('a', { class: 'btn primary', href: '#/musicas' }, 'Ver músicas'), el('a', { class: 'btn', href: '#/relatorios' }, 'Ver relatórios'), el('button', { class: 'btn', onclick: () => { clear(stepBox); fileInput.value = ''; } }, 'Importar outra planilha')));
  }

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Importar planilha'), el('p', null, 'Traga o repertório e o histórico que vocês já têm em Excel, Google Planilhas ou LibreOffice.')),
      el('button', { class: 'btn', onclick: () => { downloadBlob(buildTemplateXlsx(), 'modelo-repertorio.xlsx'); toast('Modelo baixado'); } }, icon('download'), 'Baixar modelo')),
    el('section', { class: 'card stack' },
      el('h2', null, '1. Escolha o arquivo'),
      drop, fileInput,
      el('p', { class: 'small muted' }, 'Só Título e Artista são obrigatórios. Do Google Planilhas: Arquivo → Fazer download → Microsoft Excel (.xlsx).')),
    stepBox);
}
