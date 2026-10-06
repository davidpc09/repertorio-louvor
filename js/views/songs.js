import { el, clear, field, input, textarea, select, tagInput, toast, modal, confirmBox, uid, fmtDate, fmtDuration, normalize, pill, emptyState, daysBetween, today } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { go } from '../nav.js';
import { KEYS, normalizeKey, semitonesBetween, renderSheet, tempoLabel, transposeKey } from '../music.js';

// Filtros da lista ficam guardados enquanto a página estiver aberta
const filters = { q: '', themes: new Set(), services: new Set(), tempo: '', sort: 'az' };

export function renderSongs() {
  const s = store.getState();
  const songs = store.songsOfMinistry();
  const allThemes = [...new Set(songs.flatMap((x) => x.themes))].sort();
  const allServices = [...new Set(songs.flatMap((x) => x.services))].sort();
  const listBox = el('div');

  const draw = () => {
    clear(listBox);
    const q = normalize(filters.q);
    const t = today();
    let rows = songs.filter((song) => {
      if (q) {
        const hay = normalize([song.title, song.artist, song.composer, song.themes.join(' '), song.services.join(' '), song.versions.map((v) => v.keyMinistry + ' ' + v.name).join(' ')].join(' '));
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      if (filters.themes.size && !song.themes.some((x) => filters.themes.has(x))) return false;
      if (filters.services.size && !song.services.some((x) => filters.services.has(x))) return false;
      if (filters.tempo && tempoLabel(song.versions[0]?.bpm) !== filters.tempo) return false;
      return true;
    }).map((song) => ({ song, last: store.lastPlayed(song.id), n: store.playCount(song.id) }));
    if (filters.sort === 'az') rows.sort((a, b) => a.song.title.localeCompare(b.song.title, 'pt'));
    if (filters.sort === 'mais') rows.sort((a, b) => b.n - a.n);
    if (filters.sort === 'antigas') rows.sort((a, b) => (a.last || '').localeCompare(b.last || ''));
    if (filters.sort === 'recentes') rows.sort((a, b) => (b.last || '').localeCompare(a.last || ''));

    if (!rows.length) {
      listBox.appendChild(emptyState('Nenhuma música encontrada', songs.length ? 'Tente outra busca ou limpe os filtros.' : 'Cadastre a primeira música ou importe uma planilha.',
        store.canEditSongs() ? el('a', { class: 'btn primary', href: '#/musica/nova' }, 'Nova música') : null));
      return;
    }
    listBox.appendChild(el('p', { class: 'small muted', style: { margin: '0 0 8px' } }, `${rows.length} música${rows.length > 1 ? 's' : ''}`));
    listBox.appendChild(el('div', { class: 'list' }, rows.map(({ song, last, n }) => {
      const v = song.versions[0] || {};
      const stale = !last || daysBetween(last, t) > 60;
      return el('a', { class: 'list-item', href: '#/musica/' + song.id },
        el('span', { class: 'key-badge' }, v.keyMinistry || '—'),
        el('div', { class: 'grow' },
          el('div', { class: 'title' }, song.title),
          el('div', { class: 'sub' }, [song.artist, song.versions.length > 1 ? `${song.versions.length} versões` : null, song.themes.slice(0, 3).join(', ')].filter(Boolean).join(' · '))),
        el('div', { class: 'meta' },
          v.bpm ? el('span', { class: 'small muted num hide-sm' }, v.bpm + ' bpm') : null,
          el('span', { class: 'pill hide-sm' + (stale ? ' warn' : '') }, last ? `${n}× · ${fmtDate(last, false)}` : 'nunca tocada')));
    })));
  };

  const chipGroup = (label, items, set) => items.length ? el('div', { class: 'stack', style: { gap: '6px' } },
    el('span', { class: 'label' }, label),
    el('div', { class: 'chips' }, items.map((it) => {
      const b = el('button', { class: 'chip' + (set.has(it) ? ' on' : ''), onclick: () => { set.has(it) ? set.delete(it) : set.add(it); b.classList.toggle('on'); draw(); } }, it);
      return b;
    }))) : null;

  const searchInput = el('input', { type: 'search', placeholder: 'Buscar por título, artista, tema, tom…', value: filters.q, 'aria-label': 'Buscar músicas', oninput: (e) => { filters.q = e.target.value; draw(); } });
  const filtersBox = el('div', { class: 'card stack', hidden: !(filters.themes.size || filters.services.size || filters.tempo) },
    chipGroup('Temas', allThemes, filters.themes),
    chipGroup('Cultos propícios', allServices, filters.services),
    el('div', { class: 'row' },
      el('span', { class: 'label' }, 'Andamento'),
      select([['', 'Qualquer'], ['lenta', 'Lenta (< 76)'], ['moderada', 'Moderada'], ['rápida', 'Rápida (110+)']], filters.tempo, { style: { width: 'auto' }, onchange: (e) => { filters.tempo = e.target.value; draw(); } }),
      el('button', { class: 'btn small ghost', onclick: () => { filters.themes.clear(); filters.services.clear(); filters.tempo = ''; go('/musicas'); } }, 'Limpar filtros')));

  draw();
  void s;
  return el('div', null,
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Músicas'), el('p', null, 'Repertório do ' + (store.currentMinistry()?.name || 'ministério'))),
      store.canEditSongs() ? el('a', { class: 'btn primary', href: '#/musica/nova' }, icon('plus'), 'Nova música') : null),
    el('div', { class: 'row', style: { marginBottom: '12px' } },
      el('div', { class: 'search' }, icon('search'), searchInput),
      select([['az', 'A–Z'], ['mais', 'Mais tocadas'], ['antigas', 'Há mais tempo sem tocar'], ['recentes', 'Tocadas recentemente']], filters.sort, { style: { width: 'auto' }, 'aria-label': 'Ordenar', onchange: (e) => { filters.sort = e.target.value; draw(); } }),
      el('button', { class: 'btn', onclick: () => { filtersBox.hidden = !filtersBox.hidden; } }, 'Filtros')),
    filtersBox,
    el('div', { style: { marginTop: '12px' } }, listBox));
}

