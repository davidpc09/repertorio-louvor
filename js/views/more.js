import { el, field, textarea, toast, confirmBox, fmtDate, downloadBlob, today, splitList, select, initials, modal, input } from '../dom.js';
import * as api from '../cloud/client.js';
import * as sync from '../cloud/sync.js';
import { setMode } from './login.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { go } from '../nav.js';
import { clearAllTracks, storageEstimate } from '../audio/trackstore.js';
import * as drive from '../cloud/drive.js';
import * as tracksync from '../cloud/tracksync.js';

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

    driveCard(cloud, admin, mid),

    arquivosCard(cloud, mid),

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

    el('p', { class: 'small muted' }, `Repertório Louvor · versão 0.6 · ${cloud ? 'dados na nuvem' : 'demonstração local'}`));
}

/** Cartão "Google Drive": o administrador conecta a conta do ministério uma vez. */
function driveCard(cloud, admin, mid) {
  const corpo = el('div', { class: 'stack', style: { gap: '8px' } });
  const card = el('section', { class: 'card stack' }, el('h2', null, 'Google Drive'), corpo);

  if (!cloud) {
    corpo.append(el('div', { class: 'notice info' }, 'Na demonstração os arquivos ficam só neste aparelho. Entre com a conta do ministério para usar o Drive.'));
    return card;
  }

  async function pintar() {
    corpo.replaceChildren(el('p', { class: 'small muted' }, 'Verificando…'));
    let st;
    try { st = await drive.status(mid); } catch { st = { conectado: false, erro: true }; }
    const partes = [];
    if (st.conectado) {
      partes.push(el('div', { class: 'notice ok' }, 'Conectado' + (st.conta ? ' à conta ' + st.conta : '') + '. As multipistas enviadas pelo app vão para a pasta “Repertório Louvor”, com uma subpasta por música e versão.'));
      partes.push(el('p', { class: 'small muted' }, 'Cada pessoa baixa as faixas para o aparelho dela no player ou no setlist, tocando em “Baixar faixas”. Os arquivos vão do Google direto para o aparelho.'));
      if (admin) {
        partes.push(el('div', { class: 'row' },
          el('button', { class: 'btn ghost', onclick: async () => {
            if (!(await confirmBox('Desconectar o Drive', 'O app deixa de enviar e baixar arquivos. As pastas e os arquivos continuam no Google Drive, e as faixas já baixadas continuam nos aparelhos. Desconectar?', 'Desconectar', true))) return;
            try { await drive.desconectar(mid); tracksync.esquecerStatus(); toast('Google Drive desconectado'); pintar(); } catch (e) { toast(api.friendlyError(e), 'bad'); }
          } }, 'Desconectar')));
      }
    } else if (!admin) {
      partes.push(el('div', { class: 'notice info' }, 'O Google Drive do ministério ainda não foi conectado. Peça a um administrador para fazer isso aqui, nesta tela.'));
    } else {
      partes.push(el('div', { class: 'notice warn' }, 'Ainda não conectado. Conecte a conta Google do ministério uma vez: o app cria a pasta “Repertório Louvor” e guarda nela as multipistas, para a equipe baixar em qualquer aparelho.'));
      const btn = el('button', { class: 'btn primary' }, icon('folder'), 'Conectar conta do ministério');
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const url = await drive.iniciarConexao(mid);
          tracksync.esquecerStatus();
          location.href = url;   // volta para o app depois de autorizar
        } catch (e) {
          btn.disabled = false;
          toast(e.status === 404 || /not found/i.test(e.message || '') ? 'A função “drive-auth” ainda não foi publicada no Supabase.' : api.friendlyError(e), 'bad');
        }
      };
      partes.push(el('div', { class: 'row' }, btn));
      partes.push(el('p', { class: 'small muted' }, 'Use a conta do ministério, não a sua pessoal. O app só vê as pastas e os arquivos que ele mesmo criar — nada mais do Drive dessa conta.'));
    }
    if (st.erro) partes.push(el('p', { class: 'small muted' }, 'Não consegui falar com o servidor agora; tente de novo quando a internet voltar.'));
    corpo.replaceChildren(...partes);
  }

  pintar();
  return card;
}

