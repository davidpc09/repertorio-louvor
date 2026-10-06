import { el, clear, field, input, textarea, select, toast, modal, confirmBox, uid, fmtDate, fmtDuration, normalize, pill, emptyState, today, daysBetween, downloadBlob } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { go } from '../nav.js';
import { KEYS, semitonesBetween, renderSheet, transposeKey } from '../music.js';

const STATUS_LABEL = { rascunho: 'rascunho', publicado: 'publicado', realizado: 'realizado' };
const STATUS_KIND = { rascunho: 'warn', publicado: 'ok', realizado: '' };

export function rosterStatusPill(status) {
  return pill(status === 'confirmado' ? 'confirmado' : status === 'recusado' ? 'não pode' : 'aguardando', status === 'confirmado' ? 'ok' : status === 'recusado' ? 'bad' : 'warn');
}

export function setRosterStatus(setlistId, rosterId, status) {
  store.commit((s) => {
    const r = s.setlists.find((x) => x.id === setlistId)?.roster.find((x) => x.id === rosterId);
    if (r) r.status = status;
  });
  toast(status === 'confirmado' ? 'Presença confirmada' : 'Resposta registrada');
}

// ---------------- Lista ----------------
export function renderSetlists() {
  const s = store.getState();
  const admin = store.isAdmin();
  const t = today();
  const all = s.setlists.filter((x) => x.ministryId === s.session.ministryId && (admin || x.status !== 'rascunho'));
  const upcoming = all.filter((x) => x.date >= t && x.status !== 'realizado').sort((a, b) => a.date.localeCompare(b.date));
  const past = all.filter((x) => !(x.date >= t && x.status !== 'realizado')).sort((a, b) => b.date.localeCompare(a.date));

  const row = (sl) => el('a', { class: 'list-item', href: '#/setlist/' + sl.id },
    el('div', { class: 'grow' },
      el('div', { class: 'title' }, fmtDate(sl.date), sl.time ? ' · ' + sl.time : ''),
      el('div', { class: 'sub' }, [sl.serviceType, sl.title, sl.theme ? 'tema: ' + sl.theme : null, sl.items.map((it) => store.findSong(it.songId)?.title).filter(Boolean).join(', ')].filter(Boolean).join(' · '))),
    el('div', { class: 'meta' }, el('span', { class: 'small muted hide-sm' }, `${sl.items.length} músicas`), pill(STATUS_LABEL[sl.status], STATUS_KIND[sl.status])));

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Setlists'), el('p', null, 'Cultos e ensaios do ' + (store.currentMinistry()?.name || 'ministério'))),
      admin ? el('button', { class: 'btn primary', onclick: newSetlistDialog }, icon('plus'), 'Novo setlist') : null),
    el('section', { class: 'stack' }, el('h2', null, 'Próximos'),
      upcoming.length ? el('div', { class: 'list' }, upcoming.map(row)) : emptyState('Nenhum setlist futuro', admin ? 'Crie o setlist do próximo culto.' : 'Quando o líder publicar, ele aparece aqui.', null)),
    past.length ? el('section', { class: 'stack' }, el('h2', null, 'Realizados'), el('div', { class: 'list' }, past.slice(0, 40).map(row))) : null);
}

function nextSunday() {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function newSetlistDialog() {
  const s = store.getState();
  const date = el('input', { type: 'date', value: nextSunday() });
  const time = el('input', { type: 'time', value: '18:00' });
  const type = select(s.settings.serviceTypes, 'Domingo noite');
  const title = input({ placeholder: 'Opcional, ex.: Culto de Missões' });
  const theme = input({ placeholder: 'Opcional, ex.: Gratidão', list: 'new-setlist-themes' });
  const prev = s.setlists.filter((x) => x.ministryId === s.session.ministryId).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  const copyFrom = select([['', 'Começar vazio'], ...prev.map((p) => [p.id, `Copiar de ${fmtDate(p.date, false)} (${p.items.length} músicas)`])], '');
  modal({
    title: 'Novo setlist',
    body: el('div', { class: 'form-grid' }, el('datalist', { id: 'new-setlist-themes' }, s.settings.themes.map((t) => el('option', { value: t }))), field('Data', date), field('Horário', time), field('Tipo de culto', type), field('Título', title), field('Tema', theme), el('div', { class: 'span2' }, field('Modelo', copyFrom))),
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      { label: 'Criar', kind: 'primary', onClick: () => {
        if (!date.value) { toast('Escolha a data.', 'bad'); return true; }
        const base = s.setlists.find((x) => x.id === copyFrom.value);
        const sl = {
          id: uid('sl'), ministryId: s.session.ministryId, date: date.value, time: time.value, serviceType: type.value, title: title.value.trim(), theme: theme.value.trim(),
          status: 'rascunho', notes: '', ministerId: store.currentUser().id,
          items: base ? base.items.map((it) => ({ ...it, id: uid('i') })) : [],
          roster: base ? base.roster.map((r) => ({ ...r, id: uid('r'), status: 'pendente' })) : [],
        };
        store.commit((st) => st.setlists.push(sl), { silent: true });
        go('/setlist/' + sl.id);
      } },
    ],
  });
}

