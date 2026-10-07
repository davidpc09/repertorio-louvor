import { el, field, input, select, toast, modal, confirmBox, uid, fmtDate, pill, initials, today } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import * as sync from '../cloud/sync.js';
import { friendlyError } from '../cloud/client.js';

const SHORT = { player: 'player', musicas_adicionar: 'adiciona', musicas_editar: 'edita', musicas_remover: 'remove', escala: 'escala', eventos: 'eventos' };
function permSummary(perms = []) {
  if (!perms.length) return el('span', { class: 'small muted' }, 'só consulta');
  const songs = ['musicas_adicionar', 'musicas_editar', 'musicas_remover'].filter((p) => perms.includes(p)).map((p) => SHORT[p]);
  const parts = [perms.includes('player') ? 'player' : null, songs.length ? 'músicas: ' + songs.join('/') : null, perms.includes('escala') ? 'escala' : null, perms.includes('eventos') ? 'eventos' : null].filter(Boolean);
  return el('span', { class: 'small muted' }, parts.join(' · '));
}

/** Caixas de permissão. Administrador tem todas; as caixas ficam desativadas nesse caso. */
function permissionPicker(initial, roleSelect) {
  const set = new Set(initial || []);
  const boxes = store.PERMISSIONS.map(([k, label]) => {
    const id = 'perm-' + k + '-' + Math.random().toString(36).slice(2, 6);
    const cb = el('input', { type: 'checkbox', id, checked: set.has(k), onchange: (e) => { e.target.checked ? set.add(k) : set.delete(k); } });
    return { cb, node: el('label', { for: id }, cb, label) };
  });
  const note = el('p', { class: 'small muted', hidden: true }, 'Administradores podem tudo.');
  const sync = () => {
    const isAdmin = roleSelect?.value === 'admin';
    boxes.forEach((b) => { b.cb.disabled = isAdmin; });
    note.hidden = !isAdmin;
  };
  roleSelect?.addEventListener('change', sync);
  sync();
  return { node: el('div', { class: 'field' }, el('label', null, 'Pode'), el('div', { class: 'perm-list' }, boxes.map((b) => b.node)), note), values: () => [...set] };
}

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
        pill(m.role === 'admin' ? 'admin' : 'membro', m.role === 'admin' ? 'accent' : ''),
        m.role !== 'admin' ? permSummary(m.permissions) : null,
        admin || u.id === me.id ? el('button', { class: 'btn small', onclick: () => editMember(u) }, icon('edit'), 'Editar') : null));
  };

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('div', { class: 'page-head' },
      el('div', { class: 'grow' }, el('h1', null, 'Equipe'), el('p', null, `${members.length} pessoas no ${store.currentMinistry()?.name}`)),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => editMember(me) }, icon('calendar'), 'Minhas datas'),
        admin ? el('button', { class: 'btn primary', onclick: () => (store.mode === 'cloud' ? inviteDialog() : editMember(null)) }, icon('plus'), 'Convidar pessoa') : null)),
    el('div', { class: 'list' }, members.map(row)),
    store.mode === 'cloud' && admin ? pendingInvites() : null,
    store.mode === 'cloud'
      ? el('p', { class: 'small muted' }, 'O convite é um link: envie pelo WhatsApp. Quem abrir o link e criar a conta entra no ministério com o papel que você escolheu.')
      : el('p', { class: 'small muted' }, 'Na versão em nuvem o convite é um link enviado pelo WhatsApp.'));
}

// ---------- Convites (nuvem) ----------
function pendingInvites() {
  const s = store.getState();
  const list = (s.invites || []).filter((c) => c.ministryId === s.session.ministryId);
  if (!list.length) return null;
  return el('section', { class: 'stack' },
    el('h2', null, `Convites aguardando (${list.length})`),
    el('div', { class: 'list' }, list.map((c) => el('div', { class: 'list-item', style: { flexWrap: 'wrap' } },
      el('div', { class: 'grow', style: { minWidth: '160px' } },
        el('div', { class: 'title' }, c.name || 'Sem nome'),
        el('div', { class: 'sub' }, [c.role === 'admin' ? 'administrador' : 'membro', (c.functions || []).join(', '), 'vence ' + fmtDate(String(c.expiresAt).slice(0, 10), false)].filter(Boolean).join(' · '))),
      el('div', { class: 'meta' },
        el('button', { class: 'btn small', onclick: () => showInviteLink(sync.inviteLink(c.id), c.name) }, icon('share', 16), 'Link'),
        el('button', { class: 'btn small danger', 'aria-label': 'Cancelar convite', onclick: async () => {
          if (!(await confirmBox('Cancelar convite', 'O link deixa de funcionar. Continuar?', 'Cancelar convite', true))) return;
          try { await sync.deleteInvite(c.id); toast('Convite cancelado'); } catch (e) { toast(friendlyError(e), 'bad'); }
        } }, icon('trash', 16)))))));
}

