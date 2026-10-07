import { el, field, textarea, toast, confirmBox, fmtDate, downloadBlob, today, splitList, select, initials, modal, input } from '../dom.js';
import * as api from '../cloud/client.js';
import * as sync from '../cloud/sync.js';
import { setMode } from './login.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { go } from '../nav.js';
import { clearAllTracks, storageEstimate } from '../audio/trackstore.js';

export function renderMore() {
  const s = store.getState();
  const me = store.currentUser();
  const admin = store.isAdmin();
  const mid = s.session.ministryId;
  const suggestions = s.suggestions.filter((x) => store.findSong(x.songId)?.ministryId === mid).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mine = s.suggestions.filter((x) => x.userId === me.id);

  const cloud = store.mode === 'cloud';
  const usage = el('span', { class: 'small muted' }, 'calculando…');
  storageEstimate().then((t) => { usage.textContent = t; });

  let theme = '';
  try { theme = localStorage.getItem('repertorio-louvor.theme') || ''; } catch { /* ok */ }

  const fileIn = el('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'backup-file' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data.songs || !data.users) throw new Error('Arquivo não parece um backup do Repertório.');
      if (!(await confirmBox('Restaurar backup', 'Substituir todos os dados deste aparelho pelo backup?', 'Restaurar', true))) return;
      store.replaceState(data);
      toast('Backup restaurado');
    } catch (e) { toast(e.message, 'bad'); }
  });

  const listEditor = (label, key, hint) => {
    const ta = textarea({ value: s.settings[key].join('\n'), style: { minHeight: '130px' } });
    ta.addEventListener('change', () => { store.commit((st) => { st.settings[key] = [...new Set(splitList(ta.value.replace(/\n/g, ';')))]; }); toast('Lista salva'); });
    return field(label, ta, hint);
  };

  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('div', { class: 'page-head' }, el('div', { class: 'grow' }, el('h1', null, 'Mais'))),

    el('section', { class: 'card row', style: { justifyContent: 'space-between' } },
      el('div', { class: 'row' }, el('span', { class: 'avatar' }, initials(me.name)), el('div', null, el('b', null, me.name), el('br'), el('span', { class: 'small muted' }, me.email))),
      el('div', { class: 'row' },
        el('a', { class: 'btn', href: '#/equipe' }, icon('users'), 'Equipe'),
        admin ? el('a', { class: 'btn', href: '#/importar' }, icon('upload'), 'Importar planilha') : null,
        el('a', { class: 'btn', href: '#/relatorios' }, icon('chart'), 'Relatórios'),
        cloud ? el('button', { class: 'btn', onclick: changePassword }, 'Trocar senha') : null,
        cloud
          ? el('button', { class: 'btn', onclick: async () => { if (await confirmBox('Sair', 'Sair desta conta neste aparelho?', 'Sair')) api.signOut(); } }, icon('logout'), 'Sair')
          : el('button', { class: 'btn', onclick: () => { store.logout(); go('/'); } }, icon('logout'), 'Trocar usuário'))),

    cloud ? syncCard() : null,

    admin ? el('section', { class: 'card stack' },
      el('h2', null, `Sugestões dos membros (${suggestions.filter((x) => x.status === 'pendente').length} pendentes)`),
      suggestions.length ? suggestions.map((sg) => el('div', { class: 'row', style: { justifyContent: 'space-between', borderTop: '1px solid var(--line)', paddingTop: '10px' } },
        el('div', { style: { flex: '1 1 240px', minWidth: 0 } },
          el('b', null, store.userName(sg.userId)), ' sobre ', el('a', { href: '#/musica/' + sg.songId }, store.findSong(sg.songId)?.title), el('br'),
          el('span', null, sg.text), el('br'),
          el('span', { class: 'small muted' }, fmtDate(sg.createdAt.slice(0, 10), false))),
        sg.status === 'pendente' ? el('div', { class: 'row' },
          el('a', { class: 'btn small', href: '#/musica/' + sg.songId + '/editar' }, 'Abrir edição'),
          el('button', { class: 'btn small primary', onclick: () => store.commit((st) => { st.suggestions.find((x) => x.id === sg.id).status = 'aprovada'; }) }, 'Aprovar'),
          el('button', { class: 'btn small', onclick: () => store.commit((st) => { st.suggestions.find((x) => x.id === sg.id).status = 'recusada'; }) }, 'Recusar'))
          : el('span', { class: 'pill ' + (sg.status === 'aprovada' ? 'ok' : 'bad') }, sg.status)))
        : el('p', { class: 'muted' }, 'Nenhuma sugestão por enquanto.')) : null,

    !admin && mine.length ? el('section', { class: 'card stack' },
      el('h2', null, 'Minhas sugestões'),
      mine.map((sg) => el('p', null, el('b', null, store.findSong(sg.songId)?.title), ': ', sg.text, ' ', el('span', { class: 'pill ' + (sg.status === 'aprovada' ? 'ok' : sg.status === 'recusada' ? 'bad' : 'warn') }, sg.status)))) : null,

    el('section', { class: 'card stack' },
      el('h2', null, 'Aparência'),
      field('Tema', select([['', 'Igual ao do aparelho'], ['light', 'Claro'], ['dark', 'Escuro']], theme, { style: { width: 'auto' }, onchange: (e) => {
        const v = e.target.value;
        if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
        try { v ? localStorage.setItem('repertorio-louvor.theme', v) : localStorage.removeItem('repertorio-louvor.theme'); } catch { /* ok */ }
      } }))),

    admin ? el('section', { class: 'card stack' },
      el('h2', null, 'Listas do ministério'),
      el('div', { class: 'grid3' },
        listEditor('Tipos de culto', 'serviceTypes', 'Um por linha'),
        listEditor('Funções da equipe', 'functions', 'Um por linha'),
        listEditor('Temas sugeridos', 'themes', 'Um por linha'))) : null,

    el('section', { class: 'card stack' },
      el('h2', null, 'Google Drive'),
      el('div', { class: 'notice info' }, 'Ainda não conectado. Na próxima etapa o administrador conecta a conta Google da igreja uma vez e o app cria uma pasta por música e versão (VS, Instrumental, Vozes, Cifras). Enquanto isso, cole os links do Drive na edição de cada versão.'),
      el('p', { class: 'small muted' }, 'Os arquivos de multipista que você carrega no player ficam guardados neste aparelho para uso sem internet.')),

    el('section', { class: 'card stack' },
      el('h2', null, 'Dados deste aparelho'),
      el('p', { class: 'small' }, 'Espaço usado pelo app: ', usage),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => { downloadBlob(new Blob([JSON.stringify(store.getState(), null, 2)], { type: 'application/json' }), `backup-repertorio-${today()}.json`); toast('Backup exportado'); } }, icon('download'), 'Exportar backup'),
        cloud ? null : el('label', { class: 'btn', for: 'backup-file' }, icon('upload'), 'Restaurar backup'), cloud ? null : fileIn,
        el('button', { class: 'btn', onclick: async () => {
          if (!(await confirmBox('Apagar faixas baixadas', 'Apagar todos os áudios de multipista guardados neste aparelho? Os cadastros continuam.', 'Apagar', true))) return;
          await clearAllTracks();
          if (!cloud) store.commit((st) => { for (const sg of st.songs) for (const v of sg.versions) for (const t of v.tracks) t.stored = false; });
          toast('Faixas apagadas');
        } }, icon('trash'), 'Apagar faixas'),
        cloud ? null : el('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmBox('Recomeçar demonstração', 'Apagar tudo neste aparelho e voltar aos dados de exemplo?', 'Recomeçar', true))) return;
          store.resetDemo();
          go('/');
        } }, 'Recomeçar demonstração'),
        cloud ? null : (api.configured ? el('button', { class: 'btn', onclick: () => setMode('cloud') }, 'Sair da demonstração') : null))),

    el('section', { class: 'card stack' },
      el('h2', null, 'Instalar no celular'),
      el('p', null, el('b', null, 'iPhone: '), 'abra no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.'),
      el('p', null, el('b', null, 'Android: '), 'abra no Chrome, toque no menu ⋮ e em “Instalar app” ou “Adicionar à tela inicial”.'),
      el('p', { class: 'small muted' }, 'Instalado, o app abre em tela cheia e funciona sem internet depois do primeiro acesso.')),

    el('p', { class: 'small muted' }, `Repertório Louvor · versão 0.4 · ${cloud ? 'dados na nuvem' : 'demonstração local'}`));
}

