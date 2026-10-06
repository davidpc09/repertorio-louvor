// Pequenos utilitários de interface, sem dependências externas.

/**
 * Cria um elemento DOM.
 * el('button', { class: 'btn', onclick: fn }, 'Salvar')
 * Props começando com "on" viram eventos; "class", "style", "html" e atributos comuns são tratados.
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === 'class') {
        node.className = v;
      } else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) node.style.setProperty(sk, sv);
          else node.style[sk] = sv;
        }
      } else if (k === 'html') {
        node.innerHTML = v;
      } else if (k === 'value') {
        node.value = v;
      } else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'multiple') {
        node[k] = !!v;
      } else if (k === 'dataset') {
        Object.assign(node.dataset, v);
      } else if (v === true) {
        node.setAttribute(k, '');
      } else {
        node.setAttribute(k, v);
      }
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(node, c);
    else if (c instanceof Node) node.appendChild(c);
    else node.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function uid(prefix = '') {
  const r = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
  return prefix + r.replace(/-/g, '').slice(0, 16);
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, kind = 'ok') {
  let t = document.getElementById('toast');
  if (!t) {
    t = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast ' + kind), 2600);
}

// ---------- Modal ----------
export function modal({ title, body, actions = [], wide = false, onClose }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const box = el('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' },
      el('h2', null, title),
      el('button', { class: 'icon-btn', 'aria-label': 'Fechar', onclick: close }, '×')),
    el('div', { class: 'modal-body' }, body),
    actions.length ? el('div', { class: 'modal-actions' },
      actions.map((a) => el('button', {
        class: 'btn ' + (a.kind || ''),
        onclick: async () => { const keep = await a.onClick?.(); if (keep !== true) close(); },
      }, a.label))) : null);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
  const first = box.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, box };
}

/** Confirmação dentro da página (confirm() nativo não funciona em todos os lugares). */
export function confirmBox(title, message, okLabel = 'Confirmar', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    modal({
      title,
      body: el('p', null, message),
      actions: [
        { label: 'Cancelar', kind: 'ghost', onClick: () => { answered = true; resolve(false); } },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => { answered = true; resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------- Formulários ----------
export function field(label, input, hint) {
  const id = input.id || uid('f');
  input.id = id;
  return el('div', { class: 'field' },
    el('label', { for: id }, label),
    input,
    hint ? el('small', { class: 'hint' }, hint) : null);
}

export function input(props) { return el('input', { type: 'text', ...props }); }
export function textarea(props) { return el('textarea', props); }
export function select(options, value, props = {}) {
  return el('select', props,
    options.map((o) => {
      const [v, l] = Array.isArray(o) ? o : [o, o];
      return el('option', { value: v, selected: v === value }, l);
    }));
}

/** Campo de etiquetas: texto separado por vírgula/ponto e vírgula, com sugestões. */
export function tagInput(values, suggestions, props = {}) {
  const listId = uid('dl');
  const inp = el('input', { type: 'text', value: values.join('; '), list: listId, ...props });
  const dl = el('datalist', { id: listId }, suggestions.map((s) => el('option', { value: s })));
  const wrap = el('div', null, inp, dl);
  wrap.getValues = () => splitList(inp.value);
  wrap.input = inp;
  return wrap;
}

export function splitList(s) {
  return String(s || '').split(/[;,|]/).map((x) => x.trim()).filter(Boolean);
}

// ---------- Datas ----------
export function today() {
  const d = new Date();
  return toISODate(d);
}
export function toISODate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function fmtDate(iso, withWeekday = true) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return (withWeekday ? DIAS[dt.getDay()] + ', ' : '') + `${d} ${MESES[m - 1]} ${y}`;
}
export function daysBetween(aIso, bIso) {
  const a = Date.parse(aIso + 'T00:00:00');
  const b = Date.parse(bIso + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
export function fmtDuration(sec) {
  if (!sec && sec !== 0) return '—';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Baixa um arquivo (no GitHub Pages funciona; dentro de alguns visualizadores o download pode ser bloqueado). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

export function initials(name) {
  return String(name || '?').replace(/\(.*\)/, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function pill(text, kind = '') {
  return el('span', { class: 'pill ' + kind }, text);
}

export function emptyState(title, text, action) {
  return el('div', { class: 'empty' }, el('strong', null, title), el('p', null, text), action || null);
}
