// Leitura dos locators (cues) direto de um projeto do Ableton Live (.als).
//
// O .als é um XML compactado com gzip. Os locators ficam em LiveSet › Locators › Locators › Locator,
// cada um com <Time Value="…"/> em tempos de semínima (o "beat" do Ableton) e <Name Value="…"/>.
// O andamento e a fórmula de compasso vêm da faixa Master (Main no Live 12).
// Precisão: cada locator vira segundos exatos (sem arredondar), integrando o mapa de andamento
// do projeto, inclusive automação de BPM com rampas. O compasso só serve de rótulo na tela.

/** Lê o arquivo (.als compactado ou XML puro) e devolve o texto XML. */
export async function alsToXml(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador é antigo demais para abrir .als. Atualize o navegador ou use o CSV do timestamps.me.');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  return new TextDecoder('utf-8').decode(bytes);
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Valor do primeiro <Tag … Value="x"/> dentro de `xml`. */
function valueOf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b[^>]*\\bValue="([^"]*)"`));
  return m ? decodeXml(m[1]) : null;
}

/** Trecho do bloco <Tag>…</Tag> (o primeiro). */
function block(xml, tag) {
  const start = xml.search(new RegExp(`<${tag}[\\s>]`));
  if (start < 0) return null;
  const end = xml.indexOf(`</${tag}>`, start);
  return end < 0 ? null : xml.slice(start, end);
}

/**
 * Fórmula de compasso guardada pelo Live como número: (numerador − 1) + 99 × log2(denominador).
 * 201 = 4/4, 200 = 3/4, 302 = 6/8.
 */
export function decodeTimeSig(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 0) return null;
  const num = (n % 99) + 1;
  const den = 2 ** Math.floor(n / 99);
  if (num < 1 || num > 99 || den < 1 || den > 16) return null;
  return { num, den };
}

/**
 * Extrai do XML: andamento, fórmula de compasso e locators em ordem de tempo.
 * Retorna { bpm, timeSig: '4/4', beatsPerBar (em semínimas), locators: [{ name, beats, bar, offBeat }] }.
 */
export function parseAbletonXml(xml) {
  if (!/<Ableton\b/.test(xml) || !/<LiveSet\b/.test(xml)) throw new Error('Este arquivo não parece ser um projeto do Ableton Live (.als).');
  const master = block(xml, 'MasterTrack') || block(xml, 'MainTrack') || xml;

  const tempoBlock = block(master, 'Tempo');
  const bpmRaw = Number(tempoBlock ? valueOf(tempoBlock, 'Manual') : NaN);
  const bpm = Number.isFinite(bpmRaw) && bpmRaw > 0 ? bpmRaw : null;
  const tempoMap = buildTempoMap(master, tempoBlock, bpm || 120);

  const tsBlock = block(master, 'TimeSignature');
  const ts = (tsBlock && decodeTimeSig(valueOf(tsBlock, 'Manual'))) || { num: 4, den: 4 };
  const barBeats = ts.num * (4 / ts.den); // tamanho do compasso em semínimas

  const locators = [];
  const re = /<Locator\b[^>]*>([\s\S]*?)<\/Locator>/g;
  let m;
  while ((m = re.exec(xml))) {
    const time = Number(valueOf(m[1], 'Time'));
    if (!Number.isFinite(time) || time < 0) continue;
    const name = (valueOf(m[1], 'Name') || '').trim();
    const bar = Math.floor(time / barBeats + 1e-9) + 1; // rótulo: compasso da régua do Ableton
    locators.push({ name, beats: time, sec: beatsToSeconds(time, tempoMap), bar });
  }
  locators.sort((a, b) => a.beats - b.beats);
  locators.forEach((l, i) => { if (!l.name) l.name = `Cue ${i + 1}`; });
  return { bpm, timeSig: `${ts.num}/${ts.den}`, beatsPerBar: barBeats, tempoAutomated: tempoMap.length > 1, locators };
}

/**
 * Mapa de andamento: [{ beat, bpm }] em ordem. Sem automação, um ponto só.
 * Com automação, os pontos do envelope de Tempo da Master; entre dois pontos o BPM varia em linha reta
 * (é como o Ableton desenha a rampa na régua, que é em tempos).
 */
function buildTempoMap(master, tempoBlock, manual) {
  const target = tempoBlock && tempoBlock.match(/<AutomationTarget\b[^>]*\bId="(\d+)"/);
  if (!target) return [{ beat: 0, bpm: manual }];
  const re = /<AutomationEnvelope\b[^>]*>([\s\S]*?)<\/AutomationEnvelope>/g;
  let m;
  while ((m = re.exec(master))) {
    if (valueOf(m[1], 'PointeeId') !== target[1]) continue;
    const pts = [];
    const ev = /<FloatEvent\b[^>]*\bTime="([^"]+)"[^>]*\bValue="([^"]+)"/g;
    let e;
    while ((e = ev.exec(m[1]))) {
      const beat = Number(e[1]);
      const v = Number(e[2]);
      if (Number.isFinite(beat) && Number.isFinite(v) && v > 0) pts.push({ beat: Math.max(0, beat), bpm: v });
    }
    // o primeiro evento do Live fica num tempo negativo enorme: vale como valor inicial no tempo 0
    pts.sort((a, b) => a.beat - b.beat);
    const out = [];
    for (const p of pts) {
      if (out.length && out[out.length - 1].beat === p.beat && p.beat === 0) out[out.length - 1] = p;
      else out.push(p);
    }
    if (out.length) {
      if (out[0].beat > 0) out.unshift({ beat: 0, bpm: out[0].bpm });
      return out;
    }
  }
  return [{ beat: 0, bpm: manual }];
}

/** Segundos desde o tempo 0 até `beats`, integrando o mapa de andamento (rampas lineares em BPM). */
export function beatsToSeconds(beats, map) {
  let t = 0;
  for (let i = 0; i < map.length; i++) {
    const a = map[i];
    const b = map[i + 1];
    if (beats <= a.beat) break;
    const end = b ? Math.min(beats, b.beat) : beats;
    const db = end - a.beat;
    if (db <= 0) continue;
    const slope = b && b.beat > a.beat ? (b.bpm - a.bpm) / (b.beat - a.beat) : 0;
    if (Math.abs(slope) < 1e-12) t += (60 * db) / a.bpm;
    else t += (60 / slope) * Math.log((a.bpm + slope * db) / a.bpm);
    if (!b || beats <= b.beat) break;
  }
  return t;
}

/** Lê um File/ArrayBuffer .als e devolve o mesmo que parseAbletonXml. */
export async function readAbletonSet(buf) {
  return parseAbletonXml(await alsToXml(buf));
}