// ---------------- Detalhe ----------------
export function renderSetlistDetail(id) {
  const s = store.getState();
  const sl = s.setlists.find((x) => x.id === id);
  if (!sl) return emptyState('Setlist não encontrado', '', el('a', { class: 'btn', href: '#/setlists' }, 'Voltar'));
  const admin = store.isAdmin() && sl.ministryId === s.session.ministryId;
  const me = store.currentUser();
  const update = (fn) => store.commit((st) => fn(st.setlists.find((x) => x.id === id)));

  // ---- Itens ----
  let total = 0;
  const itemsBox = el('div', { class: 'list' });
  if (!sl.items.length) itemsBox.appendChild(el('div', { class: 'list-item muted' }, admin ? 'Nenhuma música ainda. Use a busca abaixo para adicionar.' : 'Nenhuma música ainda.'));
  sl.items.forEach((it, i) => {
    const song = store.findSong(it.songId);
    const v = store.findVersion(it.songId, it.versionId);
    total += v?.durationSec || 0;
    const warnings = [];
    const recent = s.executions.filter((e) => e.songId === it.songId && e.setlistId !== sl.id && e.date < sl.date && daysBetween(e.date, sl.date) <= 14);
    if (recent.length) warnings.push(pill(`tocada há ${daysBetween(recent.sort((a, b) => b.date.localeCompare(a.date))[0].date, sl.date)} dias`, 'warn'));
    const prevIt = sl.items[i - 1];
    if (prevIt && prevIt.key && it.key) {
      const jump = Math.abs(semitonesBetween(prevIt.key, it.key));
      if (jump >= 5) warnings.push(pill(`salto de tom (${prevIt.key} → ${it.key})`, 'warn'));
    }
    const singerSuggest = v?.singerKeys.find((sk) => sk.userId === it.singerId);

    const controls = admin ? el('div', { class: 'controls' },
      song && song.versions.length > 1 ? select(song.versions.map((x) => [x.id, x.name]), it.versionId, { 'aria-label': 'Versão', onchange: (e) => update((x) => { const item = x.items[i]; item.versionId = e.target.value; item.key = store.findVersion(item.songId, item.versionId)?.keyMinistry || item.key; }) }) : null,
      select(KEYS, it.key, { 'aria-label': 'Tom do dia', onchange: (e) => update((x) => { x.items[i].key = e.target.value; }) }),
      select([['', 'Quem canta'], ...store.membersOfMinistry(sl.ministryId).map((m) => [m.id, m.name])], it.singerId || '', { 'aria-label': 'Quem ministra', onchange: (e) => update((x) => {
        const item = x.items[i]; item.singerId = e.target.value;
        const sk = v?.singerKeys.find((k) => k.userId === item.singerId);
        if (sk) { item.key = sk.key; toast(`Tom ajustado para ${sk.key} (${store.userName(sk.userId)})`); }
      }) }),
      el('button', { class: 'icon-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => update((x) => { [x.items[i - 1], x.items[i]] = [x.items[i], x.items[i - 1]]; }) }, icon('up', 18)),
      el('button', { class: 'icon-btn', 'aria-label': 'Descer', disabled: i === sl.items.length - 1, onclick: () => update((x) => { [x.items[i + 1], x.items[i]] = [x.items[i], x.items[i + 1]]; }) }, icon('down', 18)),
      el('button', { class: 'icon-btn', 'aria-label': 'Remover', onclick: () => update((x) => { x.items.splice(i, 1); }) }, icon('x', 18)))
      : el('div', { class: 'controls' }, el('span', { class: 'key-badge' }, it.key || '—'), v ? el('a', { class: 'btn small', href: '#/player/' + v.id }, icon('headphones'), 'Ensaiar') : null);

    itemsBox.appendChild(el('div', { class: 'setlist-item' },
      el('span', { class: 'pos' }, i + 1),
      el('div', { style: { minWidth: 0 } },
        el('a', { href: '#/musica/' + it.songId, style: { fontWeight: 600, color: 'inherit' } }, song?.title || 'Música removida'),
        el('div', { class: 'small muted' }, [v?.name !== 'Original' ? v?.name : null, it.singerId ? store.userName(it.singerId) : null, v?.bpm ? v.bpm + ' bpm' : null, fmtDuration(v?.durationSec), singerSuggest && singerSuggest.key !== it.key ? `${store.userName(it.singerId)} costuma cantar em ${singerSuggest.key}` : null].filter((x) => x && x !== '—').join(' · ')),
        admin ? (() => { const n = input({ value: it.note || '', placeholder: 'Observação (ex.: entrada só voz)', style: { marginTop: '6px', minHeight: '32px', padding: '4px 8px' } }); n.addEventListener('change', () => update((x) => { x.items[i].note = n.value; })); return n; })()
          : it.note ? el('div', { class: 'small' }, it.note) : null,
        warnings.length ? el('div', { class: 'row', style: { marginTop: '4px' } }, warnings) : null),
      controls));
  });

  // ---- Busca para adicionar ----
  const addBox = admin ? songPicker((song) => update((x) => {
    const v = song.versions[0];
    x.items.push({ id: uid('i'), songId: song.id, versionId: v?.id, key: v?.keyMinistry || '', singerId: x.ministerId || '', note: '' });
  }), sl) : null;

  // ---- Escala ----
  const rosterBox = renderRoster(sl, admin, me, update);

  // ---- Cabeçalho ----
  const headFields = admin ? (() => {
    const date = el('input', { type: 'date', value: sl.date });
    const time = el('input', { type: 'time', value: sl.time || '' });
    const type = select([...new Set([...s.settings.serviceTypes, sl.serviceType])], sl.serviceType);
    const title = input({ value: sl.title || '' });
    const minister = select([['', '—'], ...store.membersOfMinistry(sl.ministryId).map((m) => [m.id, m.name])], sl.ministerId || '');
    const notes = textarea({ value: sl.notes || '', style: { minHeight: '70px' }, placeholder: 'Ex.: ensaio sábado às 16h; chegar 1h antes; roupa preta' });
    const theme = input({ value: sl.theme || '', list: 'setlist-themes', placeholder: 'Ex.: Gratidão, Santa Ceia, Missões' });
    const saveHead = () => update((x) => { x.date = date.value || x.date; x.time = time.value; x.serviceType = type.value; x.title = title.value.trim(); x.ministerId = minister.value; x.theme = theme.value.trim(); x.notes = notes.value.trim(); });
    [date, time, type, title, minister, theme, notes].forEach((f) => f.addEventListener('change', saveHead));
    return el('section', { class: 'card stack' },
      el('datalist', { id: 'setlist-themes' }, s.settings.themes.map((t) => el('option', { value: t }))),
      el('div', { class: 'form-grid' }, field('Data', date), field('Horário', time), field('Tipo de culto', type), field('Título', title), field('Ministro responsável', minister)),
      field('Tema / mensagem do culto', theme),
      field('Observações para a equipe', notes));
  })() : ((sl.theme || sl.notes) ? el('div', { class: 'notice info stack', style: { gap: '4px' } },
    sl.theme ? el('div', null, el('b', null, 'Tema: '), sl.theme) : null,
    sl.notes ? el('div', { style: { whiteSpace: 'pre-wrap' } }, sl.notes) : null) : null);


  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('a', { href: '#/setlists', class: 'small row', style: { gap: '4px' } }, icon('back', 16), 'Setlists'),
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' },
        el('h1', null, sl.title || sl.serviceType),
        el('p', null, `${fmtDate(sl.date)}${sl.time ? ' · ' + sl.time : ''} · ${sl.items.length} músicas · ${fmtDuration(total)} estimado${sl.theme ? ' · tema: ' + sl.theme : ''}`)),
      pill(STATUS_LABEL[sl.status], STATUS_KIND[sl.status])),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', onclick: () => openWorshipMode(sl.id), disabled: !sl.items.length }, icon('screen'), 'Modo culto'),
      el('button', { class: 'btn', onclick: () => exportDialog(sl) }, icon('share'), 'Enviar / exportar'),
      admin && sl.status === 'rascunho' ? el('button', { class: 'btn', onclick: () => { update((x) => { x.status = 'publicado'; }); toast('Setlist publicado para a equipe'); } }, 'Publicar') : null,
      admin && sl.status !== 'realizado' ? el('button', { class: 'btn', onclick: () => { store.markSetlistDone(sl.id, true); toast('Registrado no histórico'); }, title: 'Conta as músicas nos relatórios' }, icon('check'), 'Marcar como realizado') : null,
      admin && sl.status === 'realizado' ? el('button', { class: 'btn', onclick: () => store.markSetlistDone(sl.id, false) }, 'Desfazer realizado') : null,
      admin ? el('button', { class: 'btn danger', onclick: async () => {
        if (!(await confirmBox('Excluir setlist', 'Excluir este setlist e o histórico dele?', 'Excluir', true))) return;
        store.commit((st) => { st.setlists = st.setlists.filter((x) => x.id !== sl.id); st.executions = st.executions.filter((e) => e.setlistId !== sl.id); }, { silent: true });
        go('/setlists');
      } }, icon('trash')) : null),
    headFields,
    el('section', { class: 'stack' }, el('h2', null, 'Músicas'), itemsBox, addBox),
    rosterBox);
}

