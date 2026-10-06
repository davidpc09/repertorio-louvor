// Análise simples de áudio: forma de onda e detecção do primeiro ataque (para o "tempo 0").

function mono(buffer, start, end) {
  const chs = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
  const out = new Float32Array(end - start);
  for (let i = start; i < end; i++) {
    let s = 0;
    for (const ch of chs) s += ch[i];
    out[i - start] = s / chs.length;
  }
  return out;
}

/** Picos (0..1) em `buckets` faixas entre os segundos `from` e `to`. */
export function computePeaks(buffer, from, to, buckets) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.floor(from * sr));
  const b = Math.min(buffer.length, Math.floor(to * sr));
  const peaks = new Float32Array(buckets);
  if (b <= a) return peaks;
  const chs = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chs.push(buffer.getChannelData(c));
  const per = (b - a) / buckets;
  for (let k = 0; k < buckets; k++) {
    const s0 = Math.floor(a + k * per);
    const s1 = Math.min(b, Math.floor(a + (k + 1) * per));
    const step = Math.max(1, Math.floor((s1 - s0) / 400)); // amostragem para ser rápido
    let m = 0;
    for (let i = s0; i < s1; i += step) for (const ch of chs) { const v = Math.abs(ch[i]); if (v > m) m = v; }
    peaks[k] = m;
  }
  // normaliza pelo maior pico para enxergar faixas baixas
  let max = 0;
  for (const p of peaks) if (p > max) max = p;
  if (max > 0) for (let k = 0; k < buckets; k++) peaks[k] /= max;
  return peaks;
}

/**
 * Encontra o primeiro ataque relevante (em segundos).
 * Usa janelas de 10 ms: o primeiro trecho cuja energia passa de 12% da maior energia
 * (analisando até 60 s), refinado para a primeira amostra que sobe.
 */
export function detectOnset(buffer) {
  const sr = buffer.sampleRate;
  const end = Math.min(buffer.length, Math.floor(sr * 60));
  const data = mono(buffer, 0, end);
  const win = Math.max(64, Math.floor(sr * 0.01));
  const nWin = Math.floor(data.length / win);
  if (!nWin) return 0;
  const rms = new Float32Array(nWin);
  let max = 0;
  for (let w = 0; w < nWin; w++) {
    let s = 0;
    for (let i = w * win; i < (w + 1) * win; i++) s += data[i] * data[i];
    rms[w] = Math.sqrt(s / win);
    if (rms[w] > max) max = rms[w];
  }
  if (max < 1e-4) return 0;
  const thr = Math.max(0.004, max * 0.12);
  let first = -1;
  for (let w = 0; w < nWin; w++) if (rms[w] >= thr) { first = w; break; }
  if (first < 0) return 0;
  // refina: dentro da janela anterior + atual, primeira amostra acima de 30% do pico local
  const s0 = Math.max(0, (first - 1) * win);
  const s1 = Math.min(data.length, (first + 1) * win);
  let localPeak = 0;
  for (let i = s0; i < s1; i++) localPeak = Math.max(localPeak, Math.abs(data[i]));
  for (let i = s0; i < s1; i++) if (Math.abs(data[i]) >= localPeak * 0.3) return i / sr;
  return first * win / sr;
}
