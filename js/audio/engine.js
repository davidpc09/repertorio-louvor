// Motor do player multipista (Web Audio API).
// - Todas as faixas começam no mesmo instante do relógio de áudio (sincronia por amostra).
// - Cada faixa tem um deslocamento (offset) = onde está o "tempo 0" dentro do arquivo.
// - O click é gerado aqui, no BPM e compasso da versão, agendado com antecedência
//   ("lookahead") para não atrasar mesmo com a tela ocupada.
// - Loop de uma parte: a troca é agendada no instante exato do fim da parte.
// - Modo palco: click (e guia, se marcada) num lado; música somada em mono no outro.

const AC = window.AudioContext || window.webkitAudioContext;
const LOOKAHEAD = 0.15; // segundos agendados à frente
const TICK_MS = 25;

export class PlayerEngine {
  constructor() {
    this.ctx = null;
    this.tracks = new Map(); // id -> {id, name, buffer, offset, volume, pan, mute, solo, guide, gain, panner}
    this.bpm = 120;
    this.beats = 4;
    this.click = { enabled: true, volume: 0.8, side: 'L', accent: true };
    this.countInBars = 1;
    this.stageMode = false;
    this.pending = null; // salto agendado {atPos, toPos, stop, tag}: base dos cues, loops e do mapa
    this.onTick = null;  // chamado a cada ciclo (o controlador de cues agenda os saltos aqui)
    this.onJump = null;  // chamado quando um salto agendado acontece
    this.playing = false;
    this.pausedPos = 0;
    this.segments = [];
    this.clickNodes = [];
    this.timer = null;
    this.countInEnd = 0;
    this.fallbackDuration = 300;
    this.onEnded = null;
    this.onState = null;
  }

  get spb() { return 60 / (this.bpm || 120); }

  ensureContext() {
    if (this.ctx) return this.ctx;
    if (!AC) throw new Error('Este navegador não tem suporte a áudio avançado (Web Audio).');
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.guideBus = ctx.createGain(); // faixas marcadas como "guia" vão para o lado do click no modo palco
    this.monoMix = ctx.createGain();
    this.monoMix.channelCount = 1;
    this.monoMix.channelCountMode = 'explicit';
    this.monoMix.channelInterpretation = 'speakers';
    this.musicPan = ctx.createStereoPanner();
    this.guideMono = ctx.createGain();
    this.guideMono.channelCount = 1;
    this.guideMono.channelCountMode = 'explicit';
    this.guideMono.channelInterpretation = 'speakers';
    this.guidePan = ctx.createStereoPanner();
    this.clickBus = ctx.createGain();
    this.clickPan = ctx.createStereoPanner();
    this.clickBus.connect(this.clickPan).connect(this.master);
    this.monoMix.connect(this.musicPan).connect(this.master);
    this.guideMono.connect(this.guidePan).connect(this.master);
    for (const t of this.tracks.values()) this.#wireTrack(t);
    this.applyRouting();
    return ctx;
  }

  async resume() {
    this.ensureContext();
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  // ---------- Faixas ----------
  async decode(arrayBuffer, economy = false) {
    const ctx = this.ensureContext();
    const buf = await new Promise((resolve, reject) => {
      const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
    if (!economy) return buf;
    // Economia de memória: mono, 24 kHz (≈ 4× menos memória; bom para ensaio no celular)
    const rate = 24000;
    if (buf.numberOfChannels === 1 && buf.sampleRate <= rate) return buf;
    const off = new OfflineAudioContext(1, Math.ceil(buf.duration * rate), rate);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    return off.startRendering();
  }

  setTrack(meta, buffer) {
    let t = this.tracks.get(meta.id);
    if (!t) { t = { ...meta }; this.tracks.set(meta.id, t); }
    Object.assign(t, meta);
    if (buffer) t.buffer = buffer;
    if (this.ctx && !t.gain) this.#wireTrack(t);
    else if (t.gain && t.routedGuide !== !!t.guide) this.#routeTrack(t);
    this.updateMix();
    return t;
  }

  removeTrack(id) {
    const t = this.tracks.get(id);
    if (!t) return;
    try { t.gain?.disconnect(); } catch { /* ok */ }
    this.tracks.delete(id);
  }

  #wireTrack(t) {
    const ctx = this.ctx;
    t.gain = ctx.createGain();
    t.panner = ctx.createStereoPanner();
    t.gain.connect(t.panner);
    this.#routeTrack(t);
  }

  #routeTrack(t) {
    try { t.panner.disconnect(); } catch { /* ok */ }
    t.panner.connect(t.guide ? this.guideBus : this.musicBus);
    t.routedGuide = !!t.guide;
  }

  updateMix() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const anySolo = [...this.tracks.values()].some((t) => t.solo);
    for (const t of this.tracks.values()) {
      if (!t.gain) continue;
      const g = t.mute || (anySolo && !t.solo) ? 0 : (t.volume ?? 1);
      t.gain.gain.setTargetAtTime(g, now, 0.015);
      t.panner.pan.setTargetAtTime(this.stageMode ? 0 : (t.pan || 0), now, 0.015);
    }
    this.clickBus.gain.setTargetAtTime(this.click.volume, now, 0.015);
  }