// ---------------- Detalhe ----------------
const detailState = { versionId: null, key: null, view: 'cifra' };

export function renderSongDetail(id) {
  const song = store.findSong(id);
  if (!song) return emptyState('Música não encontrada', 'Ela pode ter sido excluída.', el('a', { class: 'btn', href: '#/musicas' }, 'Voltar'));
  if (!song.versions.find((v) => v.id === detailState.versionId)) { detailState.versionId = song.versions[0]?.id; detailState.key = null; }
  const v = song.versions.find((x) => x.id === detailState.versionId) || song.versions[0];
  const base = v?.keyMinistry || v?.keyOriginal || '';
  const shown = detailState.key || base;
  const steps = base && shown ? semitonesBetween(base, shown) : 0;
  const s = store.getState();
  const canEdit = store.canEditSongs();
  const plays = s.executions.filter((e) => e.songId === song.id).sort((a, b) => b.date.localeCompare(a.date));

  const link = (label, url, ic) => url ? el('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon(ic), label)
    : el('span', { class: 'btn', style: { opacity: .45 }, title: 'Link ainda não cadastrado' }, icon(ic), label);

  const sheetBox = el('div');
  const drawSheet = () => {
    clear(sheetBox);
    const text = detailState.view === 'cifra' ? v?.chords : v?.lyrics;
    if (!text) {
      sheetBox.appendChild(emptyState(detailState.view === 'cifra' ? 'Sem cifra cadastrada' : 'Sem letra cadastrada',
        canEdit ? 'Cole a cifra ou a letra na edição da música.' : 'Peça ao administrador para cadastrar.', null));
      return;
    }
    const pre = renderSheet(text, detailState.view === 'cifra' ? steps : 0, shown);
    if (detailState.view === 'letra') pre.classList.add('wrap');
    sheetBox.appendChild(pre);
  };
  drawSheet();

  const keySelect = select(KEYS.filter((k) => !base || /m$/.test(base) === /m$/.test(k)), shown, { style: { width: 'auto' }, 'aria-label': 'Tom exibido',
    onchange: (e) => { detailState.key = e.target.value; go('/musica/' + song.id); } });

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('a', { href: '#/musicas', class: 'small row', style: { gap: '4px' } }, icon('back', 16), 'Músicas'),
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' },
        el('h1', null, song.title),
        el('p', null, [song.artist, song.composer && song.composer !== song.artist ? 'comp. ' + song.composer : null].filter(Boolean).join(' · '))),
      el('div', { class: 'row' },
        v ? el('a', { class: 'btn primary', href: '#/player/' + v.id }, icon('headphones'), 'Ensaiar no player') : null,
        canEdit ? el('a', { class: 'btn', href: '#/musica/' + song.id + '/editar' }, icon('edit'), 'Editar') : null,
        !canEdit ? el('button', { class: 'btn', onclick: () => suggestDialog(song) }, 'Sugerir alteração') : null)),

    el('div', { class: 'row' },
      song.themes.map((t) => pill(t, 'accent')),
      song.services.map((t) => pill(t))),

    song.versions.length > 1 ? el('div', { class: 'tabs' }, song.versions.map((x) => el('button', { class: x.id === v.id ? 'on' : '', onclick: () => { detailState.versionId = x.id; detailState.key = null; go('/musica/' + song.id); } }, x.name || 'Versão'))) : null,

    v ? el('div', { class: 'grid3' },
      info('Tom do ministério', el('span', { class: 'key-badge' }, v.keyMinistry || '—'), v.keyOriginal && v.keyOriginal !== v.keyMinistry ? ` original ${v.keyOriginal}` : ''),
      info('Andamento', v.bpm ? `${v.bpm} bpm` : '—', v.bpm ? ` ${tempoLabel(v.bpm)} · ${v.timeSig}` : ''),
      info('Duração', fmtDuration(v.durationSec)),
      info('Tocada', `${plays.length}×`, plays[0] ? ' · última ' + fmtDate(plays[0].date, false) : '')) : null,

    v && v.singerKeys.length ? el('div', { class: 'card' },
      el('span', { class: 'label' }, 'Tom por cantor'),
      el('div', { class: 'row', style: { marginTop: '8px' } }, v.singerKeys.map((sk) => el('button', { class: 'chip', onclick: () => { detailState.key = sk.key; go('/musica/' + song.id); } }, `${store.userName(sk.userId)}: ${sk.key}`)))) : null,

    el('div', { class: 'row' },
      link('VS / multipista', v?.linkVS, 'folder'),
      link('Ouvir instrumental', v?.linkInstrumental, 'headphones'),
      link('Ouvir vozes', v?.linkVozes, 'headphones'),
      link('Referência', v?.youtube, 'play')),

    el('section', { class: 'stack' },
      el('div', { class: 'row', style: { justifyContent: 'space-between' } },
        el('div', { class: 'tabs', style: { marginBottom: 0, borderBottom: 0 } },
          el('button', { class: detailState.view === 'cifra' ? 'on' : '', onclick: () => { detailState.view = 'cifra'; go('/musica/' + song.id); } }, 'Cifra'),
          el('button', { class: detailState.view === 'letra' ? 'on' : '', onclick: () => { detailState.view = 'letra'; go('/musica/' + song.id); } }, 'Letra')),
        detailState.view === 'cifra' ? el('div', { class: 'row' },
          el('span', { class: 'small muted' }, 'Tom'),
          el('button', { class: 'btn small', 'aria-label': 'Meio tom abaixo', onclick: () => { detailState.key = transposeKey(shown, -1); go('/musica/' + song.id); } }, '−½'),
          keySelect,
          el('button', { class: 'btn small', 'aria-label': 'Meio tom acima', onclick: () => { detailState.key = transposeKey(shown, 1); go('/musica/' + song.id); } }, '+½')) : null),
      sheetBox),

    v && v.sections.length ? el('section', { class: 'card' },
      el('span', { class: 'label' }, 'Cues (compassos)'),
      el('div', { class: 'row', style: { marginTop: '8px' } }, v.sections.map((p) => pill(`${p.name} ${p.startBar}–${p.endBar}`))),
      (v.arrangement || []).length ? el('p', { class: 'small', style: { marginTop: '10px' } }, el('b', null, 'Mapa: '),
        v.arrangement.map((st) => { const c = v.sections.find((x) => x.id === st.sectionId); return c ? c.name + ((st.repeats || 1) > 1 ? ` ×${st.repeats}` : '') : null; }).filter(Boolean).join(' → ')) : null) : null,

    song.notes ? el('section', { class: 'card' }, el('span', { class: 'label' }, 'Observações'), el('p', { style: { marginTop: '6px' } }, song.notes)) : null,

    plays.length ? el('section', { class: 'card' },
      el('span', { class: 'label' }, 'Histórico'),
      el('div', { class: 'row', style: { marginTop: '8px' } }, plays.slice(0, 12).map((e) => e.setlistId ? el('a', { href: '#/setlist/' + e.setlistId, class: 'pill' }, fmtDate(e.date, false)) : el('span', { class: 'pill' }, fmtDate(e.date, false))))) : null);
}

