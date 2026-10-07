import { el, clear, field, input, textarea, select, toast, modal, confirmBox, uid, fmtDate, today, pill, emptyState, downloadBlob } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { agendaItems, googleCalendarUrl, buildIcs, EVENT_TYPES } from '../calendar.js';

const view = { filter: 'todos', past: false };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function saveIcs(items, name) {
  if (!items.length) { toast('Nada para adicionar.', 'bad'); return; }
  downloadBlob(new Blob([buildIcs(items)], { type: 'text/calendar;charset=utf-8' }), name);
  toast('Arquivo de agenda gerado. Abra-o para adicionar à sua agenda.');
}

/** Botões "adicionar à minha agenda" de um item. */
export function calendarButtons(it, small = true) {
  return el('div', { class: 'row', style: { gap: '6px' } },
    el('a', { class: 'btn' + (small ? ' small' : ''), href: googleCalendarUrl(it), target: '_blank', rel: 'noopener', title: 'Abre o Google Agenda com o evento preenchido' }, icon('calendar', 16), 'Google Agenda'),
    el('button', { class: 'btn' + (small ? ' small' : ''), title: 'Arquivo .ics para agenda do iPhone, Outlook e outras', onclick: () => saveIcs([it], `${it.date}-${it.title.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}.ics`) }, icon('download', 16), 'iPhone / Outlook'));
}

export function renderAgenda() {
  const box = el('div', { class: 'stack', style: { gap: '18px' } });
  const listBox = el('div', { class: 'stack', style: { gap: '18px' } });
  const t = today();
  const canEdit = store.canEvents();

  const draw = () => {
    clear(listBox);
    let items = agendaItems({ from: view.past ? null : t });
    if (view.past) items = items.filter((x) => x.date < t).reverse();
    if (view.filter === 'cultos') items = items.filter((x) => x.type === 'Culto');
    if (view.filter === 'ensaios') items = items.filter((x) => x.type === 'Ensaio');
    if (view.filter === 'reunioes') items = items.filter((x) => x.type === 'Reunião');
    if (view.filter === 'minhas') items = items.filter((x) => x.mine?.length);
    if (!items.length) {
      listBox.appendChild(emptyState(view.past ? 'Nada no histórico' : 'Nada marcado', canEdit ? 'Crie um evento ou monte o setlist de um culto.' : 'Quando a liderança marcar ensaios e cultos, eles aparecem aqui.', canEdit && !view.past ? el('button', { class: 'btn primary', onclick: () => editEvent(null) }, icon('plus'), 'Novo evento') : null));
      return;
    }
    const byMonth = new Map();
    for (const it of items) {
      const k = it.date.slice(0, 7);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(it);
    }
    for (const [k, list] of byMonth) {
      const [y, m] = k.split('-').map(Number);
      listBox.appendChild(el('section', { class: 'stack', style: { gap: '8px' } },
        el('h2', { style: { textTransform: 'capitalize' } }, `${MESES[m - 1]} ${y}`),
        el('div', { class: 'list' }, list.map(row))));
    }
  };

  const row = (it) => {
    const [y, m, d] = it.date.split('-').map(Number);
    const wd = DIAS[new Date(y, m - 1, d).getDay()];
    const href = it.kind === 'setlist' ? '#/setlist/' + it.id : null;
    return el('div', { class: 'agenda-item' + (it.mine?.length ? ' mine' : '') },
      el('div', { class: 'agenda-date', 'aria-hidden': 'true' }, el('b', null, d), el('small', null, wd)),
      el('div', { class: 'grow', style: { minWidth: 0 } },
        el('div', { class: 'row', style: { gap: '6px' } },
          href ? el('a', { href, class: 'title', style: { color: 'inherit' } }, it.title) : el('span', { class: 'title' }, it.title),
          pill(it.type, it.type === 'Culto' ? 'accent' : it.type === 'Ensaio' ? 'ok' : ''),
          it.status === 'rascunho' ? pill('rascunho', 'warn') : null,
          it.mine?.length ? pill('você: ' + it.mine.join(', '), 'warn') : null),
        el('div', { class: 'sub' }, [fmtDate(it.date), it.start ? it.start + (it.end ? '–' + it.end : '') : 'dia todo', it.location].filter(Boolean).join(' · ')),
        it.kind === 'event' && it.notes ? el('div', { class: 'small muted', style: { whiteSpace: 'pre-wrap' } }, it.notes) : null,
        el('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } },
          calendarButtons(it),
          it.kind === 'event' && canEdit ? el('button', { class: 'btn small ghost', onclick: () => editEvent(it.source) }, icon('edit', 16), 'Editar') : null)));
  };

  const chips = el('div', { class: 'chips' }, [['todos', 'Tudo'], ['minhas', 'Minhas escalas'], ['cultos', 'Cultos'], ['ensaios', 'Ensaios'], ['reunioes', 'Reuniões']].map(([k, l]) => {
    const b = el('button', { class: 'chip' + (view.filter === k ? ' on' : ''), onclick: () => { view.filter = k; [...chips.children].forEach((c) => c.classList.toggle('on', c === b)); draw(); } }, l);
    return b;
  }));

  box.append(
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Agenda'), el('p', null, 'Cultos, ensaios e reuniões do ' + (store.currentMinistry()?.name || 'ministério'))),
      el('div', { class: 'row' },
        el('button', { class: 'btn', title: 'Baixa um arquivo com os próximos compromissos para importar na sua agenda', onclick: () => {
          const items = agendaItems({ from: t }).filter((x) => view.filter !== 'minhas' || x.mine?.length);
          saveIcs(items, `agenda-${(store.currentMinistry()?.name || 'louvor').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-')}.ics`);
        } }, icon('download', 16), 'Adicionar tudo à minha agenda'),
        canEdit ? el('button', { class: 'btn primary', onclick: () => editEvent(null) }, icon('plus'), 'Novo evento') : null)),
    el('div', { class: 'row', style: { justifyContent: 'space-between' } }, chips,
      el('button', { class: 'btn small ghost', onclick: (e) => { view.past = !view.past; e.currentTarget.textContent = view.past ? 'Ver próximos' : 'Ver anteriores'; draw(); } }, view.past ? 'Ver próximos' : 'Ver anteriores')),
    listBox,
    el('p', { class: 'small muted' }, '“Google Agenda” abre o evento pronto para salvar na sua conta Google. “iPhone / Outlook” baixa um arquivo .ics: abra-o e toque em Adicionar. Para que alterações apareçam sozinhas na sua agenda, vamos ligar a agenda do Google do ministério na etapa do Google Drive.'));
  draw();
  return box;
}