// ---------------- Exportar / enviar ----------------
const EXPORT_OPTS = [
  ['keys', 'Tons'],
  ['singers', 'Quem canta'],
  ['itemNotes', 'Observações de cada música'],
  ['bpm', 'BPM'],
  ['links', 'Links de referência (YouTube)'],
  ['theme', 'Tema e observações do culto'],
  ['roster', 'Escala da equipe'],
];

function loadExportPrefs() {
  const d = { keys: true, singers: true, itemNotes: true, bpm: false, links: false, theme: true, roster: true, format: 'whatsapp' };
  try { return { ...d, ...JSON.parse(localStorage.getItem('repertorio-louvor.export') || '{}') }; } catch { return d; }
}

/** Texto do setlist. format: "whatsapp" (com *negrito*) ou "texto" (simples). */
export function setlistText(sl, o = loadExportPrefs()) {
  const b = (t) => (o.format === 'whatsapp' ? `*${t}*` : t.toUpperCase());
  const lines = [b(sl.title || sl.serviceType || 'Setlist'), `${fmtDate(sl.date)}${sl.time ? ' às ' + sl.time : ''}${sl.title && sl.serviceType ? ' · ' + sl.serviceType : ''}`];
  if (o.theme && sl.theme) lines.push(`Tema: ${sl.theme}`);
  lines.push('');
  sl.items.forEach((it, i) => {
    const song = store.findSong(it.songId);
    const v = store.findVersion(it.songId, it.versionId);
    const extra = [o.keys && it.key ? `Tom ${it.key}` : null, o.bpm && v?.bpm ? `${v.bpm} bpm` : null].filter(Boolean).join(' · ');
    lines.push(`${i + 1}. ${song?.title || 'Música removida'}${song?.artist ? ' (' + song.artist + ')' : ''}${extra ? ' — ' + extra : ''}`);
    if (o.singers && it.singerId) lines.push(`   Ministra: ${store.userName(it.singerId)}`);
    if (o.itemNotes && it.note) lines.push(`   Obs.: ${it.note}`);
    if (o.links && v?.youtube) lines.push(`   ${v.youtube}`);
  });
  if (o.roster && sl.roster.length) {
    lines.push('', b('Escala'));
    const byFunc = new Map();
    for (const r of sl.roster) {
      if (r.status === 'recusado') continue;
      if (!byFunc.has(r.func)) byFunc.set(r.func, []);
      byFunc.get(r.func).push(store.userName(r.userId));
    }
    for (const [f, names] of byFunc) lines.push(`${f}: ${names.join(', ')}`);
  }
  if (o.theme && sl.notes) lines.push('', b('Observações'), sl.notes);
  return lines.join('\n');
}

