// Navegação por hash (#/musicas, #/setlist/123…), separada para evitar importações circulares.
let renderFn = () => {};

export function setRenderer(fn) { renderFn = fn; }

export function path() {
  return (location.hash.replace(/^#/, '') || '/').split('?')[0];
}

export function go(p) {
  if (path() === p) renderFn();
  else location.hash = '#' + p;
}

/** Redesenha a página atual mantendo a rolagem (depois de salvar algo). */
export function refresh() {
  const y = window.scrollY;
  renderFn();
  window.scrollTo(0, y);
}
