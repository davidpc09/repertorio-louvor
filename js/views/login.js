import { el, clear, initials, toast, field, input } from '../dom.js';
import * as store from '../store.js';
import * as api from '../cloud/client.js';
import * as sync from '../cloud/sync.js';

const brand = (sub) => el('div', { class: 'brand' }, el('div', { class: 'brand-mark' }, 'R'), el('div', null, el('b', null, 'Repertório Louvor'), el('small', null, sub || 'Músicas, setlists, escala e player')));

export function setMode(m) {
  try { m === 'demo' ? localStorage.setItem('repertorio-louvor.mode', 'demo') : localStorage.removeItem('repertorio-louvor.mode'); } catch { /* ok */ }
  location.hash = '#/';
  location.reload();
}

// ---------------- Modo demonstração ----------------
export function renderLogin() {
  const s = store.getState();
  const users = s.users.filter((u) => u.active !== false);
  return el('div', { class: 'login' },
    el('div', { class: 'login-box' },
      brand(),
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
      api.configured ? el('button', { class: 'btn', onclick: () => setMode('cloud') }, 'Voltar para o login da equipe') : null));
}

// ---------------- Nuvem: entrar / criar conta ----------------
const ui = { tab: 'entrar', email: '', info: null };

export function renderCloudLogin({ notice } = {}) {
  const box = el('div', { class: 'login-box' });
  const inviteCode = sync.pendingInvite();
  const inviteBox = el('div', { hidden: !inviteCode });
  if (inviteCode) {
    inviteBox.className = 'notice info';
    inviteBox.textContent = 'Você recebeu um convite. Entre ou crie sua conta para participar.';
    api.rpc('ver_convite', { p_codigo: inviteCode }, { auth: false }).then((c) => {
      if (c?.ministerio) {
        inviteBox.textContent = '';
        inviteBox.append('Convite para ', el('b', null, c.ministerio), c.papel === 'admin' ? ' como administrador' : '', '. Entre ou crie sua conta para participar.');
        if (c.nome && !ui.nome) {
          ui.nome = c.nome;
          const f = document.getElementById('login-nome');
          if (f && !f.value) f.value = c.nome;
        }
        // quem chega por convite quase sempre ainda não tem conta
        if (!ui.touchedTab && ui.tab === 'entrar') { ui.tab = 'criar'; ui.touchedTab = true; redraw(); }
      } else {
        inviteBox.className = 'notice bad';
        inviteBox.textContent = 'Este convite é inválido ou já venceu. Peça um novo link ao administrador.';
      }
    }).catch(() => {});
  }

  const msg = el('div', { role: 'status' });
  const show = (text, kind = 'bad') => { clear(msg); if (text) msg.append(el('div', { class: 'notice ' + kind }, text)); };
  if (notice) show(notice.text, notice.kind);
  if (ui.info) show(ui.info.text, ui.info.kind);

  const email = input({ type: 'email', value: ui.email, autocomplete: 'email', placeholder: 'seu@email.com', id: 'login-email' });
  const pass = input({ type: 'password', autocomplete: ui.tab === 'entrar' ? 'current-password' : 'new-password', placeholder: ui.tab === 'entrar' ? 'Sua senha' : 'Mínimo de 6 caracteres', id: 'login-pass' });
  const nome = input({ value: ui.nome || '', autocomplete: 'name', placeholder: 'Como a equipe te chama', id: 'login-nome' });
  email.addEventListener('input', () => { ui.email = email.value.trim(); });
  nome.addEventListener('input', () => { ui.nome = nome.value; });

  const submitBtn = el('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, ui.tab === 'entrar' ? 'Entrar' : 'Criar conta');
  const busy = (on) => { submitBtn.disabled = on; submitBtn.textContent = on ? 'Aguarde…' : (ui.tab === 'entrar' ? 'Entrar' : 'Criar conta'); };

  const form = el('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    ui.info = null;
    const em = email.value.trim();
    if (!em || !pass.value) { show('Preencha e-mail e senha.'); return; }
    if (ui.tab === 'criar' && !nome.value.trim()) { show('Informe seu nome.'); return; }
    busy(true);
    try {
      if (ui.tab === 'entrar') {
        await api.signIn(em, pass.value);
      } else {
        const r = await api.signUp(em, pass.value, nome.value.trim());
        if (r.needsConfirmation) {
          ui.tab = 'entrar';
          ui.info = { kind: 'ok', text: `Conta criada. Enviamos um link de confirmação para ${em}. Abra o e-mail neste aparelho e toque no link para entrar.` };
          redraw();
          return;
        }
      }
    } catch (err) {
      show(api.friendlyError(err));
      if (/confirme seu e-mail/i.test(api.friendlyError(err))) {
        msg.append(el('button', { class: 'btn small', type: 'button', onclick: async () => {
          try { await api.resendConfirmation(em); show('Enviamos o link de novo. Confira também a caixa de spam.', 'ok'); } catch (e2) { show(api.friendlyError(e2)); }
        } }, 'Reenviar e-mail de confirmação'));
      }
    } finally { busy(false); }
  } },
    ui.tab === 'criar' ? field('Seu nome', nome) : null,
    field('E-mail', email),
    field('Senha', pass),
    submitBtn);

  const forgot = el('button', { class: 'btn ghost small', type: 'button', onclick: async () => {
    const em = email.value.trim();
    if (!em) { show('Digite seu e-mail acima e toque em “Esqueci a senha” de novo.'); email.focus(); return; }
    try {
      await api.resetPassword(em);
      show(`Se existir uma conta com ${em}, enviamos um link para criar uma nova senha. Abra o e-mail neste aparelho.`, 'ok');
    } catch (err) { show(api.friendlyError(err)); }
  } }, 'Esqueci a senha');

  const tabs = el('div', { class: 'tabs', style: { marginBottom: 0 } },
    el('button', { type: 'button', class: ui.tab === 'entrar' ? 'on' : '', onclick: () => { ui.tab = 'entrar'; ui.touchedTab = true; ui.info = null; redraw(); } }, 'Entrar'),
    el('button', { type: 'button', class: ui.tab === 'criar' ? 'on' : '', onclick: () => { ui.tab = 'criar'; ui.touchedTab = true; ui.info = null; redraw(); } }, 'Criar conta'));

  box.append(
    brand(),
    inviteBox,
    el('section', { class: 'card stack' },
      tabs,
      msg,
      api.GOOGLE_LOGIN ? el('a', { class: 'btn', href: api.googleSignInUrl() }, 'Entrar com Google') : null,
      api.GOOGLE_LOGIN ? el('div', { class: 'small muted', style: { textAlign: 'center' } }, 'ou com e-mail') : null,
      form,
      ui.tab === 'entrar' ? forgot : el('p', { class: 'small muted' }, 'Para participar de um ministério você precisa do link de convite enviado pelo administrador. Líderes podem criar o próprio ministério depois de entrar.')),
    el('button', { class: 'btn ghost small', onclick: () => setMode('demo') }, 'Ver a demonstração com dados de exemplo'));

  const wrap = el('div', { class: 'login' }, box);
  function redraw() { wrap.replaceWith(renderCloudLogin()); }
  return wrap;
}

