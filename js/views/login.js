import { el, initials } from '../dom.js';
import * as store from '../store.js';

// Modo demonstração: escolhe um usuário de exemplo. Na versão com Supabase,
// esta tela vira login por e-mail/senha ou conta Google (ver README).
export function renderLogin() {
  const s = store.getState();
  const users = s.users.filter((u) => u.active !== false);
  return el('div', { class: 'login' },
    el('div', { class: 'login-box' },
      el('div', { class: 'brand' }, el('div', { class: 'brand-mark' }, 'R'), el('div', null, el('b', null, 'Repertório Louvor'), el('small', null, 'Músicas, setlists, escala e player'))),
      el('div', { class: 'notice warn' }, 'Modo demonstração: os dados ficam só neste aparelho e já vêm com exemplos. Entre como líder para ver tudo, ou como membro para ver as permissões limitadas.'),
      el('h2', null, 'Entrar como'),
      el('div', { class: 'list' },
        users.map((u) => {
          const roles = u.memberships.map((m) => {
            const min = s.ministries.find((x) => x.id === m.ministryId);
            return `${min?.name || ''}: ${m.role === 'admin' ? 'admin' : m.canEdit ? 'membro (pode editar)' : 'membro'}`;
          }).join(' · ');
          return el('button', { class: 'user-pick', onclick: () => store.login(u.id) },
            el('span', { class: 'avatar' }, initials(u.name)),
            el('span', { class: 'grow', style: { flex: 1, minWidth: 0 } },
              el('b', null, u.name), el('br'),
              el('small', { class: 'muted' }, (u.functions || []).join(', ') + ' — ' + roles)));
        })),
      el('p', { class: 'small muted' }, 'Na versão em nuvem cada pessoa entra com o próprio e-mail ou conta Google, convidada pelo administrador.')));
}
