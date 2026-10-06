import { el, clear, select, fmtDate, today, daysBetween, downloadBlob, toast, emptyState } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { makeXlsx } from '../importer.js';

const rep = { period: '90', forgottenWeeks: 8 };

export function renderReports() {
  const box = el('div', { class: 'stack', style: { gap: '18px' } });
  const body = el('div', { class: 'stack', style: { gap: '18px' } });
  const draw = () => { clear(body).append(...build()); };

  box.append(
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Relatórios'), el('p', null, 'Baseados nos setlists marcados como realizados e no histórico importado.')),
      el('div', { class: 'row' },
        select([['30', 'Últimos 30 dias'], ['90', 'Últimos 3 meses'], ['180', 'Últimos 6 meses'], ['365', 'Último ano'], ['all', 'Todo o período']], rep.period, { style: { width: 'auto' }, 'aria-label': 'Período', onchange: (e) => { rep.period = e.target.value; draw(); } }),
        el('button', { class: 'btn', onclick: exportXlsx }, icon('download'), 'Exportar'))),
    body);
  draw();
  return box;
}

function range() {
  const t = today();
  if (rep.period === 'all') return { from: null, to: t };
  const d = new Date(); d.setDate(d.getDate() - Number(rep.period));
  return { from: d.toISOString().slice(0, 10), to: t };
}

function compute() {
  const s = store.getState();
  const mid = s.session.ministryId;
  const { from, to } = range();
  const ex = s.executions.filter((e) => e.ministryId === mid && (!from || e.date >= from) && e.date <= to);
  const songs = store.songsOfMinistry();
  const rows = songs.map((song) => {
    const mine = ex.filter((e) => e.songId === song.id);
    return { song, n: mine.length, last: store.lastPlayed(song.id) };
  });
  const cultos = s.setlists.filter((x) => x.ministryId === mid && x.status === 'realizado' && (!from || x.date >= from) && x.date <= to);
  return { s, ex, rows, cultos, from, to };
}

