import { el, field, input, select, toast, modal, confirmBox, uid, fmtDate, pill, initials, today } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';

export function renderTeam() {
  const s = store.getState();
  const mid = s.session.ministryId;
  const admin = store.isAdmin();
  const me = store.currentUser();
  const members = s.users.filter((u) => u.memberships.some((m) => m.ministryId === mid)).sort((a, b) => a.name.localeCompare(b.name, 'pt'));

  const row = (u) => {
    const m = u.memberships.find((x) => x.ministryId === mid);
    const nextUnavail = (u.unavailable || []).filter((d) => d >= today()).sort();
    return el('div', { class: 'list-item', style: { flexWrap: 'wrap' } },
      el('span', { class: 'avatar' }, initials(u.name)),
      el('div', { class: 'grow', style: { minWidth: '160px' } },
        el('div', { class: 'title' }, u.name, u.active === false ? ' (inativo)' : ''),
        el('div', { class: 'sub' }, [(u.functions || []).join(', '), u.email].filter(Boolean).join(' · ')),
        nextUnavail.length ? el('div', { class: 'small muted' }, 'Indisponível: ' + nextUnavail.slice(0, 3).map((d) => fmtDate(d, false)).join(', ')) : null),
      el('div', { class: 'meta' },
        pill(m.role === 'admin' ? 'admin' : m.canEdit ? 'membro · edita músicas' : 'membro', m.role === 'admin' ? 'accent' : ''),
        admin || u.id === me.id ? el('button', { class: 'btn small', onclick: () => editMember(u) }, icon('edit'), 'Editar') : null));
  };

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Equipe'), el('p', null, `${members.length} pessoas no ${store.currentMinistry()?.name}`)),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => editMember(me) }, icon('calendar'), 'Minhas datas'),
        admin ? el('button', { class: 'btn primary', onclick: () => editMember(null) }, icon('plus'), 'Convidar pessoa') : null)),
    el('div', { class: 'list' }, members.map(row)),
    el('p', { class: 'small muted' }, 'Na versão em nuvem o convite chega por e-mail; a pessoa cria a senha ou entra com a conta Google.'));
}

function editMember(user) {
  const s = store.getState();
  const mid = s.session.ministryId;
  const admin = store.isAdmin();
  const isNew = !user;
  const u = user ? JSON.parse(JSON.stringify(user)) : { id: uid('u'), name: '', email: '', functions: [], memberships: [{ ministryId: mid, role: 'membro', canEdit: false }], unavailable: [], active: true };
  let m = u.memberships.find((x) => x.ministryId === mid);
  if (!m) { m = { ministryId: mid, role: 'membro', canEdit: false }; u.memberships.push(m); }

  const name = input({ value: u.name, placeholder: 'Nome' });
  const email = input({ type: 'email', value: u.email, placeholder: 'email@exemplo.com' });
  const funcs = el('div', { class: 'chips' }, s.settings.functions.map((f) => {
    const b = el('button', { type: 'button', class: 'chip' + (u.functions.includes(f) ? ' on' : ''), onclick: () => {
      u.functions = u.functions.includes(f) ? u.functions.filter((x) => x !== f) : [...u.functions, f];
      b.classList.toggle('on');
    } }, f);
    return b;
  }));
  const role = select([['membro', 'Membro'], ['admin', 'Administrador']], m.role);
  const canEdit = el('input', { type: 'checkbox', checked: !!m.canEdit, id: 'can-edit' });
  const active = el('input', { type: 'checkbox', checked: u.active !== false, id: 'is-active' });

  const dates = el('div', { class: 'row' });
  const drawDates = () => {
    dates.replaceChildren(...(u.unavailable || []).filter((d) => d >= today()).sort().map((d) => el('span', { class: 'pill' }, fmtDate(d, false), el('button', { type: 'button', class: 'icon-btn', style: { fontSize: '1rem', padding: '0 0 0 4px' }, 'aria-label': 'Remover data', onclick: () => { u.unavailable = u.unavailable.filter((x) => x !== d); drawDates(); } }, '×'))));
    if (!dates.children.length) dates.append(el('span', { class: 'small muted' }, 'Nenhuma data marcada.'));
  };
  drawDates();
  const newDate = el('input', { type: 'date', style: { width: 'auto' }, 'aria-label': 'Data indisponível' });

  const canAdminThis = admin;
  modal({
    title: isNew ? 'Convidar pessoa' : u.name,
    body: [
      el('div', { class: 'form-grid' },
        field('Nome', name),
        field('E-mail', email)),
      el('div', { class: 'field' }, el('label', null, 'Funções'), funcs),
      canAdminThis ? el('div', { class: 'form-grid' },
        field('Papel neste ministério', role),
        el('label', { class: 'row small', for: 'can-edit' }, canEdit, 'Pode editar músicas sem aprovação'),
        !isNew ? el('label', { class: 'row small', for: 'is-active' }, active, 'Ativo') : null) : null,
      el('div', { class: 'field' }, el('label', null, 'Datas em que não pode servir'), dates,
        el('div', { class: 'row' }, newDate, el('button', { type: 'button', class: 'btn small', onclick: () => {
          if (newDate.value && !u.unavailable.includes(newDate.value)) { u.unavailable.push(newDate.value); drawDates(); }
        } }, icon('plus'), 'Adicionar data'))),
    ],
    actions: [
      !isNew && admin && user.id !== store.currentUser().id ? { label: 'Remover do ministério', kind: 'danger', onClick: async () => {
        if (!(await confirmBox('Remover do ministério', `Remover ${user.name} do ${store.currentMinistry()?.name}?`, 'Remover', true))) return true;
        store.commit((st) => {
          const x = st.users.find((y) => y.id === user.id);
          x.memberships = x.memberships.filter((mm) => mm.ministryId !== mid);
        });
        toast('Pessoa removida do ministério');
      } } : null,
      { label: 'Cancelar', kind: 'ghost' },
      { label: isNew ? 'Convidar' : 'Salvar', kind: 'primary', onClick: () => {
        if (!name.value.trim()) { toast('Informe o nome.', 'bad'); return true; }
        u.name = name.value.trim();
        u.email = email.value.trim();
        if (canAdminThis) {
          m.role = role.value;
          m.canEdit = canEdit.checked;
          u.active = active.checked;
        }
        // evita ficar sem nenhum administrador
        const admins = s.users.filter((x) => x.id !== u.id && x.memberships.some((mm) => mm.ministryId === mid && mm.role === 'admin'));
        if (!admins.length && m.role !== 'admin') { toast('O ministério precisa de pelo menos um administrador.', 'bad'); return true; }
        store.commit((st) => {
          const i = st.users.findIndex((x) => x.id === u.id);
          if (i >= 0) st.users[i] = u; else st.users.push(u);
        });
        toast(isNew ? 'Pessoa adicionada' : 'Alterações salvas');
      } },
    ].filter(Boolean),
  });
}