function inviteDialog() {
  const s = store.getState();
  const name = input({ placeholder: 'Nome da pessoa' });
  const role = select([['membro', 'Membro (cantor ou músico)'], ['admin', 'Administrador']], 'membro');
  const perms = permissionPicker(store.DEFAULT_PERMISSIONS, role);
  const chosen = new Set();
  const funcs = el('div', { class: 'chips' }, s.settings.functions.map((f) => {
    const b = el('button', { type: 'button', class: 'chip', onclick: () => { chosen.has(f) ? chosen.delete(f) : chosen.add(f); b.classList.toggle('on'); } }, f);
    return b;
  }));
  modal({
    title: 'Convidar pessoa',
    body: [
      field('Nome', name),
      el('div', { class: 'field' }, el('label', null, 'Funções'), funcs),
      field('Papel', role),
      perms.node,
      el('p', { class: 'small muted' }, 'Vamos gerar um link que vale por 30 dias e serve para uma pessoa.'),
    ],
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      { label: 'Gerar link', kind: 'primary', onClick: async () => {
        try {
          const link = await sync.createInvite({ ministryId: s.session.ministryId, name: name.value.trim(), role: role.value, permissions: perms.values(), functions: [...chosen] });
          setTimeout(() => showInviteLink(link, name.value.trim()), 50);
        } catch (e) { toast(friendlyError(e), 'bad'); return true; }
      } },
    ],
  });
}

function showInviteLink(link, name) {
  const min = store.currentMinistry()?.name || 'ministério';
  const text = `Olá${name ? ' ' + name.split(' ')[0] : ''}! Você foi convidado para o ${min} no app Repertório Louvor. Abra o link, crie sua conta e pronto:\n${link}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast('Mensagem copiada'); } catch { toast('Selecione o link e copie', 'bad'); }
  };
  modal({
    title: 'Link de convite',
    body: [
      el('p', null, 'Envie para a pessoa. O link funciona uma vez e vale por 30 dias.'),
      el('div', { class: 'invite-link' }, link),
      el('div', { class: 'row' },
        el('a', { class: 'btn primary', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener' }, icon('share', 16), 'Enviar pelo WhatsApp'),
        el('button', { class: 'btn', onclick: copy }, icon('copy', 16), 'Copiar mensagem')),
    ],
  });
}

function editMember(user) {
  const s = store.getState();
  const mid = s.session.ministryId;
  const admin = store.isAdmin();
  const isNew = !user;
  const u = user ? JSON.parse(JSON.stringify(user)) : { id: uid('u'), name: '', email: '', functions: [], memberships: [{ ministryId: mid, role: 'membro', permissions: [...store.DEFAULT_PERMISSIONS] }], unavailable: [], active: true };
  let m = u.memberships.find((x) => x.ministryId === mid);
  if (!m) { m = { ministryId: mid, role: 'membro', permissions: [...store.DEFAULT_PERMISSIONS] }; u.memberships.push(m); }

  const name = input({ value: u.name, placeholder: 'Nome' });
  const email = input({ type: 'email', value: u.email, placeholder: 'email@exemplo.com', readonly: store.mode === 'cloud' });
  const funcs = el('div', { class: 'chips' }, s.settings.functions.map((f) => {
    const b = el('button', { type: 'button', class: 'chip' + (u.functions.includes(f) ? ' on' : ''), onclick: () => {
      u.functions = u.functions.includes(f) ? u.functions.filter((x) => x !== f) : [...u.functions, f];
      b.classList.toggle('on');
    } }, f);
    return b;
  }));
  const role = select([['membro', 'Membro'], ['admin', 'Administrador']], m.role);
  const perms = permissionPicker(m.permissions, role);
  const active = el('input', { type: 'checkbox', checked: m.active !== false && u.active !== false, id: 'is-active' });

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
        !isNew ? el('label', { class: 'row small', for: 'is-active' }, active, 'Ativo') : null) : null,
      canAdminThis ? perms.node : null,
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
          m.permissions = perms.values();
          m.active = active.checked;
          u.active = u.memberships.some((x) => x.active !== false);
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