function exportDialog(sl) {
  const o = loadExportPrefs();
  const ta = el('textarea', { class: 'mono', style: { minHeight: '260px' }, 'aria-label': 'Texto do setlist' });
  const fill = () => { ta.value = setlistText(sl, o); try { localStorage.setItem('repertorio-louvor.export', JSON.stringify(o)); } catch { /* ok */ } };
  const checks = el('div', { class: 'chips' }, EXPORT_OPTS.map(([k, label]) => {
    const b = el('button', { type: 'button', class: 'chip' + (o[k] ? ' on' : ''), 'aria-pressed': String(!!o[k]), onclick: () => { o[k] = !o[k]; b.classList.toggle('on', o[k]); b.setAttribute('aria-pressed', String(o[k])); fill(); } }, label);
    return b;
  }));
  const fmt = el('div', { class: 'side-toggle', role: 'group', 'aria-label': 'Formato' }, [['whatsapp', 'WhatsApp'], ['texto', 'Texto simples']].map(([k, l]) => {
    const b = el('button', { type: 'button', class: o.format === k ? 'on' : '', onclick: () => { o.format = k; [...fmt.children].forEach((c) => c.classList.toggle('on', c === b)); fill(); } }, l);
    return b;
  }));
  fill();
  const name = `setlist-${sl.date}${sl.title ? '-' + sl.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-') : ''}.txt`;
  modal({
    title: 'Enviar setlist',
    wide: true,
    body: [
      el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Formato'), fmt),
      el('div', { class: 'stack', style: { gap: '6px' } }, el('span', { class: 'small muted' }, 'Incluir'), checks),
      ta,
      el('p', { class: 'small muted' }, 'Você pode editar o texto antes de enviar.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn primary', onclick: () => window.open('https://wa.me/?text=' + encodeURIComponent(ta.value), '_blank', 'noopener') }, icon('share', 16), 'Enviar pelo WhatsApp'),
        navigator.share ? el('button', { class: 'btn', onclick: () => navigator.share({ title: sl.title || 'Setlist', text: ta.value }).catch(() => {}) }, 'Compartilhar…') : null,
        el('button', { class: 'btn', onclick: () => copyText(ta.value) }, icon('copy', 16), 'Copiar'),
        el('button', { class: 'btn', onclick: () => { downloadBlob(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), name); toast('Arquivo salvo'); } }, icon('download', 16), 'Baixar .txt')),
    ],
  });
}

