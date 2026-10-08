// Cues e mapa da música, no estilo dos locators do Ableton Live.
//
// - Cada cue marca o início de uma parte (compasso). A parte vai até o compasso final informado.
// - Disparar um cue durante a música NÃO corta na hora: o salto fica na fila e acontece no próximo
//   ponto de quantização (próximo tempo, compasso, 2/4/8 compassos ou fim da parte), como a
//   "Global Quantization" do Ableton. O botão do cue pisca enquanto espera.
// - Com o motor parado, tocar num cue apenas move o cursor para ele (como no Ableton).
// - Ação ao terminar a parte (como as Follow Actions): continuar, repetir, ir para outro cue ou parar.
// - Mapa: sequência programada de partes com repetições (Intro → Verso → Refrão ×2 …). Com o mapa
//   ligado, o player segue a sequência sozinho, saltando no compasso certo. Disparar um cue manualmente
//   tem prioridade e o mapa continua a partir dali.

import { barToSeconds, beatsPerBar } from '../music.js';

export const QUANTIZE = [
  ['none', 'Imediato'],
  ['beat', '1 tempo'],
  ['bar', '1 compasso'],
  ['2bar', '2 compassos'],
  ['4bar', '4 compassos'],
  ['8bar', '8 compassos'],
  ['section', 'Fim da parte'],
];

export const FOLLOW = [
  ['next', 'Continuar'],
  ['loop', 'Repetir esta parte'],
  ['stop', 'Parar'],
];

export const CUE_COLORS = ['#c0392b', '#d35400', '#c99a06', '#2e8b57', '#16a085', '#2c7fb8', '#5b4bc4', '#a23b72', '#6b7280'];

export class CueController {
  constructor(engine, getVersion) {
    this.engine = engine;
    this.getVersion = getVersion;
    this.quantize = 'bar';
    this.mapOn = false;
    this.mapIndex = 0;
    this.repeatLeft = 1;
    this.loopId = null;     // parte em loop manual (botão Repetir parte)
    this.userNext = null;   // cue disparado enquanto outro salto já estava travado
    this.listeners = new Set();
    engine.onTick = (p) => this.tick(p);
    engine.onJump = (j) => this.handleJump(j);
  }

