import { el, field, textarea, toast, confirmBox, fmtDate, downloadBlob, today, splitList, select, initials } from '../dom.js';
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
        el('button', { class: 'btn', onclick: () => { store.logout(); go('/'); } }, icon('logout'), 'Trocar usuário'))),

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
      el('div', { class: 'notice info' }, 'Ainda não conectado. Na Fase 2 o administrador conecta a conta Google da igreja uma vez e o app cria uma pasta por música e versão (VS, Instrumental, Vozes, Cifras). Enquanto isso, cole os links do Drive na edição de cada versão.'),
      el('p', { class: 'small muted' }, 'Os arquivos de multipista que você carrega no player ficam guardados neste aparelho para uso sem internet.')),

    el('section', { class: 'card stack' },
      el('h2', null, 'Dados deste aparelho'),
      el('p', { class: 'small' }, 'Espaço usado pelo app: ', usage),
      el('div', { class: 'row' },
        el('button', { class: 'btn', onclick: () => { downloadBlob(new Blob([JSON.stringify(store.getState(), null, 2)], { type: 'application/json' }), `backup-repertorio-${today()}.json`); toast('Backup exportado'); } }, icon('download'), 'Exportar backup'),
        el('label', { class: 'btn', for: 'backup-file' }, icon('upload'), 'Restaurar backup'), fileIn,
        el('button', { class: 'btn', onclick: async () => {
          if (!(await confirmBox('Apagar faixas baixadas', 'Apagar todos os áudios de multipista guardados neste aparelho? Os cadastros continuam.', 'Apagar', true))) return;
          await clearAllTracks();
          store.commit((st) => { for (const sg of st.songs) for (const v of sg.versions) for (const t of v.tracks) t.stored = false; });
          toast('Faixas apagadas');
        } }, icon('trash'), 'Apagar faixas'),
        el('button', { class: 'btn danger', onclick: async () => {
          if (!(await confirmBox('Recomeçar demonstração', 'Apagar tudo neste aparelho e voltar aos dados de exemplo?', 'Recomeçar', true))) return;
          store.resetDemo();
          go('/');
        } }, 'Recomeçar demonstração'))),

    el('section', { class: 'card stack' },
      el('h2', null, 'Instalar no celular'),
      el('p', null, el('b', null, 'iPhone: '), 'abra no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”.'),
      el('p', null, el('b', null, 'Android: '), 'abra no Chrome, toque no menu ⋮ e em “Instalar app” ou “Adicionar à tela inicial”.'),
      el('p', { class: 'small muted' }, 'Instalado, o app abre em tela cheia e funciona sem internet depois do primeiro acesso.')),

    el('p', { class: 'small muted' }, 'Repertório Louvor · versão 0.2 (demonstração local)'));
}