function copyText(text) {
  const done = () => toast('Texto copiado');
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text));
  else fallbackCopy(text);
}
function fallbackCopy(text) {
  const ta = el('textarea', { readonly: true, style: { minHeight: '220px' } }, text);
  modal({ title: 'Copie o texto', body: [el('p', { class: 'small muted' }, 'Selecione e copie:'), ta] });
  setTimeout(() => { ta.focus(); ta.select(); }, 50);
}

function songPicker(onPick, sl) {
  const results = el('div', { class: 'list' });
  const q = el('input', { type: 'search', placeholder: 'Buscar música para adicionar…', 'aria-label': 'Buscar música para adicionar' });
  const draw = () => {
    clear(results);
    const term = normalize(q.value);
    const inList = new Set(sl.items.map((x) => x.songId));
    const songs = store.songsOfMinistry(sl.ministryId)
      .filter((x) => !term || normalize(x.title + ' ' + x.artist + ' ' + x.themes.join(' ') + ' ' + x.services.join(' ')).includes(term))
      .sort((a, b) => {
        // sugere primeiro as que combinam com o tipo de culto
        const ma = a.services.includes(sl.serviceType) ? 0 : 1;
        const mb = b.services.includes(sl.serviceType) ? 0 : 1;
        return ma - mb || a.title.localeCompare(b.title, 'pt');
      }).slice(0, term ? 20 : 6);
    for (const song of songs) {
      const last = store.lastPlayed(song.id);
      results.appendChild(el('button', { class: 'list-item', style: { width: '100%', border: 0, borderTop: '1px solid var(--line)', background: 'var(--surface)', textAlign: 'left', cursor: 'pointer' }, disabled: inList.has(song.id), onclick: () => onPick(song) },
        el('span', { class: 'key-badge' }, song.versions[0]?.keyMinistry || '—'),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, song.title), el('div', { class: 'sub' }, [song.artist, song.services.includes(sl.serviceType) ? 'combina com ' + sl.serviceType : null, last ? 'última vez ' + fmtDate(last, false) : 'nunca tocada'].filter(Boolean).join(' · '))),
        inList.has(song.id) ? pill('no setlist') : icon('plus')));
    }
  };
  q.addEventListener('input', draw);
  draw();
  return el('div', { class: 'card stack' }, el('span', { class: 'label' }, 'Adicionar música'), el('div', { class: 'search' }, icon('search'), q), results);
}