function build() {
  const { s, ex, rows, cultos, from, to } = compute();
  if (!rows.length) return [emptyState('Sem músicas cadastradas', 'Cadastre ou importe músicas para ver os relatórios.', null)];
  const t = today();
  const played = rows.filter((r) => r.n > 0).sort((a, b) => b.n - a.n || a.song.title.localeCompare(b.song.title, 'pt'));
  const least = [...played].sort((a, b) => a.n - b.n || (a.last || '').localeCompare(b.last || '')).slice(0, 8);
  const never = rows.filter((r) => !r.last);
  const forgotten = rows.filter((r) => r.last && daysBetween(r.last, t) > rep.forgottenWeeks * 7).sort((a, b) => a.last.localeCompare(b.last));
  const avg = cultos.length ? (cultos.reduce((a, c) => a + c.items.length, 0) / cultos.length) : 0;

  const tally = (fn) => {
    const m = new Map();
    for (const e of ex) {
      const song = store.findSong(e.songId);
      if (!song) continue;
      for (const k of [].concat(fn(song, e) || [])) m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byTheme = tally((song) => song.themes.length ? song.themes : ['Sem tema']);
  const byKey = tally((song, e) => {
    const sl = s.setlists.find((x) => x.id === e.setlistId);
    const it = sl?.items.find((i) => i.songId === song.id);
    return it?.key || song.versions.find((v) => v.id === e.versionId)?.keyMinistry || song.versions[0]?.keyMinistry || '?';
  });
  const byArtist = tally((song) => song.artist || 'Sem artista');

  // participação na escala (setlists realizados no período)
  const part = new Map();
  for (const c of cultos) for (const r of c.roster) if (r.status !== 'recusado') part.set(r.userId, (part.get(r.userId) || 0) + 1);
  const participation = [...part.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => [store.userName(id), n]);

  const forgottenSel = select([['4', '4 semanas'], ['8', '8 semanas'], ['12', '12 semanas'], ['26', '6 meses']], String(rep.forgottenWeeks), {
    style: { width: 'auto', minHeight: '30px', padding: '2px 6px' }, 'aria-label': 'Considerar esquecida após',
    onchange: (e) => { rep.forgottenWeeks = Number(e.target.value); location.hash = '#/relatorios'; window.dispatchEvent(new HashChangeEvent('hashchange')); },
  });

  return [
    el('p', { class: 'small muted' }, from ? `De ${fmtDate(from, false)} a ${fmtDate(to, false)}` : 'Todo o histórico'),
    el('div', { class: 'grid3' },
      stat('Cultos realizados', cultos.length),
      stat('Músicas tocadas', ex.length, `${played.length} diferentes`),
      stat('Média por culto', avg ? avg.toFixed(1).replace('.', ',') : '—', 'músicas'),
      stat('Nunca tocadas', never.length, `de ${rows.length} no repertório`)),
    el('div', { class: 'grid2' },
      card('Mais tocadas', bars(played.slice(0, 10).map((r) => [r.song.title, r.n, '#/musica/' + r.song.id]))),
      card('Menos tocadas', least.length ? listRows(least.map((r) => [r.song.title, `${r.n}× · última ${fmtDate(r.last, false)}`, '#/musica/' + r.song.id])) : el('p', { class: 'muted' }, 'Nenhuma música tocada no período.'))),
    el('div', { class: 'grid2' },
      card(el('span', { class: 'row' }, 'Esquecidas há mais de ', forgottenSel),
        forgotten.length ? listRows(forgotten.slice(0, 12).map((r) => [r.song.title, `${daysBetween(r.last, t)} dias`, '#/musica/' + r.song.id])) : el('p', { class: 'muted' }, 'Nenhuma.')),
      card('Nunca tocadas', never.length ? listRows(never.slice(0, 12).map((r) => [r.song.title, r.song.artist, '#/musica/' + r.song.id])) : el('p', { class: 'muted' }, 'Todas já foram tocadas.'))),
    el('div', { class: 'grid2' },
      card('Por tema', byTheme.length ? bars(byTheme.slice(0, 10)) : el('p', { class: 'muted' }, 'Sem dados.')),
      card('Por tom', byKey.length ? bars(byKey.slice(0, 10)) : el('p', { class: 'muted' }, 'Sem dados.'))),
    el('div', { class: 'grid2' },
      card('Por artista', byArtist.length ? bars(byArtist.slice(0, 10)) : el('p', { class: 'muted' }, 'Sem dados.')),
      card('Participação na escala', participation.length ? bars(participation) : el('p', { class: 'muted' }, 'Sem escalas nos cultos realizados do período.'))),
  ];
}

function stat(label, value, sub) {
  return el('div', { class: 'card stat' }, el('span', { class: 'label' }, label), el('b', null, value), sub ? el('span', { class: 'small muted' }, sub) : null);
}
function card(title, content) {
  return el('section', { class: 'card' }, el('h2', null, title), content);
}
function bars(entries) {
  const max = Math.max(1, ...entries.map((e) => e[1]));
  return el('div', { class: 'bars' }, entries.map(([name, n, href]) => el('div', { class: 'bar-row' },
    href ? el('a', { class: 'name', href, style: { color: 'inherit' } }, name) : el('span', { class: 'name' }, name),
    el('div', { class: 'bar-track', role: 'img', 'aria-label': `${name}: ${n}` }, el('div', { class: 'bar-fill', style: { width: (n / max) * 100 + '%' } })),
    el('span', { class: 'v' }, n))));
}
function listRows(entries) {
  return el('div', { class: 'stack', style: { gap: '6px' } }, entries.map(([a, b, href]) => el('a', { href, class: 'row', style: { justifyContent: 'space-between', color: 'inherit', textDecoration: 'none', flexWrap: 'nowrap' } },
    el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, a), el('span', { class: 'small muted', style: { whiteSpace: 'nowrap' } }, b))));
}

function exportXlsx() {
  const { rows, ex } = compute();
  const header = ['Título', 'Artista', 'Tom', 'Vezes no período', 'Última vez', 'Temas', 'Cultos'];
  const data = [header, ...rows.sort((a, b) => b.n - a.n).map((r) => [r.song.title, r.song.artist, r.song.versions[0]?.keyMinistry || '', String(r.n), r.last || '', r.song.themes.join('; '), r.song.services.join('; ')])];
  const hist = [['Data', 'Título', 'Artista'], ...ex.sort((a, b) => b.date.localeCompare(a.date)).map((e) => { const s = store.findSong(e.songId); return [e.date, s?.title || '', s?.artist || '']; })];
  downloadBlob(makeXlsx([['Resumo', data], ['Histórico', hist]]), `relatorio-repertorio-${today()}.xlsx`);
  toast('Relatório exportado');
}