function syncCard() {
  const s = store.getState();
  const mid = s.session.ministryId;
  const line = el('p', { class: 'small' });
  const draw = (st) => {
    const when = st.lastSync ? st.lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
    line.textContent = ({ ok: `Tudo sincronizado (última vez às ${when}).`, syncing: 'Sincronizando…', offline: `Sem internet. ${st.pending ? st.pending + ' alteração(ões) serão enviadas quando a conexão voltar.' : 'Você continua vendo a última cópia salva.'}`, error: 'Erro: ' + (st.error || ''), idle: '' })[st.state] || '';
  };
  const off = sync.onStatus(draw);
  const card = el('section', { class: 'card stack' },
    el('h2', null, 'Sincronização'),
    line,
    el('p', { class: 'small muted' }, 'Suas alterações vão para a nuvem automaticamente e as da equipe aparecem aqui em alguns segundos. Os áudios das multipistas ainda ficam só no aparelho em que foram carregados (o Google Drive vem na próxima etapa).'),
    el('div', { class: 'row' },
      el('button', { class: 'btn', onclick: () => sync.refreshNow() }, 'Sincronizar agora'),
      el('button', { class: 'btn ghost', onclick: async () => {
        if (!(await confirmBox('Sair do ministério', `Deixar de participar do ${store.currentMinistry()?.name}? Para voltar, você precisará de um novo convite.`, 'Sair do ministério', true))) return;
        try { await sync.leaveMinistry(mid); toast('Você saiu do ministério'); go('/'); } catch (e) { toast(api.friendlyError(e), 'bad'); }
      } }, 'Sair deste ministério')));
  // para de ouvir quando o cartão sai da tela
  const mo = new MutationObserver(() => { if (!card.isConnected) { off(); mo.disconnect(); } });
  setTimeout(() => mo.observe(document.body, { childList: true, subtree: true }), 0);
  return card;
}

function changePassword() {
  const p1 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Mínimo de 6 caracteres' });
  const p2 = input({ type: 'password', autocomplete: 'new-password', placeholder: 'Repita a senha' });
  modal({
    title: 'Trocar senha',
    body: [field('Nova senha', p1), field('Confirme', p2)],
    actions: [
      { label: 'Cancelar', kind: 'ghost' },
      { label: 'Salvar', kind: 'primary', onClick: async () => {
        if (p1.value.length < 6) { toast('A senha precisa ter pelo menos 6 caracteres.', 'bad'); return true; }
        if (p1.value !== p2.value) { toast('As duas senhas não são iguais.', 'bad'); return true; }
        try { await api.updatePassword(p1.value); toast('Senha alterada'); } catch (e) { toast(api.friendlyError(e), 'bad'); return true; }
      } },
    ],
  });
}