function renderRoster(sl, admin, me, update) {
  const s = store.getState();
  const members = store.membersOfMinistry(sl.ministryId);
  const box = el('section', { class: 'stack' }, el('h2', null, 'Escala da equipe'));
  const list = el('div', { class: 'list' });
  if (!sl.roster.length) list.appendChild(el('div', { class: 'list-item muted' }, admin ? 'Ninguém escalado ainda.' : 'A escala ainda não foi definida.'));

  sl.roster.forEach((r, i) => {
    const user = s.users.find((u) => u.id === r.userId);
    const warns = [];
    if (user?.unavailable?.includes(sl.date)) warns.push(pill('marcou indisponível nesta data', 'bad'));
    const conflict = s.setlists.find((x) => x.id !== sl.id && x.date === sl.date && x.roster.some((rr) => rr.userId === r.userId));
    if (conflict) warns.push(pill(`também escalado em ${s.ministries.find((m) => m.id === conflict.ministryId)?.name}${conflict.time ? ' às ' + conflict.time : ''}`, 'warn'));
    const isMe = r.userId === me.id;

    list.appendChild(el('div', { class: 'list-item', style: { flexWrap: 'wrap' } },
      el('div', { class: 'grow', style: { minWidth: '160px' } },
        admin ? el('div', { class: 'row' },
          select(s.settings.functions, r.func, { style: { width: 'auto' }, 'aria-label': 'Função', onchange: (e) => update((x) => { x.roster[i].func = e.target.value; }) }),
          select(members.map((m) => [m.id, m.name]), r.userId, { style: { width: 'auto' }, 'aria-label': 'Pessoa', onchange: (e) => update((x) => { x.roster[i].userId = e.target.value; x.roster[i].status = 'pendente'; }) }))
          : el('div', null, el('b', null, r.func), ' · ', user?.name || '—'),
        warns.length ? el('div', { class: 'row', style: { marginTop: '4px' } }, warns) : null),
      el('div', { class: 'meta' },
        isMe && r.status !== 'confirmado' ? el('button', { class: 'btn small primary', onclick: () => setRosterStatus(sl.id, r.id, 'confirmado') }, 'Confirmar') : null,
        isMe && r.status !== 'recusado' ? el('button', { class: 'btn small', onclick: () => setRosterStatus(sl.id, r.id, 'recusado') }, 'Não posso') : null,
        admin && !isMe ? select([['pendente', 'aguardando'], ['confirmado', 'confirmado'], ['recusado', 'não pode']], r.status, { style: { width: 'auto' }, 'aria-label': 'Situação', onchange: (e) => update((x) => { x.roster[i].status = e.target.value; }) }) : rosterStatusPill(r.status),
        admin ? el('button', { class: 'icon-btn', 'aria-label': 'Remover da escala', onclick: () => update((x) => { x.roster.splice(i, 1); }) }, icon('x', 18)) : null)));
  });
  box.appendChild(list);

  if (admin) {
    const func = select(s.settings.functions, s.settings.functions[0], { style: { width: 'auto' } });
    const person = select(members.map((m) => [m.id, m.name + (m.unavailable?.includes(sl.date) ? ' (indisponível)' : '')]), members[0]?.id, { style: { width: 'auto' } });
    const syncPerson = () => {
      // sugere quem tem a função
      const withFunc = members.find((m) => m.functions.includes(func.value) && !sl.roster.some((r) => r.userId === m.id && r.func === func.value));
      if (withFunc) person.value = withFunc.id;
    };
    func.addEventListener('change', syncPerson);
    syncPerson();
    box.appendChild(el('div', { class: 'row' }, func, person,
      el('button', { class: 'btn', onclick: () => update((x) => { x.roster.push({ id: uid('r'), userId: person.value, func: func.value, status: 'pendente' }); }) }, icon('plus'), 'Escalar')));
    const pending = sl.roster.filter((r) => r.status === 'pendente').length;
    if (pending) box.appendChild(el('p', { class: 'small muted' }, `${pending} pessoa(s) ainda não responderam. Na versão em nuvem elas recebem aviso no celular e por e-mail.`));
  }
  return box;
}