  /** Direciona click, guia e música conforme o lado escolhido e o modo palco. */
  applyRouting() {
    if (!this.ctx) return;
    const side = this.click.side === 'L' ? -1 : this.click.side === 'R' ? 1 : 0;
    try { this.musicBus.disconnect(); } catch { /* ok */ }
    try { this.guideBus.disconnect(); } catch { /* ok */ }
    this.clickPan.pan.value = side;
    if (this.stageMode && side !== 0) {
      this.musicBus.connect(this.monoMix);
      this.musicPan.pan.value = -side;
      this.guideBus.connect(this.guideMono);
      this.guidePan.pan.value = side;
    } else {
      this.musicBus.connect(this.master);
      this.guideBus.connect(this.master);
    }
    this.updateMix();
  }

  get duration() {
    let d = 0;
    for (const t of this.tracks.values()) if (t.buffer) d = Math.max(d, t.buffer.duration - (t.offset || 0));
    return d || this.fallbackDuration;
  }

  // ---------- Transporte ----------
  position() {
    if (!this.playing || !this.segments.length) return this.pausedPos;
    const now = this.ctx.currentTime;
    let seg = this.segments[0];
    for (const s of this.segments) if (s.ctx <= now) seg = s;
    return seg.pos + (now - seg.ctx);
  }

  async play(pos = this.pausedPos, { countIn = true } = {}) {
    await this.resume();
    this.#stopAll();
    const t0 = this.ctx.currentTime + 0.08;
    const ci = countIn && this.countInBars > 0 ? this.countInBars * this.beats * this.spb : 0;
    this.segments = [];
    this.pending = null;
    if (ci) this.segments.push({ ctx: t0, pos: pos - ci, sources: [], countIn: true });
    this.#startSegment(t0 + ci, pos);
    this.countInEnd = pos;
    this.clickSeg = 0;
    this.clickBeat = Math.ceil(this.segments[0].pos / this.spb - 1e-6);
    this.playing = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
    this.onState?.();
  }

  pause() {
    if (!this.playing) return;
    this.pausedPos = Math.max(0, this.position());
    this.#halt();
  }

  stop() {
    this.#halt();
    this.pausedPos = 0;
    this.onState?.();
  }

