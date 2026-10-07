import { el, fmtDate, today, daysBetween, pill } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { rosterStatusPill, setRosterStatus } from './setlists.js';
import { agendaItems, googleCalendarUrl } from '../calendar.js';

export function renderHome() {
  const s = store.getState();
  const me = store.currentUser();
  const mid = s.session.ministryId;
  const admin = store.isAdmin();
  const t = today();

  const upcoming = s.setlists
    .filter((x) => x.ministryId === mid && x.date >= t && x.status !== 'realizado' && (admin || x.status === 'publicado'))
    .sort((a, b) => a.date.localeCompare(b.date));
  const next = upcoming[0];

  // Minhas escalas em todos os ministérios
  const myRoster = [];
  for (const sl of s.setlists) {
    if (sl.date < t || sl.status === 'rascunho') continue;
    for (const r of sl.roster) if (r.userId === me.id) myRoster.push({ sl, r });
  }
  myRoster.sort((a, b) => a.sl.date.localeCompare(b.sl.date));

  const songs = store.songsOfMinistry();
  const from90 = new Date(); from90.setDate(from90.getDate() - 90);
  const from = from90.toISOString().slice(0, 10);
  const counts = songs.map((song) => ({ song, n: store.playCount(song.id, from, t), last: store.lastPlayed(song.id) }));
  const top = [...counts].sort((a, b) => b.n - a.n).filter((x) => x.n > 0).slice(0, 4);
  const forgotten = counts.filter((x) => !x.last || daysBetween(x.last, t) > 60).slice(0, 4);
  const suggestions = admin ? s.suggestions.filter((x) => x.status === 'pendente' && store.findSong(x.songId)?.ministryId === mid) : [];

  return el('div', { class: 'stack', style: { gap: '20px' } },
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' },
        el('h1', null, `Olá, ${me.name.replace(/\s*\(.*\)/, '')}`),
        el('p', null, store.currentMinistry()?.name + ' · ' + fmtDate(t))),
      admin ? el('a', { class: 'btn primary', href: '#/setlists' }, icon('plus'), 'Novo setlist') : null),

    el('div', { class: 'grid2' },
      el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', null, 'Próximo culto'), next ? pill(next.status, next.status === 'publicado' ? 'ok' : 'warn') : null),
        next ? el('div', { class: 'stack' },
          el('div', null, el('b', null, fmtDate(next.date)), ' · ', next.time || '', ' · ', next.serviceType),
          el('ol', { style: { margin: 0, paddingLeft: '20px' } },
            next.items.map((it) => {
              const song = store.findSong(it.songId);
              return el('li', null, song?.title || '—', ' ', el('span', { class: 'key-badge' }, it.key || '—'));
            })),
          el('div', { class: 'row' },
            el('a', { class: 'btn', href: '#/setlist/' + next.id }, 'Abrir setlist'),
            el('a', { class: 'btn', href: '#/setlist/' + next.id + '/culto' }, icon('screen'), 'Modo culto')))
          : el('p', { class: 'muted' }, admin ? 'Nenhum setlist futuro. Crie um em Setlists.' : 'Nenhum setlist publicado ainda.')),

      el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', null, 'Minhas escalas')),
        myRoster.length ? el('div', { class: 'stack' },
          myRoster.slice(0, 5).map(({ sl, r }) => el('div', { class: 'row', style: { justifyContent: 'space-between' } },
            el('a', { href: '#/setlist/' + sl.id, style: { color: 'inherit' } },
              el('b', null, fmtDate(sl.date)), el('br'),
              el('span', { class: 'small muted' }, `${r.func} · ${s.ministries.find((m) => m.id === sl.ministryId)?.name}`)),
            r.status === 'pendente'
              ? el('div', { class: 'row' },
                el('button', { class: 'btn small primary', onclick: () => setRosterStatus(sl.id, r.id, 'confirmado') }, 'Confirmar'),
                el('button', { class: 'btn small', onclick: () => setRosterStatus(sl.id, r.id, 'recusado') }, 'Não posso'))
              : rosterStatusPill(r.status))))
          : el('p', { class: 'muted' }, 'Você não está escalado nas próximas datas.'))),

    (() => {
      const evs = agendaItems({ from: t }).filter((x) => x.kind === 'event').slice(0, 3);
      return el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', null, 'Próximos compromissos'), el('a', { href: '#/agenda', class: 'small' }, 'Agenda')),
        evs.length ? el('div', { class: 'stack', style: { gap: '8px' } }, evs.map((it) => el('div', { class: 'row', style: { justifyContent: 'space-between' } },
          el('div', null, el('b', null, it.title), el('br'), el('span', { class: 'small muted' }, [fmtDate(it.date), it.start, it.location].filter(Boolean).join(' · '))),
          el('a', { class: 'btn small', href: googleCalendarUrl(it), target: '_blank', rel: 'noopener', title: 'Adicionar ao Google Agenda' }, icon('calendar', 16), 'Agenda'))))
          : el('p', { class: 'muted' }, 'Nenhum ensaio ou reunião marcado.'));
    })(),

    el('div', { class: 'grid3' },
      stat('Músicas no repertório', songs.length),
      stat('Cultos registrados', s.setlists.filter((x) => x.ministryId === mid && x.status === 'realizado').length),
      stat('Sem tocar há 60+ dias', counts.filter((x) => !x.last || daysBetween(x.last, t) > 60).length)),

    el('div', { class: 'grid2' },
      el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', null, 'Mais tocadas (90 dias)'), el('a', { href: '#/relatorios', class: 'small' }, 'Relatórios')),
        top.length ? el('div', { class: 'stack', style: { gap: '6px' } }, top.map((x) => el('a', { href: '#/musica/' + x.song.id, class: 'row', style: { justifyContent: 'space-between', color: 'inherit', textDecoration: 'none' } },
          el('span', null, x.song.title), el('b', { class: 'num' }, x.n + '×'))))
          : el('p', { class: 'muted' }, 'Ainda sem histórico.')),
      el('section', { class: 'card' },
        el('div', { class: 'card-head' }, el('h2', null, 'Esquecidas'), el('span', { class: 'small muted' }, 'boas para voltar ao repertório')),
        forgotten.length ? el('div', { class: 'stack', style: { gap: '6px' } }, forgotten.map((x) => el('a', { href: '#/musica/' + x.song.id, class: 'row', style: { justifyContent: 'space-between', color: 'inherit', textDecoration: 'none' } },
          el('span', null, x.song.title), el('span', { class: 'small muted' }, x.last ? 'última: ' + fmtDate(x.last, false) : 'nunca tocada'))))
          : el('p', { class: 'muted' }, 'Nenhuma música esquecida.'))),

    suggestions.length ? el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('h2', null, `Sugestões para revisar (${suggestions.length})`), el('a', { href: '#/mais', class: 'small' }, 'Ver todas')),
      suggestions.slice(0, 3).map((sg) => el('p', { class: 'small' }, el('b', null, store.userName(sg.userId)), ' sobre ', el('a', { href: '#/musica/' + sg.songId }, store.findSong(sg.songId)?.title), ': ', sg.text)))
      : null);
}

function stat(label, value) {
  return el('div', { class: 'card stat' }, el('span', { class: 'label' }, label), el('b', null, value));
}
