// Tons, transposição de cifras e cálculo de compassos.

const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const NOTE_INDEX = {
  C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, 'E#': 5, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11,
};
// Tons que costumam ser escritos com bemóis
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm']);

export const KEYS = [
  'C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B',
  'Cm', 'C#m', 'Dm', 'D#m', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'G#m', 'Am', 'Bbm', 'Bm',
];

/** Normaliza a escrita de um tom: "g" → "G", "f#M" → "F#", "a min" → "Am". */
export function normalizeKey(k) {
  if (!k) return '';
  let s = String(k).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const m = s.match(/^([A-Ga-g])\s*([#b]?)\s*(m|min|menor|-)?/i);
  if (!m) return '';
  const root = m[1].toUpperCase() + (m[2] || '');
  const minor = m[3] && !/^M$/.test(m[3]) ? 'm' : '';
  if (!(root in NOTE_INDEX)) return '';
  return root + minor;
}

export function keyRoot(key) {
  const m = String(key || '').match(/^([A-G][#b]?)/);
  return m ? m[1] : null;
}

/** Diferença em semitons para levar `from` até `to` (−5..+6). */
export function semitonesBetween(from, to) {
  const a = NOTE_INDEX[keyRoot(from)];
  const b = NOTE_INDEX[keyRoot(to)];
  if (a === undefined || b === undefined) return 0;
  let d = (b - a + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}

function transposeNote(note, steps, useFlats) {
  const idx = NOTE_INDEX[note];
  if (idx === undefined) return note;
  const n = (idx + steps + 120) % 12;
  return (useFlats ? FLATS : SHARPS)[n];
}

export function transposeKey(key, steps) {
  const root = keyRoot(key);
  if (!root) return key;
  const minor = /m$/.test(key) ? 'm' : '';
  const target = transposeNote(root, steps, false);
  const flatVersion = transposeNote(root, steps, true);
  const useFlat = FLAT_KEYS.has(flatVersion + minor);
  return (useFlat ? flatVersion : target) + minor;
}

const CHORD_RE = /^([A-G])([#b]?)([^\s/]*)(?:\/([A-G])([#b]?))?$/;
// Qualidades aceitas depois da nota (evita confundir palavras da letra com acordes)
const QUALITY_RE = /^(m|maj|min|dim|aug|sus|add|M|º|°|\+|-|\d|\(|\)|b|#|7|9|11|13|M7|m7|7M)*$/;

export function isChordToken(tok) {
  const m = tok.match(CHORD_RE);
  if (!m) return false;
  return QUALITY_RE.test(m[3] || '');
}

export function transposeChord(chord, steps, useFlats) {
  const m = chord.match(CHORD_RE);
  if (!m) return chord;
  const root = transposeNote(m[1] + (m[2] || ''), steps, useFlats);
  const bass = m[4] ? '/' + transposeNote(m[4] + (m[5] || ''), steps, useFlats) : '';
  return root + (m[3] || '') + bass;
}

/** Uma linha é "de acordes" quando todos os tokens (fora marcações como | ou x2) são acordes. */
export function isChordLine(line) {
  const toks = line.trim().split(/\s+/).filter((t) => t && !/^(\||\(|\)|x\d+|\d+x|-+|\/)$/i.test(t));
  if (!toks.length) return false;
  return toks.every((t) => isChordToken(t.replace(/[()]/g, '')));
}

/**
 * Transpõe uma cifra no formato "acordes sobre a letra" e também acordes entre colchetes [G].
 * Mantém o alinhamento das colunas sempre que possível.
 */
export function transposeSheet(text, steps, targetKey) {
  if (!text) return '';
  if (!steps) return text;
  const useFlats = targetKey ? FLAT_KEYS.has(targetKey) || /b/.test(keyRoot(targetKey) || '') : false;
  return text.split('\n').map((line) => {
    // [G] inline (estilo ChordPro)
    line = line.replace(/\[([^\]\s]+)\]/g, (all, c) => (isChordToken(c) ? `[${transposeChord(c, steps, useFlats)}]` : all));
    if (!isChordLine(line)) return line;
    // Reconstrói mantendo a posição inicial de cada acorde
    let out = '';
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) {
      const tok = m[0];
      const clean = tok.replace(/[()]/g, '');
      const t = isChordToken(clean) ? tok.replace(clean, transposeChord(clean, steps, useFlats)) : tok;
      if (out.length < m.index) out += ' '.repeat(m.index - out.length);
      else if (out.length > 0 && !out.endsWith(' ')) out += ' ';
      out += t;
    }
    return out;
  }).join('\n');
}

/** Renderiza a cifra destacando as linhas de acordes. Retorna um <pre>. */
export function renderSheet(text, steps = 0, targetKey = '') {
  const pre = document.createElement('pre');
  pre.className = 'sheet';
  const t = transposeSheet(text || '', steps, targetKey);
  for (const line of t.split('\n')) {
    const span = document.createElement('span');
    if (isChordLine(line)) span.className = 'chords';
    else if (/^\s*\[?(intro|introdução|verso|estrofe|pré|pre|refrão|refrao|coro|ponte|final|solo|interlúdio|tag|outro)/i.test(line)) span.className = 'section-label';
    span.textContent = line + '\n';
    if (/\[[^\]]+\]/.test(line) && !isChordLine(line)) {
      span.textContent = '';
      line.split(/(\[[^\]\s]+\])/).forEach((part) => {
        if (/^\[[^\]\s]+\]$/.test(part) && isChordToken(part.slice(1, -1))) {
          const c = document.createElement('b');
          c.className = 'inline-chord';
          c.textContent = part.slice(1, -1);
          span.appendChild(c);
        } else span.appendChild(document.createTextNode(part));
      });
      span.appendChild(document.createTextNode('\n'));
    }
    pre.appendChild(span);
  }
  return pre;
}

// ---------- Tempo e compassos ----------
export function beatsPerBar(timeSig) {
  const n = parseInt(String(timeSig || '4/4').split('/')[0], 10);
  return n > 0 && n < 17 ? n : 4;
}

/** Tempo (s) do início do compasso N (1 = primeiro compasso, depois do tempo 0). */
export function barToSeconds(bar, bpm, timeSig) {
  const spb = 60 / (bpm || 120);
  return (bar - 1) * beatsPerBar(timeSig) * spb;
}

export function secondsToBar(sec, bpm, timeSig) {
  const spb = 60 / (bpm || 120);
  return Math.floor(sec / (beatsPerBar(timeSig) * spb)) + 1;
}

export function tempoLabel(bpm) {
  if (!bpm) return '';
  if (bpm < 76) return 'lenta';
  if (bpm < 110) return 'moderada';
  return 'rápida';
}