/** Cartão "Conferir arquivos de áudio": acha cópias repetidas ou sobrando no aparelho e no Drive. */
function arquivosCard(cloud, mid) {
  const corpo = el('div', { class: 'stack', style: { gap: '10px' } });
  const card = el('section', { class: 'card stack' },
    el('h2', null, 'Conferir arquivos de áudio'),
    el('p', { class: 'small muted' }, cloud
      ? 'Compara o que está guardado neste aparelho com a pasta do Drive do ministério e acha arquivos repetidos ou que nenhuma música usa mais. A conferência só lê: nada é apagado sem você confirmar.'
      : 'Acha, neste aparelho, arquivos de áudio repetidos ou que nenhuma música usa mais. A conferência só lê: nada é apagado sem você confirmar.'),
    corpo);
  const mb = tracksync.mb;
  const nomeDe = (song, version) => song ? `${song.title}${version?.name ? ' — ' + version.name : ''}` : 'música removida';
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  const lista = (itens) => el('ul', { class: 'small', style: { margin: '4px 0 0', paddingLeft: '18px' } },
    itens.slice(0, 8).map((t) => el('li', null, t)),
    itens.length > 8 ? el('li', { class: 'muted' }, `e mais ${itens.length - 8}`) : null);

  const bloco = (titulo, texto, itens, botao) => el('div', { class: 'notice warn stack', style: { gap: '6px' } },
    el('b', null, titulo), el('span', null, texto), itens?.length ? lista(itens) : null, botao ? el('div', { class: 'row' }, botao) : null);

  const acao = (rotulo, perigo, titulo, aviso, fn) => el('button', { class: 'btn small' + (perigo ? ' danger' : ''), onclick: async (e) => {
    if (!(await confirmBox(titulo, aviso, rotulo, true))) return;
    e.currentTarget.disabled = true;
    try { await fn(); } catch (err) { toast(err.message || 'Não consegui concluir', 'bad'); }
    conferir();
  } }, rotulo);

  const rodape = () => el('div', { class: 'row' }, el('button', { class: 'btn', onclick: conferir }, icon('check'), 'Conferir agora'));

  async function conferir() {
    const msg = el('p', { class: 'small muted' }, 'Conferindo…');
    corpo.replaceChildren(msg);
    let r;
    try {
      r = await tracksync.auditar({ ministryId: mid, aoProgredir: (p) => { msg.textContent = `Conferindo o Drive: ${p.musica} (${p.indice} de ${p.total})…`; } });
    } catch (e) {
      corpo.replaceChildren(el('div', { class: 'notice bad' }, e.message || 'Não consegui conferir agora.'), rodape());
      return;
    }
    desenhar(r);
  }

  function desenhar(r) {
    const a = r.aparelho; const d = r.drive;
    const canEdit = store.canEditSongs();
    const partes = [];
    const noDrive = d.versoes.reduce((n, v) => n + v.noDrive, 0);
    const noApp = d.versoes.reduce((n, v) => n + v.noApp, 0);
    partes.push(el('p', null, el('b', null, 'Neste aparelho: '), `${plural(a.arquivos, 'arquivo', 'arquivos')} (${mb(a.bytes) === '—' ? '0 MB' : mb(a.bytes)})`));
    if (d.conectado) partes.push(el('p', null, el('b', null, 'No Drive: '), `${plural(noDrive, 'arquivo', 'arquivos')} nas pastas das músicas · ${plural(noApp, 'usado', 'usados')} pelas faixas cadastradas`));
    else if (cloud) partes.push(el('p', { class: 'small muted' }, 'O Drive não está conectado, então conferi só este aparelho.'));
    if (d.erro) partes.push(el('div', { class: 'notice warn' }, 'Não consegui conferir o Drive agora: ' + d.erro));

    let problemas = 0;
    if (a.orfas.length) {
      problemas++;
      const bytes = a.orfas.reduce((n, o) => n + o.size, 0);
      partes.push(bloco('Sobrando neste aparelho',
        `${plural(a.orfas.length, 'arquivo', 'arquivos')} (${mb(bytes)}) de faixas que não existem mais em nenhuma música.`,
        a.orfas.map((o) => `${nomeDe(o.song, o.version)} · ${mb(o.size)}`),
        acao('Apagar do aparelho', false, 'Apagar do aparelho', 'Apagar estes arquivos que nenhuma música usa? Isso só libera espaço neste aparelho.', async () => { const n = await tracksync.limparOrfas(a.orfas); toast(`${plural(n, 'arquivo apagado', 'arquivos apagados')} deste aparelho`); })));
    }
    if (a.repetidas.length) {
      problemas++;
      const extras = a.repetidas.reduce((n, g) => n + g.extras.length, 0);
      partes.push(bloco('Faixas repetidas na mesma música',
        `${plural(extras, 'cópia repetida', 'cópias repetidas')} do mesmo arquivo. Fica a faixa que já tem cópia no Drive e neste aparelho.`,
        a.repetidas.map((g) => `${nomeDe(g.song, g.version)}: “${g.manter.name}” aparece ${g.extras.length + 1}×`),
        canEdit ? acao('Remover repetidas', true, 'Remover faixas repetidas', 'Tirar as cópias repetidas das músicas, deste aparelho e (quando o arquivo é outro) mandar a cópia extra do Drive para a lixeira? A faixa que fica não muda.', async () => {
          const res = await tracksync.removerRepetidas(a.repetidas);
          toast(`${plural(res.removidas, 'faixa repetida removida', 'faixas repetidas removidas')}`);
          for (const f of res.falhas) toast(f, 'bad');
        }) : el('span', { class: 'small' }, 'Peça a quem edita as músicas para limpar.')));
    }
    const repDrive = d.versoes.flatMap((v) => v.repetidos.map((f) => ({ ...f, song: v.song, version: v.version })));
    if (repDrive.length) {
      problemas++;
      partes.push(bloco('Arquivos repetidos no Drive',
        `${plural(repDrive.length, 'arquivo extra', 'arquivos extras')} com o mesmo nome e tamanho de outro, sem nenhuma faixa usando. Vão para a lixeira do Drive (dá para recuperar por 30 dias).`,
        repDrive.map((f) => `${nomeDe(f.song, f.version)}: ${f.name} · ${mb(f.size)}`),
        canEdit ? acao('Mandar para a lixeira', true, 'Repetidos do Drive', 'Mandar estes arquivos repetidos para a lixeira do Drive? A cópia que as músicas usam fica onde está.', async () => {
          const res = await tracksync.limparRepetidosDoDrive(repDrive, mid);
          toast(`${plural(res.removidos, 'arquivo foi', 'arquivos foram')} para a lixeira do Drive`);
          for (const f of res.falhas) toast(f, 'bad');
        }) : el('span', { class: 'small' }, 'Peça a quem edita as músicas para limpar.')));
    }
    if (!problemas) partes.push(el('div', { class: 'notice ok' }, 'Tudo certo: nenhum arquivo repetido nem sobrando.'));

    const livres = d.versoes.filter((v) => v.sobrando.length);
    if (livres.length) {
      partes.push(el('div', { class: 'notice info stack', style: { gap: '4px' } },
        el('b', null, 'Arquivos na pasta do Drive que nenhuma faixa usa'),
        el('span', { class: 'small' }, 'Não mexi: podem ter sido colocados à mão. Eles não vêm para o celular.'),
        lista(livres.map((v) => `${nomeDe(v.song, v.version)}: ${v.sobrando.map((f) => f.name).join(', ')}`))));
    }
    if (d.versoes.length) {
      partes.push(el('details', null, el('summary', { class: 'small' }, 'Ver por música'),
        el('div', { class: 'stack', style: { gap: '4px', marginTop: '6px' } }, d.versoes.map((v) => el('div', { class: 'small row', style: { justifyContent: 'space-between' } },
          el('span', null, nomeDe(v.song, v.version)),
          v.erro ? el('span', { class: 'pill bad' }, 'não consegui ler') : el('span', { class: 'pill ' + (v.noDrive === v.noApp ? 'ok' : 'warn') }, `${v.noDrive} no Drive · ${v.noApp} nas faixas`))))));
    }
    partes.push(rodape());
    corpo.replaceChildren(...partes);
  }

  corpo.append(rodape());
  return card;
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
    el('p', { class: 'small muted' }, 'Suas alterações vão para a nuvem automaticamente e as da equipe aparecem aqui em alguns segundos. Os áudios das multipistas vão para o Google Drive do ministério e cada pessoa baixa para o seu aparelho com um toque.'),
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