// ---------------- Nuvem: nova senha (link do e-mail) ----------------
export function renderNewPassword(onDone) {
  const p1 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo de 6 caracteres' });
  const p2 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha' });
  const msg = el('div');
  return el('div', { class: 'login' },
    el('div', { class: 'login-box' },
      brand('Criar nova senha'),
      el('form', { class: 'card stack', onsubmit: async (e) => {
        e.preventDefault();
        clear(msg);
        if (p1.value.length < 6) { msg.append(el('div', { class: 'notice bad' }, 'A senha precisa ter pelo menos 6 caracteres.')); return; }
        if (p1.value !== p2.value) { msg.append(el('div', { class: 'notice bad' }, 'As duas senhas não são iguais.')); return; }
        try { await api.updatePassword(p1.value); toast('Senha alterada'); onDone(); } catch (err) { msg.append(el('div', { class: 'notice bad' }, api.friendlyError(err))); }
      } },
        el('h2', null, 'Nova senha'),
        msg,
        field('Nova senha', p1),
        field('Confirme', p2),
        el('button', { class: 'btn primary', type: 'submit' }, 'Salvar senha'),
        el('button', { class: 'btn ghost small', type: 'button', onclick: onDone }, 'Agora não'))));
}

// ---------------- Nuvem: ainda sem ministério ----------------
export function renderOnboarding() {
  const who = api.currentAuthUser();
  const msg = el('div');
  const show = (t, k = 'bad') => { clear(msg); if (t) msg.append(el('div', { class: 'notice ' + k }, t)); };
  const nome = input({ placeholder: 'Ex.: Louvor de Domingo', id: 'min-nome' });
  const code = input({ placeholder: 'Cole aqui o link de convite', id: 'invite-code' });

  return el('div', { class: 'login' },
    el('div', { class: 'login-box' },
      brand(who?.email),
      el('h1', null, 'Bem-vindo!'),
      el('p', { class: 'muted' }, 'Você ainda não participa de nenhum ministério.'),
      msg,
      el('form', { class: 'card stack', onsubmit: async (e) => {
        e.preventDefault();
        const m = code.value.trim().match(/convite\/([A-Za-z0-9]+)/) || code.value.trim().match(/^([A-Za-z0-9]{20,})$/);
        if (!m) { show('Cole o link completo que o administrador enviou.'); return; }
        const r = await sync.joinWithCode(m[1]).catch((err) => ({ error: api.friendlyError(err) }));
        if (r?.error) show(r.error); else { toast('Você entrou no ministério'); location.hash = '#/'; }
      } },
        el('h2', null, 'Recebi um convite'),
        el('p', { class: 'small muted' }, 'Abra o link que o administrador mandou, ou cole-o aqui.'),
        field('Link de convite', code),
        el('button', { class: 'btn primary', type: 'submit' }, 'Participar')),
      el('form', { class: 'card stack', onsubmit: async (e) => {
        e.preventDefault();
        if (!nome.value.trim()) { show('Informe o nome do ministério.'); return; }
        try { await sync.createMinistry(nome.value.trim()); toast('Ministério criado. Você é o administrador.'); location.hash = '#/'; store.notify(); } catch (err) { show(api.friendlyError(err)); }
      } },
        el('h2', null, 'Sou líder: criar um ministério'),
        el('p', { class: 'small muted' }, 'Você será o administrador e poderá convidar a equipe.'),
        field('Nome do ministério', nome),
        el('button', { class: 'btn', type: 'submit' }, 'Criar ministério')),
      el('button', { class: 'btn ghost small', onclick: () => api.signOut() }, 'Sair desta conta')));
}

export function renderLoading(text = 'Carregando seus dados…') {
  return el('div', { class: 'login' }, el('div', { class: 'login-box' }, brand(), el('p', { class: 'muted' }, text)));
}

export function renderCloudError(err, onRetry) {
  return el('div', { class: 'login' }, el('div', { class: 'login-box' }, brand(),
    el('div', { class: 'notice bad' }, 'Não foi possível carregar os dados: ', api.friendlyError(err)),
    /does not exist|schema cache|PGRST20|42P01|42883/i.test(String(err?.message || err?.code || '')) ? el('p', { class: 'small' }, 'O banco ainda não foi preparado. No Supabase, abra o SQL Editor, cole o arquivo supabase/schema.sql e clique em Run.') : null,
    el('div', { class: 'row' }, el('button', { class: 'btn primary', onclick: onRetry }, 'Tentar de novo'), el('button', { class: 'btn', onclick: () => api.signOut() }, 'Sair'))));
}