// ---------------- Modo culto ----------------
export function openWorshipMode(setlistId) {
  const sl = store.getState().setlists.find((x) => x.id === setlistId);
  if (!sl || !sl.items.length) return;
  let idx = 0;
  let mode = 'cifra';
  let size = 1.15;
  try { size = Number(localStorage.getItem('repertorio-louvor.worshipSize')) || 1.15; } catch { /* ok */ }
  let wake = null;
  navigator.wakeLock?.request('screen').then((w) => { wake = w; }).catch(() => {});

  const body = el('div', { class: 'worship-body' });
  const title = el('div', { style: { flex: 1, minWidth: '140px' } });
  const counter = el('span', { class: 'small muted num' });
  const root = el('div', { class: 'worship', role: 'dialog', 'aria-label': 'Modo culto' },
    el('div', { class: 'worship-head' },
      title,
      el('div', { class: 'row' },
        el('button', { class: 'btn small', onclick: () => { mode = mode === 'cifra' ? 'letra' : 'cifra'; draw(); } }, 'Cifra / Letra'),
        el('button', { class: 'btn small', 'aria-label': 'Diminuir fonte', onclick: () => setSize(size - 0.1) }, 'A−'),
        el('button', { class: 'btn small', 'aria-label': 'Aumentar fonte', onclick: () => setSize(size + 0.1) }, 'A+'),
        el('button', { class: 'btn small', onclick: close }, 'Fechar'))),
    body,
    el('div', { class: 'worship-foot' },
      el('button', { class: 'btn', onclick: () => move(-1) }, icon('back'), 'Anterior'),
      counter,
      el('button', { class: 'btn primary', onclick: () => move(1) }, 'Próxima', icon('next'))));

  function setSize(v) {
    size = Math.min(2.4, Math.max(0.8, v));
    try { localStorage.setItem('repertorio-louvor.worshipSize', String(size)); } catch { /* ok */ }
    draw();
  }
  function move(d) { idx = Math.min(sl.items.length - 1, Math.max(0, idx + d)); draw(); body.scrollTop = 0; }
  function draw() {
    const it = sl.items[idx];
    const song = store.findSong(it.songId);
    const v = store.findVersion(it.songId, it.versionId);
    const base = v?.keyMinistry || v?.keyOriginal;
    const steps = base && it.key ? semitonesBetween(base, it.key) : 0;
    clear(title).append(el('b', { style: { fontSize: '1.1rem' } }, song?.title || ''), ' ', el('span', { class: 'key-badge' }, it.key || '—'),
      el('div', { class: 'small muted' }, [it.singerId ? store.userName(it.singerId) : null, v?.bpm ? v.bpm + ' bpm' : null, it.note].filter(Boolean).join(' · ')));
    counter.textContent = `${idx + 1} / ${sl.items.length}`;
    root.style.setProperty('--worship-size', size + 'rem');
    clear(body);
    const text = mode === 'cifra' ? (v?.chords || v?.lyrics) : (v?.lyrics || v?.chords);
    if (!text) body.appendChild(emptyState('Sem cifra ou letra', 'Cadastre na página da música.', null));
    else {
      const pre = renderSheet(text, mode === 'cifra' && v?.chords ? steps : 0, it.key);
      if (mode === 'letra') pre.classList.add('wrap');
      body.appendChild(pre);
    }
    const next = sl.items[idx + 1];
    if (next) body.appendChild(el('p', { class: 'small muted', style: { marginTop: '24px' } }, 'A seguir: ', store.findSong(next.songId)?.title || '', ' (', next.key || '?', ')'));
  }
  function onKey(e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') move(1);
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') move(-1);
    if (e.key === 'Escape') close();
  }
  function close() {
    root.remove();
    document.removeEventListener('keydown', onKey);
    wake?.release?.().catch(() => {});
    if (location.hash.endsWith('/culto')) location.hash = '#/setlist/' + sl.id;
  }
  // gesto de deslizar no celular
  let x0 = null;
  body.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  body.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 80) move(dx < 0 ? 1 : -1); x0 = null; });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(root);
  draw();
  void transposeKey;
}