export function editEvent(ev) {
  const s = store.getState();
  const isNew = !ev;
  const e = ev ? { ...ev } : { id: uid('ev'), ministryId: s.session.ministryId, title: '', type: 'Ensaio', date: today(), start: '19:30', end: '21:30', location: '', notes: '' };
  const title = input({ value: e.title, placeholder: 'Ex.: Ensaio geral' });
  const type = select(EVENT_TYPES, e.type);
  const date = el('input', { type: 'date', value: e.date });
  const start = el('input', { type: 'time', value: e.start });
  const end = el('input', { type: 'time', value: e.end });
  const location = input({ value: e.location, placeholder: 'Ex.: Templo principal' });
  const notes = textarea({ value: e.notes, style: { minHeight: '80px' }, placeholder: 'O que levar, pauta, músicas…' });
  modal({
    title: isNew ? 'Novo evento' : 'Editar evento',
    body: [
      el('div', { class: 'form-grid' },
        el('div', { class: 'span2' }, field('Título', title)),
        field('Tipo', type), field('Data', date), field('Início', start), field('Fim', end),
        el('div', { class: 'span2' }, field('Local', location))),
      field('Observações', notes),
      el('p', { class: 'small muted' }, 'Para cultos com músicas e escala, crie um setlist: ele aparece aqui na agenda automaticamente.'),
    ],
    actions: [
      !isNew ? { label: 'Excluir', kind: 'danger', onClick: async () => {
        if (!(await confirmBox('Excluir evento', `Excluir “${e.title}”?`, 'Excluir', true))) return true;
        store.commit((st) => { st.events = st.events.filter((x) => x.id !== e.id); });
        toast('Evento excluído');
      } } : null,
      { label: 'Cancelar', kind: 'ghost' },
      { label: 'Salvar', kind: 'primary', onClick: () => {
        if (!date.value) { toast('Escolha a data.', 'bad'); return true; }
        Object.assign(e, { title: title.value.trim() || type.value, type: type.value, date: date.value, start: start.value, end: end.value, location: location.value.trim(), notes: notes.value.trim() });
        store.commit((st) => {
          const i = st.events.findIndex((x) => x.id === e.id);
          if (i >= 0) st.events[i] = e; else st.events.push(e);
        });
        toast(isNew ? 'Evento criado' : 'Evento salvo');
      } },
    ].filter(Boolean),
  });
}
