import { el, clear, toast, initials } from './dom.js';
import { icon } from './icons.js';
import * as store from './store.js';
import { renderLogin } from './views/login.js';
import { renderHome } from './views/home.js';
import { renderSongs, renderSongDetail, renderSongEdit } from './views/songs.js';
import { renderSetlists, renderSetlistDetail, openWorshipMode } from './views/setlists.js';
import { renderImport } from './views/import.js';
import { renderReports } from './views/reports.js';
import { renderTeam } from './views/team.js';
import { renderMore } from './views/more.js';
import { renderPlayer } from './views/player.js';
import { setRenderer, path, go } from './nav.js';

const app = document.getElementById('app');
let cleanup = null;

const ROUTES = [
  [/^\/?$/, () => renderHome()],
  [/^\/musicas$/, () => renderSongs()],
  [/^\/musica\/nova$/, () => renderSongEdit(null)],
  [/^\/musica\/([^/]+)\/editar$/, (m) => renderSongEdit(m[1])],
  [/^\/musica\/([^/]+)$/, (m) => renderSongDetail(m[1])],
  [/^\/setlists$/, () => renderSetlists()],
  [/^\/setlist\/([^/]+)\/culto$/, (m) => { const v = renderSetlistDetail(m[1]); setTimeout(() => openWorshipMode(m[1]), 0); return v; }],
  [/^\/setlist\/([^/]+)$/, (m) => renderSetlistDetail(m[1])],
  [/^\/player$/, () => renderPlayer(null)],
  [/^\/player\/([^/]+)$/, (m) => renderPlayer(m[1])],
  [/^\/importar$/, () => renderImport()],
  [/^\/relatorios$/, () => renderReports()],
  [/^\/equipe$/, () => renderTeam()],
  [/^\/mais$/, () => renderMore()],
];

const NAV = [
  ['/', 'Início', 'home'],
  ['/musicas', 'Músicas', 'music'],
  ['/setlists', 'Setlists', 'list'],
  ['/player', 'Player', 'headphones'],
  ['/relatorios', 'Relatórios', 'chart'],
  ['/equipe', 'Equipe', 'users'],
  ['/importar', 'Importar planilha', 'upload', true],
  ['/mais', 'Mais', 'more'],
];
const TABS = [
  ['/', 'Início', 'home'],
  ['/musicas', 'Músicas', 'music'],
  ['/setlists', 'Setlists', 'list'],
  ['/player', 'Player', 'headphones'],
  ['/mais', 'Mais', 'more'],
];

function isActive(navPath, current) {
  if (navPath === '/') return current === '/';
  const base = navPath.replace(/s$/, '');
  return current.startsWith(navPath) || current.startsWith(base + '/');
}

function layout(content) {
  const user = store.currentUser();
  const s = store.getState();
  const current = path();
  const admin = store.isAdmin();
  const pendingSuggestions = admin ? s.suggestions.filter((x) => x.status === 'pendente' && store.findSong(x.songId)?.ministryId === s.session.ministryId).length : 0;

  const navLinks = NAV.filter((n) => !n[3] || admin).map(([p, label, ic]) => el('a', { href: '#' + p, class: 'navlink' + (isActive(p, current) ? ' active' : '') },
    icon(ic), label, p === '/mais' && pendingSuggestions ? el('span', { class: 'count' }, pendingSuggestions) : null));

  const ministries = user.memberships.map((m) => s.ministries.find((x) => x.id === m.ministryId)).filter(Boolean);
  const minSelect = ministries.length > 1
    ? el('select', { class: 'ministry-select', 'aria-label': 'Ministério', onchange: (e) => { store.switchMinistry(e.target.value); go('/'); } },
      ministries.map((m) => el('option', { value: m.id, selected: m.id === s.session.ministryId }, m.name)))
    : el('span', { class: 'label' }, store.currentMinistry()?.name || '');

  return el('div', { class: 'shell' },
    el('nav', { class: 'sidenav', 'aria-label': 'Principal' },
      el('div', { class: 'brand' }, el('div', { class: 'brand-mark' }, 'R'), el('div', null, el('b', null, 'Repertório'), el('small', null, 'Louvor'))),
      navLinks.slice(0, 6),
      el('div', { class: 'nav-sep' }),
      navLinks.slice(6)),
    el('div', { class: 'main' },
      el('header', { class: 'topbar' },
        el('span', { class: 'mobile-brand' }, 'Repertório'),
        minSelect,
        el('span', { class: 'spacer' }),
        el('button', { class: 'user-chip', onclick: () => go('/mais'), title: 'Conta e configurações' },
          el('span', { class: 'avatar' }, initials(user.name)),
          el('span', { class: 'uname small' }, user.name),
          el('span', { class: 'pill ' + (admin ? 'accent' : '') }, admin ? 'admin' : 'membro'))),
      !store.storageOk ? el('div', { class: 'demo-banner' }, 'Este navegador não está guardando dados. As alterações valem só até fechar a página; use Mais → Exportar backup.') : null,
      el('main', { class: 'content', id: 'content' }, content)),
    el('nav', { class: 'tabbar', 'aria-label': 'Abas' },
      TABS.map(([p, label, ic]) => el('a', { href: '#' + p, class: isActive(p, current) ? 'active' : '' }, icon(ic), label))));
}

function render() {
  if (cleanup) { try { cleanup(); } catch { /* ignora */ } cleanup = null; }
  const user = store.currentUser();
  if (!user) {
    clear(app).appendChild(renderLogin());
    return;
  }
  if (!store.membership()) {
    // usuário sem acesso ao ministério atual
    store.commit((s) => { s.session.ministryId = user.memberships[0]?.ministryId || null; }, { silent: true });
  }
  const p = path();
  let view = null;
  for (const [re, fn] of ROUTES) {
    const m = p.match(re);
    if (m) { view = fn(m); break; }
  }
  if (!view) view = el('div', { class: 'empty' }, el('strong', null, 'Página não encontrada'), el('a', { href: '#/' }, 'Voltar ao início'));
  let node = view;
  if (view && view.node) { node = view.node; cleanup = view.cleanup || null; }
  clear(app).appendChild(layout(node));
  window.scrollTo(0, 0);
}

// ---------- Inicialização ----------
store.load();
setRenderer(render);
// Qualquer alteração salva redesenha a página atual (o player salva em modo silencioso).
store.subscribe(() => { const y = window.scrollY; render(); window.scrollTo(0, y); });
window.addEventListener('hashchange', render);
render();

// Tema salvo (opcional)
try {
  const t = localStorage.getItem('repertorio-louvor.theme');
  if (t) document.documentElement.dataset.theme = t;
} catch { /* sem armazenamento */ }

// Service worker para funcionar offline (GitHub Pages / hospedagem própria)
if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top && !window.__NO_SW__) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
  toast('Algo deu errado: ' + (e.message || 'erro'), 'bad');
});