  #halt() {
    this.playing = false;
    this.pending = null;
    clearInterval(this.timer);
    this.#stopAll();
    this.segments = [];
    this.onState?.();
  }

  async seek(pos) {
    pos = Math.max(0, Math.min(pos, this.duration));
    if (this.playing) await this.play(pos, { countIn: false });
    else { this.pausedPos = pos; this.onState?.(); }
  }

  // ---------- Saltos agendados (cues) ----------
  /** Agenda um salto: ao chegar em atPos (posição musical), continua tocando de toPos, sem corte. */
  queueJump(jump) {
    if (this.pending?.armed) return false;
    this.pending = { ...jump, armed: false };
    return true;
  }

  cancelJump() {
    if (this.pending && !this.pending.armed) { this.pending = null; return true; }
    return false;
  }

  /** Durante a contagem, troca o ponto de partida sem perder a contagem. */
  replaceStart(toPos) {
    const last = this.segments[this.segments.length - 1];
    if (!this.playing || !last || this.ctx.currentTime >= last.ctx) return false;
    for (const src of last.sources) { try { src.stop(); } catch { /* ok */ } try { src.disconnect(); } catch { /* ok */ } }
    this.segments.pop();
    this.#startSegment(last.ctx, toPos);
    this.pending = null;
    return true;
  }

  /** Segundos de relógio até o salto pendente acontecer (para a contagem regressiva na tela). */
  timeToPending() {
    if (!this.pending || !this.playing) return null;
    if (this.pending.armed) return Math.max(0, this.pending.ctxTime - this.ctx.currentTime);
    return Math.max(0, this.pending.atPos - this.position());
  }

  setTempo(bpm, beats) {
    const wasPlaying = this.playing;
    const p = this.position();
    this.bpm = bpm || 120;
    this.beats = beats || 4;
    if (wasPlaying) this.play(p, { countIn: false });
  }

  #startSegment(ctxTime, pos) {
    const sources = [];
    for (const t of this.tracks.values()) {
      if (!t.buffer || !t.gain) continue;
      const bufPos = pos + (t.offset || 0);
      if (bufPos >= t.buffer.duration) continue;
      const src = this.ctx.createBufferSource();
      src.buffer = t.buffer;
      src.connect(t.gain);
      if (bufPos >= 0) src.start(ctxTime, bufPos);
      else src.start(ctxTime - bufPos, 0);
      sources.push(src);
    }
    const seg = { ctx: ctxTime, pos, sources };
    this.segments.push(seg);
    return seg;
  }

  #stopAll() {
    for (const s of this.segments) for (const src of s.sources) { try { src.stop(); } catch { /* ok */ } try { src.disconnect(); } catch { /* ok */ } }
    for (const n of this.clickNodes) { try { n.stop(); } catch { /* ok */ } }
    this.clickNodes = [];
  }

  #tick() {
    if (!this.playing) return;
    const now = this.ctx.currentTime;
    const ahead = now + LOOKAHEAD;

    // 1) Saltos agendados (cues, loop, mapa): o controlador decide, o motor executa no instante exato
    if (this.pending && this.pending.armed && this.pending.ctxTime <= now) {
      const j = this.pending;
      this.pending = null;
      if (j.stop) { this.#halt(); this.pausedPos = 0; this.onJump?.(j); this.onEnded?.(); return; }
      this.onJump?.(j);
    }
    try { this.onTick?.(this.position()); } catch (e) { console.error(e); }
    if (this.pending && !this.pending.armed) {
      const last = this.segments[this.segments.length - 1];
      const endCtx = last.ctx + (this.pending.atPos - last.pos);
      if (endCtx < ahead + 0.05) {
        const at = Math.max(endCtx, now + 0.005);
        const j = this.pending;
        j.armed = true;
        j.ctxTime = at;
        if (j.stop) {
          for (const src of last.sources) { try { src.stop(at); } catch { /* ok */ } }
          this.stopAt = at;
        } else if (Math.abs(j.toPos - j.atPos) > 1e-4) {
          for (const src of last.sources) { try { src.stop(at); } catch { /* ok */ } }
          this.#startSegment(at, j.toPos);
        }
        // salto para o mesmo ponto (partes vizinhas no mapa): só avisa, sem reiniciar o áudio
      }
    }

    // 2) Click
    const spb = this.spb;
    for (let guard = 0; guard < 64; guard++) {
      const seg = this.segments[this.clickSeg];
      if (!seg) break;
      const next = this.segments[this.clickSeg + 1];
      const beatPos = this.clickBeat * spb;
      const t = seg.ctx + (beatPos - seg.pos);
      if (next && t >= next.ctx - 1e-4) {
        this.clickSeg++;
        this.clickBeat = Math.ceil(next.pos / spb - 1e-6);
        continue;
      }
      if (t > ahead) break;
      if (this.pending?.armed && this.pending.stop && t >= this.pending.ctxTime - 1e-4) break;
      const inCountIn = !!seg.countIn;
      if (t >= now - 0.01 && (this.click.enabled || inCountIn)) {
        const down = ((this.clickBeat % this.beats) + this.beats) % this.beats === 0;
        this.#scheduleClick(t, down && this.click.accent, inCountIn);
      }
      this.clickBeat++;
    }

    // 3) Limpeza de segmentos antigos e fim da música
    while (this.segments.length > 2 && this.segments[1].ctx < now - 1) { this.segments.shift(); this.clickSeg = Math.max(0, this.clickSeg - 1); }
    if (!this.pending && this.position() > this.duration + 0.3) {
      this.#halt();
      this.pausedPos = 0;
      this.onEnded?.();
    }
  }

  #scheduleClick(t, accent, countIn) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.frequency.value = accent ? 1760 : countIn ? 1320 : 1100;
    osc.type = 'square';
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, t + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(env).connect(this.clickBus);
    osc.start(t);
    osc.stop(t + 0.06);
    this.clickNodes.push(osc);
    osc.onended = () => {
      env.disconnect();
      const i = this.clickNodes.indexOf(osc);
      if (i >= 0) this.clickNodes.splice(i, 1);
    };
  }

  // ---------- Saída de áudio ----------
  static get canSelectOutput() {
    return !!AC && 'setSinkId' in AC.prototype;
  }

  async listOutputs(askLabels = false) {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    if (askLabels) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { /* sem permissão: nomes podem vir vazios */ }
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    return list.filter((d) => d.kind === 'audiooutput');
  }

  async setOutput(deviceId) {
    this.ensureContext();
    if (!this.ctx.setSinkId) throw new Error('Este navegador não permite escolher a saída de áudio.');
    await this.ctx.setSinkId(deviceId === 'default' ? '' : deviceId);
  }

  dispose() {
    this.#halt();
    try { this.ctx?.close(); } catch { /* ok */ }
    this.ctx = null;
    this.tracks.clear();
  }
}