function info(label, value, extra = '') {
  return el('div', { class: 'card stat' }, el('span', { class: 'label' }, label), el('div', null, el('b', { style: { fontSize: '1.1rem' } }, value), el('span', { class: 'small muted' }, extra)));
}

function suggestDialog(song) {
  const ta = textarea({ placeholder: 'Ex.: o tom ficou alto para a Ana; o refrão repete 2 vezes no final…', style: { minHeight: '120px' } });
  modal({
    title: 'Sugerir alteração',
    body: [el('p', { class: 'small muted' }, `Sua sugestão sobre "${song.title}" vai para o administrador aprovar.`), field('Sugestão', ta)],
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      { label: 'Enviar', kind: 'primary', onClick: () => {
        if (!ta.value.trim()) { toast('Escreva a sugestão antes de enviar.', 'bad'); return true; }
        store.commit((s) => s.suggestions.push({ id: uid('sg'), ministryId: song.ministryId, songId: song.id, userId: store.currentUser().id, text: ta.value.trim(), status: 'pendente', createdAt: new Date().toISOString() }));
        toast('Sugestão enviada');
      } },
    ],
  });
}

// ---------------- Edição ----------------
export function renderSongEdit(id) {
  if (!store.canEditSongs()) return emptyState('Sem permissão para editar', 'Você pode sugerir alterações na página da música.', el('a', { class: 'btn', href: id ? '#/musica/' + id : '#/musicas' }, 'Voltar'));
  const existing = id ? store.findSong(id) : null;
  if (id && !existing) return emptyState('Música não encontrada', '', null);
  const draft = JSON.parse(JSON.stringify(existing || store.newSong()));
  const s = store.getState();
  const settings = s.settings;
  const members = store.membersOfMinistry();

  const title = input({ value: draft.title, required: true, placeholder: 'Ex.: Bondade de Deus' });
  const artist = input({ value: draft.artist, placeholder: 'Artista da gravação de referência' });
  const composer = input({ value: draft.composer, placeholder: 'Compositor(es)' });
  const themes = tagInput(draft.themes, settings.themes, { placeholder: 'Adoração; Gratidão' });
  const services = tagInput(draft.services, settings.serviceTypes, { placeholder: 'Domingo manhã; Santa Ceia' });
  const notes = textarea({ value: draft.notes, style: { minHeight: '70px' } });

  const versionsBox = el('div', { class: 'stack' });
  const drawVersions = () => {
    clear(versionsBox);
    draft.versions.forEach((v, idx) => versionsBox.appendChild(versionEditor(v, idx)));
  };

  function versionEditor(v, idx) {
    const bind = (key, inp, map = (x) => x) => { inp.addEventListener('input', () => { v[key] = map(inp.value); }); return inp; };
    const num = (x) => (x === '' ? null : Number(x));
    const keyList = ['', ...KEYS];
    const durMin = input({ value: v.durationSec ? `${Math.floor(v.durationSec / 60)}:${String(v.durationSec % 60).padStart(2, '0')}` : '', placeholder: '4:30' });
    durMin.addEventListener('input', () => { const m = durMin.value.match(/^(\d+):(\d{1,2})$/); v.durationSec = m ? Number(m[1]) * 60 + Number(m[2]) : (Number(durMin.value) || null); });

    const sectionsBox = el('div', { class: 'stack', style: { gap: '6px' } });
    const drawSections = () => {
      clear(sectionsBox);
      v.sections.forEach((p, i) => {
        sectionsBox.appendChild(el('div', { class: 'row' },
          (() => { const a = input({ value: p.name, style: { flex: '2 1 120px', width: 'auto' }, 'aria-label': 'Nome da parte', list: 'sec-names' }); a.addEventListener('input', () => { p.name = a.value; }); return a; })(),
          (() => { const a = el('input', { type: 'number', min: 1, value: p.startBar, style: { width: '80px' }, 'aria-label': 'Compasso inicial' }); a.addEventListener('input', () => { p.startBar = Number(a.value) || 1; }); return a; })(),
          el('span', { class: 'muted' }, 'até'),
          (() => { const a = el('input', { type: 'number', min: 1, value: p.endBar, style: { width: '80px' }, 'aria-label': 'Compasso final' }); a.addEventListener('input', () => { p.endBar = Number(a.value) || p.startBar; }); return a; })(),
          el('button', { class: 'icon-btn', 'aria-label': 'Remover parte', onclick: () => { v.sections.splice(i, 1); drawSections(); } }, '×')));
      });
      sectionsBox.appendChild(el('button', { class: 'btn small', onclick: () => {
        const last = v.sections[v.sections.length - 1];
        const start = last ? last.endBar + 1 : 1;
        v.sections.push({ id: uid('p'), name: '', startBar: start, endBar: start + 7 });
        drawSections();
      } }, icon('plus'), 'Adicionar parte'));
    };
    drawSections();

    const singerBox = el('div', { class: 'stack', style: { gap: '6px' } });
    const drawSingers = () => {
      clear(singerBox);
      v.singerKeys.forEach((sk, i) => singerBox.appendChild(el('div', { class: 'row' },
        select(members.map((m) => [m.id, m.name]), sk.userId, { style: { flex: '2 1 140px', width: 'auto' }, onchange: (e) => { sk.userId = e.target.value; } }),
        select(KEYS, sk.key, { style: { width: '90px' }, onchange: (e) => { sk.key = e.target.value; } }),
        el('button', { class: 'icon-btn', 'aria-label': 'Remover', onclick: () => { v.singerKeys.splice(i, 1); drawSingers(); } }, '×'))));
      singerBox.appendChild(el('button', { class: 'btn small', onclick: () => { v.singerKeys.push({ userId: members[0]?.id, key: v.keyMinistry || 'C' }); drawSingers(); } }, icon('plus'), 'Tom de um cantor'));
    };
    drawSingers();

    return el('section', { class: 'card stack' },
      el('div', { class: 'card-head' },
        el('h2', null, `Versão ${idx + 1}`),
        draft.versions.length > 1 ? el('button', { class: 'btn small danger', onclick: async () => {
          if (await confirmBox('Remover versão', `Remover a versão "${v.name}"?`, 'Remover', true)) { draft.versions.splice(idx, 1); drawVersions(); }
        } }, icon('trash'), 'Remover') : null),
      el('div', { class: 'form-grid' },
        field('Nome da versão', bind('name', input({ value: v.name, placeholder: 'Original, Acústica…' }))),
        field('Tom original', bind('keyOriginal', select(keyList, v.keyOriginal))),
        field('Tom do ministério', bind('keyMinistry', select(keyList, v.keyMinistry))),
        field('BPM', bind('bpm', el('input', { type: 'number', min: 30, max: 260, value: v.bpm ?? '' }), num)),
        field('Compasso', bind('timeSig', select(['4/4', '3/4', '6/8', '2/4', '12/8'], v.timeSig))),
        field('Duração', durMin, 'minutos:segundos')),
      el('div', { class: 'form-grid' },
        field('Link VS / multipista', bind('linkVS', input({ type: 'url', value: v.linkVS, placeholder: 'https://drive.google.com/…' }))),
        field('Link instrumental', bind('linkInstrumental', input({ type: 'url', value: v.linkInstrumental, placeholder: 'https://drive.google.com/…' }))),
        field('Link vozes', bind('linkVozes', input({ type: 'url', value: v.linkVozes, placeholder: 'https://drive.google.com/…' }))),
        field('Referência (YouTube/Spotify)', bind('youtube', input({ type: 'url', value: v.youtube, placeholder: 'https://youtube.com/…' })))),
      field('Cifra', bind('chords', textarea({ class: 'mono', value: v.chords, placeholder: 'Cole a cifra com os acordes acima da letra.\n\n[Refrão]\nC        D        G\nTexto da letra…' })),
        'Acordes acima da letra ou entre colchetes, como [G]. A transposição é automática.'),
      field('Letra', bind('lyrics', textarea({ value: v.lyrics, style: { minHeight: '160px' } }))),
      el('div', { class: 'grid2' },
        el('div', { class: 'stack', style: { gap: '6px' } }, el('span', { class: 'label' }, 'Partes (para o player)'), sectionsBox),
        el('div', { class: 'stack', style: { gap: '6px' } }, el('span', { class: 'label' }, 'Tom por cantor'), singerBox)));
  }
  drawVersions();

  const save = () => {
    if (!title.value.trim()) { toast('Informe o título da música.', 'bad'); title.focus(); return; }
    draft.title = title.value.trim();
    draft.artist = artist.value.trim();
    draft.composer = composer.value.trim();
    draft.themes = themes.getValues();
    draft.services = services.getValues();
    draft.notes = notes.value.trim();
    draft.updatedAt = new Date().toISOString();
    draft.versions.forEach((v) => { v.keyOriginal = normalizeKey(v.keyOriginal); v.keyMinistry = normalizeKey(v.keyMinistry) || v.keyOriginal; });
    const dup = store.songsOfMinistry().find((x) => x.id !== draft.id && normalize(x.title) === normalize(draft.title) && normalize(x.artist) === normalize(draft.artist));
    if (dup) { toast('Já existe uma música com esse título e artista.', 'bad'); return; }
    store.commit((st) => {
      const i = st.songs.findIndex((x) => x.id === draft.id);
      if (i >= 0) st.songs[i] = draft; else st.songs.push(draft);
      // novos temas/cultos entram nas sugestões
      for (const t of draft.themes) if (!st.settings.themes.includes(t)) st.settings.themes.push(t);
      for (const t of draft.services) if (!st.settings.serviceTypes.includes(t)) st.settings.serviceTypes.push(t);
    }, { silent: true });
    toast('Música salva');
    go('/musica/' + draft.id);
  };

  const remove = async () => {
    if (!(await confirmBox('Excluir música', `Excluir "${draft.title}" e todo o histórico dela? Isso não pode ser desfeito.`, 'Excluir', true))) return;
    store.commit((st) => {
      st.songs = st.songs.filter((x) => x.id !== draft.id);
      st.executions = st.executions.filter((e) => e.songId !== draft.id);
      for (const sl of st.setlists) sl.items = sl.items.filter((it) => it.songId !== draft.id);
    }, { silent: true });
    toast('Música excluída');
    go('/musicas');
  };

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('datalist', { id: 'sec-names' }, ['Intro', 'Verso 1', 'Verso 2', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Interlúdio', 'Refrão final', 'Final'].map((n) => el('option', { value: n }))),
    el('a', { href: existing ? '#/musica/' + existing.id : '#/musicas', class: 'small row', style: { gap: '4px' } }, icon('back', 16), existing ? existing.title : 'Músicas'),
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, existing ? 'Editar música' : 'Nova música')),
      el('div', { class: 'row' },
        existing && store.isAdmin() ? el('button', { class: 'btn danger', onclick: remove }, icon('trash'), 'Excluir') : null,
        el('button', { class: 'btn primary', onclick: save }, icon('check'), 'Salvar'))),
    el('section', { class: 'card stack' },
      el('div', { class: 'form-grid' },
        el('div', { class: 'span2' }, field('Título', title)),
        field('Artista', artist),
        field('Compositor', composer)),
      el('div', { class: 'form-grid' },
        field('Temas / palavras-chave', themes, 'Separe com ponto e vírgula'),
        field('Cultos propícios', services, 'Separe com ponto e vírgula')),
      field('Observações', notes),
      el('p', { class: 'small muted' }, 'A pasta no Google Drive (VS, Instrumental, Vozes) é criada automaticamente na versão em nuvem. Por enquanto, cole os links abaixo.')),
    versionsBox,
    el('div', { class: 'row', style: { justifyContent: 'space-between' } },
      el('button', { class: 'btn', onclick: () => { draft.versions.push(store.newVersion({ name: 'Nova versão', keyOriginal: draft.versions[0]?.keyOriginal, bpm: draft.versions[0]?.bpm })); drawVersions(); } }, icon('plus'), 'Adicionar versão'),
      el('button', { class: 'btn primary', onclick: save }, icon('check'), 'Salvar')));
}