  dispose() {
    if (this.engine.onTick) this.engine.onTick = null;
    if (this.engine.onJump) this.engine.onJump = null;
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() { this.listeners.forEach((fn) => fn()); }

  // ---------- Geometria ----------
  get v() { return this.getVersion(); }
  get barLen() { return beatsPerBar(this.v.timeSig) * (60 / (this.engine.bpm || 120)); }
  cues() { return [...(this.v.sections || [])].sort((a, b) => a.startBar - b.startBar); }
  find(id) { return (this.v.sections || []).find((s) => s.id === id) || null; }
  startOf(cue) { return barToSeconds(cue.startBar, this.engine.bpm, this.v.timeSig); }
  endOf(cue) { return barToSeconds(cue.endBar + 1, this.engine.bpm, this.v.timeSig); }

  /** Parte que contém a posição p (em segundos a partir do tempo 0). */
  sectionAt(p) {
    if (p < 0) return null;
    const bar = Math.floor(p / this.barLen + 1e-6) + 1;
    return this.cues().find((c) => bar >= c.startBar && bar <= c.endBar) || null;
  }

  /** Próximo ponto de quantização depois da posição p. */
  quantizedAt(p, mode = this.quantize) {
    const spb = 60 / (this.engine.bpm || 120);
    const tol = 0.03; // apertou um tiquinho depois do tempo: vale o próximo
    const grid = { beat: spb, bar: this.barLen, '2bar': this.barLen * 2, '4bar': this.barLen * 4, '8bar': this.barLen * 8 }[mode];
    if (mode === 'none') return p + 0.05;
    if (mode === 'section') {
      const cur = this.sectionAt(p);
      if (cur) return this.endOf(cur);
      mode = 'bar';
    }
    const g = grid || this.barLen;
    return Math.ceil((p + tol) / g) * g;
  }

  // ---------- Ações do usuário ----------
  /** Dispara um cue: com o player parado, posiciona; tocando, agenda o salto quantizado. */
  launch(id) {
    const cue = this.find(id);
    if (!cue) return;
    const e = this.engine;
    const to = this.startOf(cue);
    this.syncMapTo(id);
    if (!e.playing) {
      e.seek(to);
      this.emit();
      return;
    }
    const p = e.position();
    if (p < 0 && e.replaceStart(to)) { this.emit(); return; } // ainda na contagem
    if (e.pending?.armed) { this.userNext = id; this.emit(); return; }
    e.queueJump({ atPos: this.quantizedAt(p), toPos: to, tag: { type: 'user', id } });
    this.userNext = null;
    this.emit();
  }

  /** Pedal / teclas: próximo ou anterior cue em relação à parte atual. */
  step(delta) {
    const list = this.cues();
    if (!list.length) return;
    const queued = this.queuedId();
    const ref = queued ? this.find(queued) : this.sectionAt(Math.max(0, this.engine.position()));
    let idx = ref ? list.findIndex((c) => c.id === ref.id) : -1;
    idx = Math.min(list.length - 1, Math.max(0, idx + delta));
    this.launch(list[idx].id);
  }

  cancel() {
    this.userNext = null;
    const j = this.engine.pending;
    if (j && !j.armed && j.tag?.type === 'user') this.engine.cancelJump();
    this.emit();
  }

  setLoop(id) {
    this.loopId = id;
    this.refreshAuto();
    if (id && !this.engine.playing) {
      const c = this.find(id);
      if (c) this.engine.seek(this.startOf(c));
    }
    this.emit();
  }

  setMap(on) {
    this.mapOn = on;
    if (on) this.resyncMap(true);
    this.refreshAuto();
    this.emit();
  }

  setQuantize(q) {
    this.quantize = q;
    const j = this.engine.pending;
    if (j && !j.armed && j.tag?.type === 'user') {
      j.atPos = this.quantizedAt(this.engine.position());
    }
    this.emit();
  }

  /** Volta o mapa para o início (ao tocar do começo). */
  resetMap() {
    this.mapIndex = 0;
    this.repeatLeft = this.arrangement()[0]?.repeats || 1;
    this.emit();
  }

  /** Configurações mudaram: descarta o salto automático ainda não travado e recalcula. */
  refreshAuto() {
    const j = this.engine.pending;
    if (j && !j.armed && j.tag?.type !== 'user') this.engine.cancelJump();
  }

  // ---------- Mapa ----------
  arrangement() { return (this.v.arrangement || []).filter((s) => this.find(s.sectionId)); }

  syncMapTo(id) {
    const arr = this.arrangement();
    if (!arr.length) return;
    let idx = arr.findIndex((s, i) => i >= this.mapIndex && s.sectionId === id);
    if (idx < 0) idx = arr.findIndex((s) => s.sectionId === id);
    if (idx >= 0) { this.mapIndex = idx; this.repeatLeft = arr[idx].repeats || 1; }
  }

  /** Garante que o passo atual do mapa corresponde à parte que está tocando. */
  resyncMap(force = false) {
    const arr = this.arrangement();
    if (!arr.length) return;
    const cur = this.sectionAt(Math.max(0, this.engine.position()));
    if (!cur) return;
    if (!force && arr[this.mapIndex]?.sectionId === cur.id) return;
    this.syncMapTo(cur.id);
  }

  // ---------- Ciclo (chamado pelo motor ~40×/s) ----------
  tick(p) {
    this.autoTick(p);
    this.panicTick(p);
  }

  /** Pânico ligado: descobre o instante exato do próximo cue e agenda a volta das faixas nele. */
  panicTick(p) {
    const e = this.engine;
    const pn = e.panic;
    if (!pn?.active || pn.restoreCtx != null || !e.playing) return;
    const j = e.pending;
    if (j) {
      if (j.stop) return;                         // a música vai acabar: nada a religar
      if (j.armed) e.panicOff(j.ctxTime);         // salto já travado: as faixas voltam no instante dele
      return;                                     // ainda não travou: o motor trava ~0,2 s antes
    }
    // sem salto à vista: o próximo cue na ordem natural
    const nxt = this.cues().find((c) => this.startOf(c) > p + 0.02);
    if (!nxt) return;                             // sem cue pela frente: segue mudo até o fim
    const secs = this.startOf(nxt) - p;
    if (secs <= 0.25) e.panicOff(e.ctx.currentTime + secs);
  }

  autoTick(p) {
    const e = this.engine;
    if (e.pending) return;
    if (this.userNext) {
      const id = this.userNext;
      this.userNext = null;
      const cue = this.find(id);
      if (cue) e.queueJump({ atPos: this.quantizedAt(p), toPos: this.startOf(cue), tag: { type: 'user', id } });
      this.emit();
      return;
    }
    if (p < 0) return;
    const cur = this.sectionAt(p);
    if (!cur) return;
    const end = this.endOf(cur);
    if (end <= p) return;

    // 1) loop manual
    if (this.loopId === cur.id) {
      e.queueJump({ atPos: end, toPos: this.startOf(cur), tag: { type: 'loop', id: cur.id } });
      return;
    }
    // 2) mapa programado
    const arr = this.arrangement();
    if (this.mapOn && arr.length) {
      if (arr[this.mapIndex]?.sectionId !== cur.id) this.resyncMap();
      const stepNow = arr[this.mapIndex];
      if (stepNow && stepNow.sectionId === cur.id) {
        if (this.repeatLeft > 1) {
          e.queueJump({ atPos: end, toPos: this.startOf(cur), tag: { type: 'map-repeat', id: cur.id } });
        } else if (arr[this.mapIndex + 1]) {
          const nxt = this.find(arr[this.mapIndex + 1].sectionId);
          e.queueJump({ atPos: end, toPos: this.startOf(nxt), tag: { type: 'map-next', index: this.mapIndex + 1, id: nxt.id } });
        } else {
          e.queueJump({ atPos: end, toPos: end, stop: true, tag: { type: 'map-end' } });
        }
        return;
      }
    }
    // 3) ação ao terminar a parte
    const follow = cur.follow || 'next';
    if (follow === 'loop') e.queueJump({ atPos: end, toPos: this.startOf(cur), tag: { type: 'follow', id: cur.id } });
    else if (follow === 'stop') e.queueJump({ atPos: end, toPos: end, stop: true, tag: { type: 'follow-stop' } });
    else if (follow.startsWith('go:')) {
      const target = this.find(follow.slice(3));
      if (target) e.queueJump({ atPos: end, toPos: this.startOf(target), tag: { type: 'follow', id: target.id } });
    }
  }

  handleJump(j) {
    const t = j.tag || {};
    const arr = this.arrangement();
    if (t.type === 'user') this.syncMapTo(t.id);
    else if (t.type === 'map-repeat') this.repeatLeft = Math.max(1, this.repeatLeft - 1);
    else if (t.type === 'map-next') { this.mapIndex = t.index; this.repeatLeft = arr[t.index]?.repeats || 1; }
    else if (t.type === 'map-end') this.resetMap();
    // chegou a um cue com o pânico ainda ligado (o agendamento exato perdeu a vez): religa agora
    if (this.engine.panic?.active && this.engine.panic.restoreCtx == null && !j.stop) this.engine.panicOff();
    this.emit();
  }

  // ---------- Progresso e próximos cues (para a tela) ----------
  /** Onde estamos dentro do cue atual: fração, compasso e tempo. null fora de qualquer cue. */
  progress(p) {
    if (p < 0) return null;
    const cur = this.sectionAt(p);
    if (!cur) return null;
    const a = this.startOf(cur);
    const b = this.endOf(cur);
    const spb = 60 / (this.engine.bpm || 120);
    const into = Math.max(0, p - a);
    const bars = cur.endBar - cur.startBar + 1;
    const bar = Math.min(bars, Math.floor(into / this.barLen + 1e-6) + 1);
    const beat = Math.floor((into % this.barLen) / spb + 1e-6) + 1;
    return { cue: cur, frac: Math.min(1, into / (b - a)), bar, bars, beat, secsLeft: Math.max(0, b - p) };
  }

  /**
   * Próximos cues na ordem em que vão tocar: [{ cue, inSec, exact, kind }].
   * O primeiro vem do salto já agendado (cue disparado, repetição, mapa) ou, sem salto, do próximo cue na ordem.
   * Os seguintes seguem o mapa (se ligado) ou a ordem dos cues; o tempo deles é uma estimativa (exact: false).
   * Quando a música vai terminar, o primeiro item é { end: true }.
   */
  upcoming(p, count = 3) {
    const e = this.engine;
    const list = this.cues();
    const j = e.pending;
    let first = null;
    let tagIndex = null;
    if (e.playing && j) {
      const inSec = Math.max(0, e.timeToPending() ?? 0);
      if (j.stop) return [{ cue: null, end: true, inSec, exact: true, kind: 'end' }];
      const cue = list.find((c) => Math.abs(this.startOf(c) - j.toPos) < 1e-3) || this.find(j.tag?.id);
      if (cue) { first = { cue, inSec, exact: true, kind: j.tag?.type || 'next' }; tagIndex = j.tag?.index ?? null; }
    }
    if (!first) {
      const nxt = list.find((c) => this.startOf(c) > p + 0.02);
      if (nxt) first = { cue: nxt, inSec: e.playing ? this.startOf(nxt) - p : null, exact: true, kind: 'next' };
    }
    if (!first) return [];
    const out = [first];

    const arr = this.arrangement();
    let idx = -1;
    if (this.mapOn && arr.length) {
      if (tagIndex != null) idx = tagIndex;
      else if (first.kind === 'map-repeat') idx = this.mapIndex;
      else {
        idx = arr.findIndex((s, i) => i >= this.mapIndex && s.sectionId === first.cue.id);
        if (idx < 0) idx = arr.findIndex((s) => s.sectionId === first.cue.id);
      }
    }
    let cur = first.cue;
    let t = first.inSec;
    let reps = first.kind === 'map-repeat' ? Math.max(1, this.repeatLeft - 1) : (idx >= 0 ? arr[idx].repeats || 1 : 1);
    while (out.length < count) {
      let next = null;
      if (idx >= 0) { idx++; next = arr[idx] ? this.find(arr[idx].sectionId) : null; }
      else { const i = list.findIndex((c) => c.id === cur.id); next = list[i + 1] || null; }
      if (!next) break;
      if (t != null) t += (this.endOf(cur) - this.startOf(cur)) * reps;
      out.push({ cue: next, inSec: t, exact: false, kind: 'later' });
      cur = next;
      reps = idx >= 0 ? arr[idx].repeats || 1 : 1;
    }
    return out;
  }

  /** Estado do pânico para o botão: o que volta e quando. */
  panicInfo() {
    const e = this.engine;
    if (!e.panic?.active) return null;
    const spb = 60 / (e.bpm || 120);
    const nxt = this.upcoming(e.position(), 1)[0];
    if (!nxt || nxt.end) return { label: null, beats: null };
    const beats = nxt.inSec == null ? null : Math.max(0, Math.ceil(nxt.inSec / spb - 0.05));
    return { label: nxt.cue.name, beats };
  }

  // ---------- Estado para a tela ----------
  queuedId() {
    if (this.userNext) return this.userNext;
    const t = this.engine.pending?.tag;
    return t?.type === 'user' ? t.id : null;
  }

  /** Texto do próximo salto: "Refrão em 3 tempos". */
  pendingInfo() {
    const j = this.engine.pending;
    if (!j || !this.engine.playing) return this.userNext ? { label: this.find(this.userNext)?.name, beats: null, user: true } : null;
    const secs = this.engine.timeToPending();
    const beats = Math.max(0, Math.ceil(secs / (60 / (this.engine.bpm || 120)) - 0.05));
    const t = j.tag || {};
    if (j.stop) return { label: 'Fim', beats, user: false };
    if (t.type === 'map-next' && Math.abs(j.toPos - j.atPos) < 1e-4) return { label: this.find(t.id)?.name, beats, user: false, seamless: true };
    const target = this.find(t.id);
    return { label: target?.name || '', beats, user: t.type === 'user', repeat: t.type === 'map-repeat' || t.type === 'loop' || (t.type === 'follow' && target && this.sectionAt(Math.max(0, this.engine.position()))?.id === target.id) };
  }
}
