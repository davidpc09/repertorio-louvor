import { el, clear, select, toast, uid, fmtDuration, emptyState, normalize, confirmBox, pill } from '../dom.js';
import { icon } from '../icons.js';
import * as store from '../store.js';
import { go } from '../nav.js';
import { PlayerEngine } from '../audio/engine.js';
import { computePeaks, detectOnset } from '../audio/analysis.js';
import { putTrack, getTrack, deleteTrack } from '../audio/trackstore.js';
import * as tracksync from '../cloud/tracksync.js';
import { beatsPerBar, barToSeconds } from '../music.js';
import { CueController, QUANTIZE, FOLLOW, CUE_COLORS } from '../audio/cues.js';

const engine = new PlayerEngine();
let loadedVersion = null;
const ui = { tab: 'tocar', zoom: 8, viewStart: 0, outputId: 'default', loopSectionId: null, loopVersion: null };

const prefs = (() => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('repertorio-louvor.player') || '{}'); } catch { /* ok */ }
  return {
    side: p.side || 'L', countIn: p.countIn ?? 1, clickVol: p.clickVol ?? 0.8, clickOn: p.clickOn ?? true, accent: p.accent ?? true,
    stage: p.stage ?? false, quantize: p.quantize || 'bar', mapOn: p.mapOn ?? true, economy: p.economy ?? /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent),
  };
})();
function savePrefs() { try { localStorage.setItem('repertorio-louvor.player', JSON.stringify(prefs)); } catch { /* ok */ } }

function applyPrefs() {
  engine.click.side = prefs.side;
  engine.click.volume = prefs.clickVol;
  engine.click.enabled = prefs.clickOn;
  engine.click.accent = prefs.accent;
  engine.countInBars = prefs.countIn;
  engine.stageMode = prefs.stage;
  engine.applyRouting();
}

function saveVersion(versionId, fn) {
  store.commit((s) => {
    for (const song of s.songs) {
      const v = song.versions.find((x) => x.id === versionId);
      if (v) { fn(v, song); return; }
    }
  }, { silent: true });
}

// ---------------- Escolher música ----------------
function renderPicker() {
  const s = store.getState();
  const t = new Date().toISOString().slice(0, 10);
  const next = s.setlists.filter((x) => x.ministryId === s.session.ministryId && x.date >= t && x.status !== 'rascunho').sort((a, b) => a.date.localeCompare(b.date))[0];
  const list = el('div', { class: 'list' });
  const q = el('input', { type: 'search', placeholder: 'Buscar música…', 'aria-label': 'Buscar música' });
  const draw = () => {
    clear(list);
    const term = normalize(q.value);
    const songs = store.songsOfMinistry().filter((x) => !term || normalize(x.title + ' ' + x.artist).includes(term)).sort((a, b) => a.title.localeCompare(b.title, 'pt'));
    for (const song of songs) for (const v of song.versions) {
      list.appendChild(el('a', { class: 'list-item', href: '#/player/' + v.id },
        el('span', { class: 'key-badge' }, v.keyMinistry || '—'),
        el('div', { class: 'grow' }, el('div', { class: 'title' }, song.title), el('div', { class: 'sub' }, [v.name, v.bpm ? v.bpm + ' bpm' : 'sem BPM', v.timeSig].join(' · '))),
        el('div', { class: 'meta' }, v.tracks.length ? pill(`${v.tracks.length} faixas`, 'ok') : el('span', { class: 'small muted hide-sm' }, 'só click'))));
    }
  };
  q.addEventListener('input', draw);
  draw();
  return el('div', { class: 'stack', style: { gap: '18px' } },
    el('div', { class: 'page-head' }, el('div', { class: 'grow' }, el('h1', null, 'Player'), el('p', null, 'Escolha a música para ensaiar com multipistas e click.'))),
    next ? el('section', { class: 'card stack' },
      el('h2', null, 'Próximo setlist'),
      el('div', { class: 'row' }, next.items.map((it) => {
        const song = store.findSong(it.songId);
        return el('a', { class: 'btn', href: '#/player/' + it.versionId }, song?.title || '?', ' ', el('span', { class: 'key-badge' }, it.key));
      }))) : null,
    el('div', { class: 'search' }, icon('search'), q),
    list);
}

// ---------------- Player ----------------
export function renderPlayer(versionId) {
  if (!versionId) { engine.pause(); return renderPicker(); }
  const found = store.findVersionAnywhere(versionId);
  if (!found) return emptyState('Versão não encontrada', '', el('a', { class: 'btn', href: '#/player' }, 'Voltar'));
  const { song, version: v } = found;
  const canEdit = store.canEditSongs();
  let raf = 0;
  let wakeLock = null;

  engine.ensureContext();
  applyPrefs();
  engine.fallbackDuration = v.durationSec || 300;
  if (loadedVersion !== v.id) {
    engine.stop();
    for (const id of [...engine.tracks.keys()]) engine.removeTrack(id);
    loadedVersion = v.id;
    ui.loopSectionId = null;
    ui.viewStart = 0;
  }
  engine.setTempo(v.bpm || 120, beatsPerBar(v.timeSig));

  const status = el('div', { class: 'small muted' });
  const root = el('div', { class: 'player' });
  const tabBody = el('div', { class: 'stack', style: { gap: '16px' } });

  // ---------- carregar faixas guardadas ----------
  async function loadStored() {
    const missing = [];
    let loadedAny = false;
    for (const t of v.tracks) {
      const existing = engine.tracks.get(t.id);
      if (existing?.buffer) { engine.setTrack(trackMeta(t)); continue; }
      status.textContent = `Carregando ${t.name}…`;
      const blob = await getTrack(v.id, t.id);
      if (!blob) { missing.push(t.name); engine.setTrack(trackMeta(t)); continue; }
      try {
        const buf = await engine.decode(await blob.arrayBuffer(), prefs.economy);
        engine.setTrack(trackMeta(t), buf);
        loadedAny = true;
      } catch { missing.push(t.name + ' (formato não suportado)'); }
    }
    status.textContent = missing.length ? `Arquivos que não estão neste aparelho: ${missing.join(', ')}. Carregue-os de novo na aba Faixas.` : (v.tracks.length ? `${v.tracks.length} faixas prontas${prefs.economy ? ' · modo economia de memória' : ''}` : '');
    if (loadedAny || missing.length) drawTab();
  }
  const trackMeta = (t) => ({ id: t.id, name: t.name, offset: t.offsetSec || 0, volume: t.volume ?? 1, pan: t.pan || 0, mute: !!t.mute, solo: !!t.solo, guide: !!t.guide });

  // ---------- cabeçalho ----------
  const playBtn = el('button', { class: 'play', 'aria-label': 'Tocar', onclick: togglePlay }, icon('play'));
  const clock = el('div', { class: 'clock' }, '1.1', el('small', null, '0:00'));
  const dots = el('div', { class: 'beat-dots', 'aria-hidden': 'true' });
  const drawDots = () => { clear(dots); for (let i = 0; i < engine.beats; i++) dots.appendChild(el('i')); };
  drawDots();

  async function togglePlay() {
    try {
      if (engine.playing) engine.pause();
      else {
        if (cues.mapOn) { if (engine.pausedPos < 0.05) cues.resetMap(); else cues.resyncMap(true); }
        await engine.play(engine.pausedPos, { countIn: true });
        // mantém a tela acesa durante o ensaio (quando o navegador permite)
        if (!wakeLock) navigator.wakeLock?.request('screen').then((w) => { wakeLock = w; w.addEventListener?.('release', () => { wakeLock = null; }); }).catch(() => {});
      }
    } catch (e) { toast(e.message || 'Não foi possível tocar', 'bad'); }
  }
  engine.onState = () => {
    clear(playBtn).appendChild(icon(engine.playing ? 'pause' : 'play'));
    playBtn.setAttribute('aria-label', engine.playing ? 'Pausar' : 'Tocar');
  };
  engine.onState();
  engine.onEnded = () => toast('Fim da música');

  const barLen = () => engine.beats * engine.spb;
  const posToBar = (p) => Math.floor(p / barLen()) + 1;
  const jumpBars = (d) => {
    const cur = Math.max(0, engine.position());
    const bar = Math.max(1, posToBar(cur + 0.05) + d);
    engine.seek(barToSeconds(bar, engine.bpm, `${engine.beats}/4`));
  };

  const bpmInput = el('input', { type: 'number', min: 30, max: 260, value: v.bpm || 120, style: { width: '84px' }, 'aria-label': 'BPM' });
  bpmInput.addEventListener('change', () => {
    const b = Math.min(260, Math.max(30, Number(bpmInput.value) || 120));
    engine.setTempo(b, engine.beats);
    if (canEdit) { saveVersion(v.id, (x) => { x.bpm = b; }); toast('BPM salvo na versão'); }
    drawTab();
  });

  const header = el('div', { class: 'stack', style: { gap: '12px' } },
    el('a', { href: '#/musica/' + song.id, class: 'small row', style: { gap: '4px' } }, icon('back', 16), song.title),
    el('div', { class: 'page-head', style: { marginBottom: 0 } },
      el('div', { class: 'grow' }, el('h1', null, song.title), el('p', null, [v.name, v.keyMinistry ? 'tom ' + v.keyMinistry : null, v.timeSig].filter(Boolean).join(' · '))),
      el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'BPM'), bpmInput)),
    el('div', { class: 'card transport' },
      playBtn,
      el('button', { class: 'btn', 'aria-label': 'Voltar ao início', onclick: () => { engine.stop(); } }, icon('stop')),
      el('button', { class: 'btn', 'aria-label': 'Compasso anterior', onclick: () => jumpBars(-1) }, icon('back')),
      el('button', { class: 'btn', 'aria-label': 'Próximo compasso', onclick: () => jumpBars(1) }, icon('next')),
      clock, dots,
      el('span', { style: { flex: 1 } }),
      status));

  // ---------- abas ----------
  const tabs = el('div', { class: 'tabs' });
  const drawTabs = () => {
    clear(tabs).append(
      el('button', { class: ui.tab === 'tocar' ? 'on' : '', onclick: () => { ui.tab = 'tocar'; drawTabs(); drawTab(); } }, 'Tocar'),
      el('button', { class: ui.tab === 'cues' ? 'on' : '', onclick: () => { ui.tab = 'cues'; drawTabs(); drawTab(); } }, `Cues e mapa (${v.sections.length})`),
      el('button', { class: ui.tab === 'faixas' ? 'on' : '', onclick: () => { ui.tab = 'faixas'; drawTabs(); drawTab(); } }, `Faixas e tempo 0 (${v.tracks.length})`),
      el('button', { class: ui.tab === 'saida' ? 'on' : '', onclick: () => { ui.tab = 'saida'; drawTabs(); drawTab(); } }, 'Click e saída'));
  };
  drawTabs();

  // ---------- Cues (marcadores) e mapa ----------
  const cues = new CueController(engine, () => v);
  cues.quantize = prefs.quantize;
  cues.mapOn = prefs.mapOn && (v.arrangement || []).length > 0;
  if (ui.loopVersion === v.id) cues.loopId = ui.loopSectionId; else { ui.loopSectionId = null; ui.loopVersion = v.id; }
  cues.resyncMap(true);
  window.__repertorio = { engine, cues }; // ajuda a depurar pelo console do navegador
  const colorOf = (c, i) => c.color || CUE_COLORS[i % CUE_COLORS.length];
  const sortedCues = () => cues.cues();
  const keyLabel = (i) => (i < 9 ? String(i + 1) : i === 9 ? '0' : '');

  // elementos atualizados a cada quadro
  let timeline = null; let headEl = null; let loopEl = null; let targetEl = null;
  let padEls = []; let flagEls = []; let stepEls = [];
  let nowLabel = null; let nextLabel = null; let cancelBtn = null;

  function drawTab() {
    clear(tabBody);
    const parts = ui.tab === 'tocar' ? tabPlay() : ui.tab === 'cues' ? tabCues() : ui.tab === 'faixas' ? tabTracks() : tabOutput();
    tabBody.append(...parts.filter(Boolean));
  }

  // ---------- Aba Tocar ----------
  function tabPlay() {
    const dur = timelineDur();
    const W = (sec) => (Math.max(0, Math.min(dur, sec)) / dur) * 100;
    const list = sortedCues();

    // Linha do arranjo: régua de cues em cima (como os locators do Ableton) e blocos das partes
    timeline = el('div', { class: 'arrangement', role: 'group', 'aria-label': 'Mapa da música' });
    const ruler = el('div', { class: 'cue-ruler' });
    const lane = el('div', { class: 'timeline', role: 'slider', 'aria-label': 'Posição na música', tabindex: 0 });
    flagEls = list.map((c, i) => {
      const nextStart = list[i + 1] ? W(cues.startOf(list[i + 1])) : 100;
      const f = el('button', { class: 'cue-flag', style: { left: W(cues.startOf(c)) + '%', maxWidth: `max(18px, calc(${nextStart - W(cues.startOf(c))}% - 2px))`, '--cue': colorOf(c, i) }, dataset: { id: c.id }, title: `Disparar ${c.name} (compasso ${c.startBar})`, onclick: () => cues.launch(c.id) }, c.name);
      ruler.appendChild(f);
      return f;
    });
    list.forEach((c, i) => {
      const a = cues.startOf(c); const b = cues.endOf(c);
      if (a >= dur) return;
      lane.appendChild(el('div', { class: 'sec', style: { left: W(a) + '%', width: (W(b) - W(a)) + '%', background: `color-mix(in srgb, ${colorOf(c, i)} 30%, transparent)` } }, c.name));
    });
    const nBars = Math.ceil(dur / barLen());
    if (nBars < 400) for (let k = 0; k <= nBars; k += nBars > 120 ? 4 : 1) lane.appendChild(el('div', { class: 'bar-tick', style: { left: W(k * barLen()) + '%' } }));
    loopEl = el('div', { class: 'loop-zone', hidden: true });
    targetEl = el('div', { class: 'cue-target', hidden: true });
    headEl = el('div', { class: 'head' });
    lane.append(loopEl, targetEl, headEl);
    lane.addEventListener('pointerdown', (e) => {
      const r = lane.getBoundingClientRect();
      const sec = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * dur;
      engine.seek(Math.floor(sec / barLen()) * barLen()); // sempre no início do compasso
    });
    lane.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') jumpBars(1); if (e.key === 'ArrowLeft') jumpBars(-1); });
    timeline.append(ruler, lane);

    // Barra de estado dos cues
    nowLabel = el('span', { class: 'cue-now' });
    nextLabel = el('span', { class: 'cue-next' });
    cancelBtn = el('button', { class: 'btn small', hidden: true, onclick: () => cues.cancel(), title: 'Esc' }, icon('x', 16), 'Cancelar');
    const quant = select(QUANTIZE, cues.quantize, { 'aria-label': 'Quantização dos cues', style: { width: 'auto', minHeight: '32px', padding: '2px 8px' }, onchange: (e) => { cues.setQuantize(e.target.value); prefs.quantize = e.target.value; savePrefs(); } });

    // Pads
    padEls = list.map((c, i) => el('button', { class: 'cue-pad', style: { '--cue': colorOf(c, i) }, dataset: { id: c.id }, onclick: () => cues.launch(c.id) },
      el('span', { class: 'cue-key' }, keyLabel(i)),
      el('b', null, c.name),
      el('small', null, `c. ${c.startBar}–${c.endBar}${c.follow === 'loop' ? ' · repete' : c.follow === 'stop' ? ' · para' : c.follow?.startsWith('go:') ? ' · → ' + (cues.find(c.follow.slice(3))?.name || '') : ''}`)));

    const loopBtn = el('button', { class: 'btn small' + (cues.loopId ? ' primary' : ''), title: 'L', onclick: () => {
      if (cues.loopId) cues.setLoop(null);
      else {
        const cur = cues.find(cues.queuedId()) || cues.sectionAt(Math.max(0, engine.position())) || list[0];
        if (!cur) { toast('Crie os cues da música para usar o loop.', 'bad'); return; }
        cues.setLoop(cur.id);
      }
      ui.loopSectionId = cues.loopId;
      drawTab();
    } }, icon('loop', 16), cues.loopId ? `Repetindo ${cues.find(cues.loopId)?.name || ''}` : 'Repetir parte');

    // Mapa
    const arr = cues.arrangement();
    const mapToggle = el('label', { class: 'row small switch', for: 'map-on' },
      el('input', { type: 'checkbox', id: 'map-on', checked: cues.mapOn, disabled: !arr.length, onchange: (e) => { cues.setMap(e.target.checked); prefs.mapOn = e.target.checked; savePrefs(); drawTab(); } }),
      'Seguir o mapa');
    stepEls = arr.map((st, i) => {
      const c = cues.find(st.sectionId);
      const ci = list.findIndex((x) => x.id === c.id);
      return el('button', { class: 'map-step', style: { '--cue': colorOf(c, ci) }, dataset: { index: i }, title: 'Ir para este passo do mapa', onclick: () => { cues.launch(c.id); cues.mapIndex = i; cues.repeatLeft = st.repeats || 1; } },
        c.name, (st.repeats || 1) > 1 ? el('small', null, ` ×${st.repeats}`) : null);
    });

    return [
      el('div', { class: 'stack', style: { gap: '6px' } }, timeline,
        el('div', { class: 'row small muted', style: { justifyContent: 'space-between' } }, el('span', null, 'Toque nas bandeiras para disparar o cue · na faixa para ir ao compasso'), el('span', { class: 'num' }, fmtDuration(dur)))),
      el('section', { class: 'card stack cue-panel' },
        el('div', { class: 'cue-status' },
          el('div', { class: 'stack', style: { gap: '2px', minWidth: 0 } }, nowLabel, nextLabel),
          el('div', { class: 'row' }, cancelBtn, el('span', { class: 'small muted' }, 'Quantização'), quant, loopBtn)),
        list.length ? el('div', { class: 'cue-pads' }, padEls)
          : el('p', { class: 'muted small' }, canEdit ? 'Nenhum cue ainda. Crie na aba “Cues e mapa” ou toque em Marcar cue aqui durante a música.' : 'Nenhum cue marcado ainda.'),
        el('div', { class: 'map-row' },
          mapToggle,
          arr.length ? el('div', { class: 'map-steps' }, stepEls) : el('span', { class: 'small muted' }, 'Sem mapa programado. Monte a sequência na aba “Cues e mapa”.')),
        canEdit ? el('div', { class: 'row' },
          el('button', { class: 'btn small', onclick: () => addCueAtPlayhead() }, icon('plus', 16), 'Marcar cue aqui'),
          el('button', { class: 'btn small ghost', onclick: () => { ui.tab = 'cues'; drawTabs(); drawTab(); } }, 'Editar cues e mapa')) : null),
      v.tracks.length ? caixaDrive({ compacto: true }) : null,
      mixer(),
      v.tracks.length ? null : el('div', { class: 'notice info' }, 'Sem multipistas: o click toca sozinho no BPM da música, e os cues funcionam do mesmo jeito. Para adicionar as faixas, use a aba “Faixas e tempo 0”.'),
    ];
  }

  /** Duração mostrada no mapa: a do áudio, ou até o último cue quando só há click. */
  function timelineDur() {
    const cueEnd = Math.max(0, ...sortedCues().map((c) => cues.endOf(c)));
    const hasAudio = [...engine.tracks.values()].some((t) => t.buffer);
    if (hasAudio) return Math.max(engine.duration, cueEnd);
    return cueEnd ? cueEnd + barLen() * 2 : engine.duration;
  }

  function refreshCueUI() {
    if (!nowLabel?.isConnected) return;
    const p = engine.position();
    const cur = cues.sectionAt(Math.max(0, p));
    const queued = cues.queuedId();
    const info = cues.pendingInfo();
    const bar = p < 0 ? 0 : Math.floor(p / barLen()) + 1;
    const arr = cues.arrangement();
    const step = cues.mapOn ? arr[cues.mapIndex] : null;
    const rep = step && step.sectionId === cur?.id && (step.repeats || 1) > 1 ? ` (${(step.repeats || 1) - cues.repeatLeft + 1}/${step.repeats})` : '';
    nowLabel.textContent = p < 0 ? 'Contagem…' : cur ? `Agora: ${cur.name}${rep} · compasso ${bar}` : `Compasso ${bar}`;
    if (info) {
      const when = info.beats === null ? 'na fila' : info.beats <= 0 ? 'agora' : `em ${info.beats} ${info.beats === 1 ? 'tempo' : 'tempos'}`;
      nextLabel.textContent = info.label === 'Fim' ? `Fim da música ${when}` : `${info.user ? 'Na fila' : info.repeat ? 'Repete' : 'A seguir'}: ${info.label} ${when}`;
      nextLabel.className = 'cue-next' + (info.user ? ' user' : '');
    } else {
      nextLabel.textContent = engine.playing ? (cur ? 'Segue normalmente' : '') : 'Parado: tocar num cue posiciona o cursor';
      nextLabel.className = 'cue-next';
    }
    cancelBtn.hidden = !queued;
    for (const b of padEls) {
      const id = b.dataset.id;
      b.classList.toggle('current', id === cur?.id && p >= 0);
      b.classList.toggle('queued', id === queued);
      b.classList.toggle('looping', id === cues.loopId);
    }
    for (const f of flagEls) f.classList.toggle('queued', f.dataset.id === queued);
    stepEls.forEach((s, i) => s.classList.toggle('current', cues.mapOn && i === cues.mapIndex));
    // alvo do salto pendente na linha do tempo
    const dur = timelineDur();
    const tgt = queued ? cues.find(queued) : null;
    if (tgt && targetEl) {
      targetEl.hidden = false;
      targetEl.style.left = (cues.startOf(tgt) / dur) * 100 + '%';
      targetEl.style.width = ((cues.endOf(tgt) - cues.startOf(tgt)) / dur) * 100 + '%';
    } else if (targetEl) targetEl.hidden = true;
    const lp = cues.loopId ? cues.find(cues.loopId) : null;
    if (loopEl) {
      if (lp) { loopEl.hidden = false; loopEl.style.left = (cues.startOf(lp) / dur) * 100 + '%'; loopEl.style.width = ((cues.endOf(lp) - cues.startOf(lp)) / dur) * 100 + '%'; } else loopEl.hidden = true;
    }
    if (headEl) headEl.style.left = (Math.max(0, Math.min(dur, p)) / dur) * 100 + '%';
  }

  function addCueAtPlayhead() {
    const bar = Math.max(1, Math.floor(Math.max(0, engine.position()) / barLen() + 0.0001) + 1);
    if (v.sections.some((c) => c.startBar === bar)) { toast(`Já existe um cue no compasso ${bar}.`, 'bad'); return; }
    saveVersion(v.id, (x) => {
      const list = [...x.sections].sort((a, b) => a.startBar - b.startBar);
      const prev = [...list].reverse().find((c) => c.startBar < bar);
      const next = list.find((c) => c.startBar > bar);
      const endBar = next ? next.startBar - 1 : Math.max(bar + 7, prev ? prev.endBar : bar);
      if (prev && prev.endBar >= bar) prev.endBar = bar - 1;
      x.sections.push({ id: uid('p'), name: `Cue ${x.sections.length + 1}`, startBar: bar, endBar, color: CUE_COLORS[x.sections.length % CUE_COLORS.length], follow: 'next' });
      x.sections.sort((a, b) => a.startBar - b.startBar);
    });
    toast(`Cue criado no compasso ${bar}`);
    drawTab();
  }

  // ---------- Aba Cues e mapa ----------
  function tabCues() {
    const list = sortedCues();
    const names = ['Intro', 'Verso 1', 'Verso 2', 'Pré-refrão', 'Refrão', 'Ponte', 'Solo', 'Interlúdio', 'Espontâneo', 'Refrão final', 'Tag', 'Final'];
    const edit = (id, patch) => { saveVersion(v.id, (x) => { Object.assign(x.sections.find((c) => c.id === id), patch); }); cues.refreshAuto(); };

    const rows = list.map((c, i) => {
      const followSel = select([...FOLLOW, ...list.filter((o) => o.id !== c.id).map((o) => ['go:' + o.id, 'Ir para ' + o.name])], c.follow || 'next',
        { 'aria-label': 'Ao terminar', disabled: !canEdit, onchange: (e) => { edit(c.id, { follow: e.target.value }); } });
      const colorSel = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Cor do cue' }, CUE_COLORS.map((col) => el('button', {
        class: 'swatch' + (colorOf(c, i) === col ? ' on' : ''), style: { background: col }, 'aria-label': 'Cor', 'aria-checked': String(colorOf(c, i) === col), role: 'radio', disabled: !canEdit,
        onclick: () => { edit(c.id, { color: col }); drawTab(); },
      })));
      const name = el('input', { type: 'text', value: c.name, list: 'cue-names', 'aria-label': 'Nome do cue', disabled: !canEdit });
      name.addEventListener('change', () => edit(c.id, { name: name.value.trim() || c.name }));
      const start = el('input', { type: 'number', min: 1, value: c.startBar, 'aria-label': 'Compasso inicial', disabled: !canEdit, style: { width: '74px' } });
      start.addEventListener('change', () => { edit(c.id, { startBar: Math.max(1, Number(start.value) || 1) }); saveVersion(v.id, (x) => x.sections.sort((a, b) => a.startBar - b.startBar)); drawTab(); });
      const end = el('input', { type: 'number', min: 1, value: c.endBar, 'aria-label': 'Compasso final', disabled: !canEdit, style: { width: '74px' } });
      end.addEventListener('change', () => { edit(c.id, { endBar: Math.max(c.startBar, Number(end.value) || c.startBar) }); drawTab(); });
      return el('div', { class: 'cue-row', style: { '--cue': colorOf(c, i) } },
        el('span', { class: 'cue-key', title: 'Tecla de atalho' }, keyLabel(i) || '·'),
        el('div', { class: 'cue-row-main' },
          el('div', { class: 'row' }, name,
            el('span', { class: 'row small muted', style: { gap: '4px' } }, 'c.', start, 'até', end)),
          el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Ao terminar'), followSel, colorSel)),
        el('div', { class: 'row', style: { gap: '4px' } },
          el('button', { class: 'btn small', title: 'Disparar', onclick: () => cues.launch(c.id) }, icon('play', 14)),
          canEdit ? el('button', { class: 'btn small danger', 'aria-label': 'Excluir cue', onclick: () => {
            saveVersion(v.id, (x) => { x.sections = x.sections.filter((y) => y.id !== c.id); x.arrangement = (x.arrangement || []).filter((st) => st.sectionId !== c.id); });
            cues.refreshAuto(); drawTab();
          } }, icon('trash', 14)) : null));
    });

    // Mapa
    const arr = v.arrangement || [];
    const mapRows = arr.map((st, i) => {
      const c = cues.find(st.sectionId);
      const sel = select(list.map((o) => [o.id, o.name]), st.sectionId, { 'aria-label': 'Parte', disabled: !canEdit, style: { width: 'auto', flex: '1 1 140px' }, onchange: (e) => { saveVersion(v.id, (x) => { x.arrangement[i].sectionId = e.target.value; }); cues.refreshAuto(); drawTab(); } });
      const reps = el('input', { type: 'number', min: 1, max: 16, value: st.repeats || 1, 'aria-label': 'Vezes', disabled: !canEdit, style: { width: '64px' } });
      reps.addEventListener('change', () => { saveVersion(v.id, (x) => { x.arrangement[i].repeats = Math.min(16, Math.max(1, Number(reps.value) || 1)); }); cues.refreshAuto(); });
      const ci = list.findIndex((o) => o.id === c?.id);
      return el('div', { class: 'map-edit-row', style: { '--cue': c ? colorOf(c, ci) : 'var(--muted)' } },
        el('span', { class: 'pos' }, i + 1), sel, el('span', { class: 'small muted' }, '×'), reps,
        canEdit ? el('button', { class: 'icon-btn', 'aria-label': 'Subir', disabled: i === 0, onclick: () => { saveVersion(v.id, (x) => { [x.arrangement[i - 1], x.arrangement[i]] = [x.arrangement[i], x.arrangement[i - 1]]; }); cues.refreshAuto(); drawTab(); } }, icon('up', 16)) : null,
        canEdit ? el('button', { class: 'icon-btn', 'aria-label': 'Descer', disabled: i === arr.length - 1, onclick: () => { saveVersion(v.id, (x) => { [x.arrangement[i + 1], x.arrangement[i]] = [x.arrangement[i], x.arrangement[i + 1]]; }); cues.refreshAuto(); drawTab(); } }, icon('down', 16)) : null,
        canEdit ? el('button', { class: 'icon-btn', 'aria-label': 'Remover passo', onclick: () => { saveVersion(v.id, (x) => { x.arrangement.splice(i, 1); }); cues.refreshAuto(); drawTab(); } }, icon('x', 16)) : null);
    });
    const addSel = select(list.map((o) => [o.id, o.name]), list[0]?.id, { 'aria-label': 'Parte para adicionar ao mapa', style: { width: 'auto' } });
    const typed = el('input', { type: 'text', placeholder: 'Ex.: Intro, Verso 1, Refrão x2, Ponte, Refrão x2, Final', 'aria-label': 'Ordem do mapa em texto' });

    const applyTyped = () => {
      const steps = [];
      const missing = [];
      for (const raw of typed.value.split(/[,;\n>]+/)) {
        const m = raw.trim().match(/^(.*?)(?:\s*[x×]\s*(\d+))?$/i);
        if (!m || !m[1].trim()) continue;
        const nm = normalize(m[1]);
        const c = list.find((o) => normalize(o.name) === nm) || list.find((o) => normalize(o.name).startsWith(nm));
        if (!c) { missing.push(m[1].trim()); continue; }
        steps.push({ id: uid('m'), sectionId: c.id, repeats: Math.min(16, Number(m[2]) || 1) });
      }
      if (missing.length) { toast('Cue não encontrado: ' + missing.join(', '), 'bad'); return; }
      if (!steps.length) return;
      saveVersion(v.id, (x) => { x.arrangement = steps; });
      cues.refreshAuto(); toast('Mapa montado'); drawTab();
    };

    return [
      el('datalist', { id: 'cue-names' }, names.map((n) => el('option', { value: n }))),
      el('section', { class: 'card stack' },
        el('div', { class: 'card-head' }, el('h2', null, `Cues (${list.length})`),
          canEdit ? el('div', { class: 'row' },
            el('button', { class: 'btn small', onclick: () => addCueAtPlayhead() }, icon('plus', 16), 'Cue no compasso atual'),
            el('button', { class: 'btn small', onclick: () => {
              const last = list[list.length - 1];
              const startBar = last ? last.endBar + 1 : 1;
              saveVersion(v.id, (x) => { x.sections.push({ id: uid('p'), name: x.sections.length ? 'Nova parte' : 'Intro', startBar, endBar: startBar + 7, color: CUE_COLORS[x.sections.length % CUE_COLORS.length], follow: 'next' }); });
              drawTab();
            } }, 'Cue no fim'),
            el('button', { class: 'btn small ghost', title: 'Cada parte termina um compasso antes do próximo cue', onclick: () => {
              saveVersion(v.id, (x) => { const l = [...x.sections].sort((a, b) => a.startBar - b.startBar); l.forEach((c, i) => { if (l[i + 1]) c.endBar = Math.max(c.startBar, l[i + 1].startBar - 1); }); });
              cues.refreshAuto(); toast('Fins ajustados'); drawTab();
            } }, 'Ajustar fins')) : null),
        el('p', { class: 'small muted' }, 'Cada cue marca o início de uma parte, em compassos contados a partir do tempo 0. As teclas 1 a 9 e 0 disparam os dez primeiros.'),
        list.length ? el('div', { class: 'cue-list' }, rows) : el('p', { class: 'muted' }, 'Nenhum cue ainda.')),
      el('section', { class: 'card stack' },
        el('div', { class: 'card-head' }, el('h2', null, 'Mapa da música'),
          canEdit && list.length ? el('button', { class: 'btn small ghost', onclick: () => { saveVersion(v.id, (x) => { x.arrangement = [...x.sections].sort((a, b) => a.startBar - b.startBar).map((c) => ({ id: uid('m'), sectionId: c.id, repeats: 1 })); }); cues.refreshAuto(); drawTab(); } }, 'Ordem dos cues') : null),
        el('p', { class: 'small muted' }, 'A sequência que o player segue sozinho quando “Seguir o mapa” está ligado. Cada passo pode repetir. Os saltos acontecem no fim de cada parte, no compasso exato.'),
        arr.length ? el('div', { class: 'stack', style: { gap: '6px' } }, mapRows) : el('p', { class: 'muted small' }, 'Mapa vazio.'),
        canEdit && list.length ? el('div', { class: 'row' }, addSel, el('button', { class: 'btn small', onclick: () => { saveVersion(v.id, (x) => { (x.arrangement ||= []).push({ id: uid('m'), sectionId: addSel.value, repeats: 1 }); }); cues.refreshAuto(); drawTab(); } }, icon('plus', 16), 'Adicionar passo')) : null,
        canEdit && list.length ? el('div', { class: 'row' }, el('div', { style: { flex: '1 1 260px' } }, typed), el('button', { class: 'btn small', onclick: applyTyped }, 'Montar pelo texto')) : null),
      el('section', { class: 'card stack' },
        el('h2', null, 'Como funciona (igual ao Ableton Live)'),
        el('ul', { class: 'small', style: { margin: 0, paddingLeft: '18px', display: 'grid', gap: '4px' } },
          el('li', null, el('b', null, 'Cues'), ' são os locators: marcadores no início de cada parte.'),
          el('li', null, el('b', null, 'Quantização'), ': ao disparar um cue com a música tocando, o salto espera o próximo tempo, compasso ou fim da parte. O botão pisca enquanto espera; Esc cancela.'),
          el('li', null, el('b', null, 'Ao terminar'), ' funciona como as Follow Actions: continuar, repetir a parte, ir para outro cue ou parar.'),
          el('li', null, el('b', null, 'Mapa'), ': a ordem programada da música. Disparar um cue manualmente tem prioridade e o mapa segue a partir dele.'),
          el('li', null, el('b', null, 'Atalhos'), ': Espaço toca/pausa · 1–9 e 0 disparam cues · → ou Page Down próximo cue · ← ou Page Up anterior · L repete a parte · M liga o mapa · Esc cancela. Pedais de virar página (Bluetooth) costumam enviar Page Down/Up e funcionam direto.'))),
    ];
  }

  function mixer() {
    const strips = [];
    const clickStrip = el('div', { class: 'strip click-strip' },
      el('div', { class: 'tname' }, 'Click', el('small', null, `${engine.bpm} bpm · lado ${prefs.side === 'L' ? 'esquerdo' : prefs.side === 'R' ? 'direito' : 'centro'}`)),
      el('div', { class: 'ms' }, el('button', { class: 'm' + (prefs.clickOn ? '' : ' on'), 'aria-label': 'Silenciar click', 'aria-pressed': String(!prefs.clickOn), onclick: (e) => { prefs.clickOn = !prefs.clickOn; engine.click.enabled = prefs.clickOn; savePrefs(); e.currentTarget.classList.toggle('on'); } }, 'M')),
      el('label', { class: 'vol' }, 'Volume', (() => { const r = el('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: prefs.clickVol }); r.addEventListener('input', () => { prefs.clickVol = Number(r.value); engine.click.volume = prefs.clickVol; engine.updateMix(); savePrefs(); }); return r; })()),
      el('div', { class: 'side-toggle', role: 'group', 'aria-label': 'Lado do click' }, ['L', 'C', 'R'].map((sd) => el('button', { class: prefs.side === sd ? 'on' : '', onclick: () => { prefs.side = sd; savePrefs(); applyPrefs(); drawTab(); } }, sd))));
    strips.push(clickStrip);
    for (const t of v.tracks) {
      const et = engine.tracks.get(t.id);
      const upd = (patch) => {
        saveVersion(v.id, (x) => Object.assign(x.tracks.find((y) => y.id === t.id), patch));
        Object.assign(t, patch);
        engine.setTrack(trackMeta(t));
      };
      strips.push(el('div', { class: 'strip' },
        el('div', { class: 'tname' }, t.name, el('small', null, et?.buffer ? (t.guide ? 'guia · ' : '') + fmtDuration(et.buffer.duration) : 'arquivo não carregado')),
        el('div', { class: 'ms' },
          el('button', { class: 'm' + (t.mute ? ' on' : ''), 'aria-label': 'Mudo ' + t.name, 'aria-pressed': String(!!t.mute), onclick: (e) => { upd({ mute: !t.mute }); e.currentTarget.classList.toggle('on', !!t.mute); } }, 'M'),
          el('button', { class: 's' + (t.solo ? ' on' : ''), 'aria-label': 'Solo ' + t.name, 'aria-pressed': String(!!t.solo), onclick: (e) => { upd({ solo: !t.solo }); e.currentTarget.classList.toggle('on', !!t.solo); } }, 'S')),
        el('label', { class: 'vol' }, 'Volume', (() => { const r = el('input', { type: 'range', min: 0, max: 1.5, step: 0.01, value: t.volume ?? 1 }); r.addEventListener('input', () => { t.volume = Number(r.value); engine.setTrack(trackMeta(t)); }); r.addEventListener('change', () => upd({ volume: Number(r.value) })); return r; })()),
        el('label', { class: 'pan' }, prefs.stage ? 'Pan (modo palco: mono)' : 'Pan', (() => { const r = el('input', { type: 'range', min: -1, max: 1, step: 0.05, value: t.pan || 0, disabled: prefs.stage }); r.addEventListener('input', () => { t.pan = Number(r.value); engine.setTrack(trackMeta(t)); }); r.addEventListener('change', () => upd({ pan: Number(r.value) })); return r; })())));
    }
    return el('section', { class: 'stack', style: { gap: '8px' } },
      el('div', { class: 'row', style: { justifyContent: 'space-between' } }, el('h2', null, 'Mixer'),
        el('label', { class: 'row small', for: 'stage-mode' }, el('input', { type: 'checkbox', id: 'stage-mode', checked: prefs.stage, onchange: (e) => { prefs.stage = e.target.checked; savePrefs(); applyPrefs(); drawTab(); } }), 'Modo palco')),
      prefs.stage ? el('p', { class: 'small muted' }, prefs.side === 'C' ? 'Escolha o lado L ou R para o click: no modo palco a música vai em mono para o lado oposto.' : `Click${v.tracks.some((t) => t.guide) ? ' e guia' : ''} no lado ${prefs.side === 'L' ? 'esquerdo' : 'direito'}; música em mono no lado ${prefs.side === 'L' ? 'direito' : 'esquerdo'}. Use um cabo P2 → 2 P10 para mandar cada lado a um canal da mesa.`) : null,
      el('div', { class: 'mixer' }, strips));
  }

  // ---------- Faixas no Drive do ministério ----------
  let baixa = null;   // { controle, geral } enquanto baixa

  /**
   * Caixa "Baixar para este aparelho". Aparece na aba Tocar (compacta) e na aba
   * Faixas (completa). Cada chamada cria um elemento novo e se preenche sozinha.
   */
  function caixaDrive({ compacto = false } = {}) {
    const box = el('div', { class: 'stack', style: { gap: '8px' } });

    async function pintar() {
      let st = { conectado: false };
      try { st = await tracksync.conectado(song.ministryId); } catch { /* offline */ }
      const sit = await tracksync.situacao(v);
      clear(box);
      if (!v.tracks.length) return;

      // nada a baixar e tudo aqui: só um aviso discreto na aba Faixas
      if (!sit.baixaveis.length) {
        if (compacto) return;
        const linhas = [el('span', { class: 'small muted' }, `${sit.aqui} de ${sit.total} faixas neste aparelho`)];
        if (st.conectado && sit.aqui) linhas.push(el('button', { class: 'btn small ghost', onclick: liberar }, icon('trash', 16), 'Apagar deste aparelho'));
        if (!st.conectado && sit.soLocais.length) linhas.push(el('span', { class: 'small muted' }, '· ainda não enviadas ao Drive'));
        box.appendChild(el('div', { class: 'row' }, linhas));
        return;
      }

      if (!st.conectado) {
        box.appendChild(el('div', { class: 'notice warn' },
          `${sit.baixaveis.length === sit.total ? 'As faixas' : 'Algumas faixas'} desta música não estão neste aparelho. `,
          store.isAdmin() ? 'Conecte o Google Drive do ministério em Mais › Google Drive para baixar em qualquer aparelho.'
            : 'Peça a um administrador para conectar o Google Drive do ministério.'));
        return;
      }

      const rotulo = el('span', null, `Baixar ${sit.baixaveis.length} faixa${sit.baixaveis.length > 1 ? 's' : ''}`,
        sit.bytes ? el('small', { class: 'muted' }, ' · ' + tracksync.mb(sit.bytes)) : null);
      const btn = el('button', { class: 'btn primary', onclick: () => baixar(pintar) }, icon('download', 18), rotulo);
      const info = el('span', { class: 'small muted' }, sit.aqui ? `${sit.aqui} de ${sit.total} já estão aqui` : 'nenhuma faixa neste aparelho ainda');
      box.appendChild(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, btn, info));
      if (!compacto) box.appendChild(el('p', { class: 'small muted' }, 'As faixas ficam guardadas no aparelho: depois disso o player toca sem internet.'));
    }

    async function baixar(depois) {
      if (baixa) return;
      const controle = new AbortController();
      baixa = { controle };
      const fill = el('div', { class: 'bar-fill', style: { width: '0%' } });
      const label = el('span', { class: 'small' }, 'Começando…');
      const cancelar = el('button', { class: 'btn small ghost', onclick: () => controle.abort() }, 'Cancelar');
      clear(box);
      box.append(el('div', { class: 'row', style: { justifyContent: 'space-between' } }, label, cancelar),
        el('div', { class: 'bar-track' }, fill));
      try {
        const r = await tracksync.baixarVersao(song, v, {
          sinal: controle.signal,
          aoProgredir: (p) => {
            fill.style.width = Math.round(p.geral * 100) + '%';
            label.textContent = `Baixando ${p.faixa} (${p.indice} de ${p.total})`;
          },
        });
        if (r.baixadas) toast(`${r.baixadas} faixa(s) baixada(s) para este aparelho`);
        else if (!r.falhas.length) toast('Download cancelado', 'bad');
        for (const f of r.falhas) toast(f, 'bad');
      } catch (e) {
        toast(e.message || 'Não consegui baixar as faixas', 'bad');
      } finally {
        baixa = null;
      }
      await loadStored();
      await depois?.();
    }

    async function liberar() {
      if (!(await confirmBox('Apagar deste aparelho', 'As faixas continuam no Drive do ministério e podem ser baixadas de novo. Apagar as cópias deste aparelho?', 'Apagar', true))) return;
      await tracksync.liberarVersao(v);
      engine.stop();
      for (const t of v.tracks) engine.removeTrack(t.id);
      toast('Espaço liberado neste aparelho');
      drawTab();
    }

    pintar();
    return box;
  }

  // ---------- Aba Faixas e tempo 0 ----------
  function tabTracks() {
    const fileIn = el('input', { type: 'file', accept: 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac', multiple: true, hidden: true, id: 'track-files' });
    fileIn.addEventListener('change', () => addFiles([...fileIn.files]));
    const drop = el('label', { class: 'drop', for: 'track-files' }, icon('upload', 26), el('b', null, 'Adicionar faixas da multipista'), el('span', { class: 'small' }, 'Selecione vários arquivos de uma vez (MP3, WAV, M4A). Eles ficam guardados neste aparelho.'));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); addFiles([...e.dataTransfer.files].filter((f) => /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(f.name))); });

    if (!canEdit && !v.tracks.length) return [emptyState('Sem faixas', 'O administrador ainda não adicionou as multipistas desta versão.', null)];

    const zoomSel = select([['2', '2 s'], ['4', '4 s'], ['8', '8 s'], ['15', '15 s'], ['30', '30 s']], String(ui.zoom), { style: { width: 'auto' }, 'aria-label': 'Janela de visualização', onchange: (e) => { ui.zoom = Number(e.target.value); drawTab(); } });
    const startSel = el('input', { type: 'number', min: 0, step: 0.5, value: ui.viewStart, style: { width: '84px' }, 'aria-label': 'Início da janela (s)' });
    startSel.addEventListener('change', () => { ui.viewStart = Math.max(0, Number(startSel.value) || 0); drawTab(); });

    const lanes = v.tracks.map((t, i) => lane(t, i));
    return [
      canEdit ? el('div', { class: 'stack', style: { gap: '8px' } }, drop, fileIn) : null,
      v.tracks.length ? el('section', { class: 'card stack' },
        el('div', { class: 'card-head' }, el('h2', null, 'Faixas neste aparelho'),
          el('span', { class: 'small muted' }, 'Drive do ministério')),
        caixaDrive()) : null,
      v.tracks.length ? el('section', { class: 'card stack' },
        el('div', { class: 'card-head' },
          el('h2', null, 'Tempo 0 de cada faixa'),
          el('div', { class: 'row' }, el('span', { class: 'small muted' }, 'Ver a partir de'), startSel, el('span', { class: 'small muted' }, 's · janela'), zoomSel)),
        el('p', { class: 'small muted' }, 'A linha vermelha marca o primeiro tempo da música em cada arquivo. Toque na forma de onda para mover. As linhas finas mostram os tempos seguintes no BPM atual: se caírem sobre os ataques, está alinhado.'),
        el('div', null, lanes),
        canEdit ? el('div', { class: 'row' },
          el('button', { class: 'btn', onclick: detectAll }, icon('wave'), 'Detectar o tempo 0 em todas'),
          el('button', { class: 'btn primary', onclick: async () => { ui.tab = 'tocar'; drawTabs(); drawTab(); await engine.play(0, { countIn: true }); } }, icon('play'), 'Ouvir com o click')) : null)
        : null,
      el('div', { class: 'notice info' }, 'Dica: se a multipista tem faixa de Click ou Guia, use a detecção nela e aplique o mesmo tempo 0 a todas (arquivos exportados juntos começam no mesmo ponto).'),
    ];
  }

  function lane(t, i) {
    const et = engine.tracks.get(t.id);
    const canvas = el('canvas', { 'aria-label': `Forma de onda de ${t.name}`, role: 'img' });
    const offsetLabel = el('small', null, `tempo 0: ${(t.offsetSec || 0).toFixed(3).replace('.', ',')} s`);
    const setOffset = (sec, save = true) => {
      sec = Math.max(0, Math.round(sec * 1000) / 1000);
      t.offsetSec = sec;
      offsetLabel.textContent = `tempo 0: ${sec.toFixed(3).replace('.', ',')} s`;
      engine.setTrack(trackMeta(t));
      draw();
      if (save) saveVersion(v.id, (x) => { const y = x.tracks.find((z) => z.id === t.id); if (y) y.offsetSec = sec; });
    };
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth || 600;
      const h = canvas.clientHeight || 64;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const g = canvas.getContext('2d');
      g.scale(dpr, dpr);
      const css = getComputedStyle(document.documentElement);
      const col = (n) => css.getPropertyValue(n).trim() || '#888';
      g.clearRect(0, 0, w, h);
      const from = ui.viewStart; const to = ui.viewStart + ui.zoom;
      const X = (sec) => ((sec - from) / (to - from)) * w;
      // grade de tempos a partir do tempo 0
      g.strokeStyle = col('--muted'); g.globalAlpha = 0.35; g.lineWidth = 1;
      const spb = engine.spb;
      const off = t.offsetSec || 0;
      for (let k = Math.ceil((from - off) / spb); off + k * spb <= to; k++) {
        const x = X(off + k * spb);
        g.beginPath(); g.moveTo(x, k % engine.beats === 0 ? 0 : h * 0.7); g.lineTo(x, h); g.stroke();
      }
      g.globalAlpha = 1;
      if (et?.buffer) {
        const peaks = computePeaks(et.buffer, from, to, Math.floor(w));
        g.fillStyle = col('--fg'); g.globalAlpha = 0.75;
        for (let x = 0; x < peaks.length; x++) { const ph = Math.max(1, peaks[x] * (h - 6)); g.fillRect(x, (h - ph) / 2, 1, ph); }
        g.globalAlpha = 1;
      } else {
        g.fillStyle = col('--muted'); g.font = '12px system-ui'; g.fillText('arquivo não carregado neste aparelho', 8, h / 2 + 4);
      }
      const mx = X(off);
      if (mx >= 0 && mx <= w) { g.strokeStyle = col('--bad'); g.lineWidth = 2; g.beginPath(); g.moveTo(mx, 0); g.lineTo(mx, h); g.stroke(); }
    }
    canvas.addEventListener('pointerdown', (e) => {
      if (!canEdit) return;
      const r = canvas.getBoundingClientRect();
      setOffset(ui.viewStart + ((e.clientX - r.left) / r.width) * ui.zoom);
    });
    requestAnimationFrame(draw);

    const nudge = (d) => el('button', { class: 'btn small', onclick: () => setOffset((t.offsetSec || 0) + d) }, (d > 0 ? '+' : '−') + Math.abs(d * 1000) + ' ms');
    return el('div', { class: 'align-lane' },
      el('div', { class: 'lname' }, t.name, offsetLabel,
        canEdit ? el('div', { class: 'row', style: { marginTop: '4px', gap: '4px' } },
          el('button', { class: 'btn small', title: 'Detectar o primeiro ataque', onclick: () => { if (et?.buffer) { setOffset(detectOnset(et.buffer)); ui.viewStart = Math.max(0, (t.offsetSec || 0) - ui.zoom / 4); drawTab(); } } }, 'Detectar'),
          el('button', { class: 'btn small', title: 'Usar este tempo 0 em todas as faixas', onclick: () => {
            const off = t.offsetSec || 0;
            saveVersion(v.id, (x) => x.tracks.forEach((y) => { y.offsetSec = off; }));
            v.tracks.forEach((y) => { y.offsetSec = off; engine.setTrack(trackMeta(y)); });
            toast('Tempo 0 aplicado a todas as faixas');
            drawTab();
          } }, 'Usar em todas')) : null),
      el('div', { class: 'stack', style: { gap: '4px' } },
        canvas,
        canEdit ? el('div', { class: 'row', style: { gap: '4px' } },
          nudge(-0.01), nudge(0.01),
          el('label', { class: 'row small', style: { marginLeft: '6px' } }, el('input', { type: 'checkbox', checked: !!t.guide, onchange: (e) => { saveVersion(v.id, (x) => { x.tracks.find((y) => y.id === t.id).guide = e.target.checked; }); t.guide = e.target.checked; engine.setTrack(trackMeta(t)); } }), 'É guia/click'),
          (() => { const n = el('input', { type: 'text', value: t.name, style: { width: '140px', minHeight: '30px', padding: '2px 8px' }, 'aria-label': 'Nome da faixa' }); n.addEventListener('change', () => { saveVersion(v.id, (x) => { x.tracks.find((y) => y.id === t.id).name = n.value; }); t.name = n.value; }); return n; })(),
          el('button', { class: 'btn small', 'aria-label': 'Subir faixa', disabled: i === 0, onclick: () => { saveVersion(v.id, (x) => { [x.tracks[i - 1], x.tracks[i]] = [x.tracks[i], x.tracks[i - 1]]; }); drawTab(); } }, icon('up', 16)),
          el('button', { class: 'btn small danger', 'aria-label': 'Remover faixa', onclick: async () => {
            if (!(await confirmBox('Remover faixa', `Remover "${t.name}" desta versão?`, 'Remover', true))) return;
            engine.removeTrack(t.id);
            await deleteTrack(v.id, t.id);
            if (t.driveFileId) { try { await tracksync.apagarDoDrive(t.driveFileId, song.ministryId); } catch { toast('A faixa saiu do app, mas continua no Drive.', 'bad'); } }
            saveVersion(v.id, (x) => { x.tracks = x.tracks.filter((y) => y.id !== t.id); });
            drawTabs(); drawTab();
          } }, icon('trash', 16))) : null));
  }

  async function addFiles(files) {
    if (!files.length) return;
    engine.pause();
    await engine.resume().catch(() => {});
    let n = 0;
    for (const f of files) {
      status.textContent = `Processando ${f.name}…`;
      const id = uid('t');
      try {
        const buf = await engine.decode(await f.arrayBuffer(), prefs.economy);
        const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
        const meta = { id, name, offsetSec: Math.round(detectOnset(buf) * 1000) / 1000, volume: 1, pan: 0, mute: false, solo: false, guide: /click|guia|guide|cue|metr/i.test(name), fileName: f.name, size: f.size };
        const stored = await putTrack(v.id, id, f);
        meta.stored = stored;
        saveVersion(v.id, (x) => { x.tracks.push(meta); if (!x.durationSec) x.durationSec = Math.round(buf.duration); });
        engine.setTrack(trackMeta(meta), buf);
        n++;
        if (!stored) toast('Este navegador não guardou o arquivo; ele vale só enquanto a página estiver aberta.', 'bad');
        // manda a cópia do ministério para o Drive, para os outros aparelhos baixarem
        await enviarAoDrive(f, meta);
      } catch (e) {
        toast(`Não consegui ler ${f.name}. Use MP3, WAV ou M4A.`, 'bad');
      }
    }
    // Faixas da mesma multipista: se houver click/guia, alinha todas por ela
    const ref = v.tracks.find((t) => t.guide);
    if (ref && n > 1) {
      saveVersion(v.id, (x) => x.tracks.forEach((y) => { y.offsetSec = ref.offsetSec; }));
      v.tracks.forEach((y) => { y.offsetSec = ref.offsetSec; engine.setTrack(trackMeta(y)); });
      toast(`${n} faixas adicionadas e alinhadas pela faixa "${ref.name}"`);
    } else if (n) toast(`${n} faixa(s) adicionada(s)`);
    ui.viewStart = Math.max(0, Math.min(...v.tracks.map((t) => t.offsetSec || 0)) - 1);
    status.textContent = `${v.tracks.length} faixas prontas`;
    drawTabs(); drawTab();
  }

  /** Envia o arquivo para o Drive do ministério, se estiver conectado. */
  async function enviarAoDrive(arquivo, meta) {
    let st = { conectado: false };
    try { st = await tracksync.conectado(song.ministryId); } catch { return; }
    if (!st.conectado) return;
    try {
      status.textContent = `Enviando ${meta.name} para o Drive… 0%`;
      const fileId = await tracksync.enviarFaixa(song, v, arquivo, arquivo.name, (f) => {
        status.textContent = `Enviando ${meta.name} para o Drive… ${Math.round(f * 100)}%`;
      });
      meta.driveFileId = fileId;
      saveVersion(v.id, (x) => { const y = x.tracks.find((z) => z.id === meta.id); if (y) y.driveFileId = fileId; });
    } catch (e) {
      toast(`${meta.name} ficou só neste aparelho: ${e.message}`, 'bad');
    }
  }

  function detectAll() {
    for (const t of v.tracks) {
      const et = engine.tracks.get(t.id);
      if (et?.buffer) t.offsetSec = Math.round(detectOnset(et.buffer) * 1000) / 1000;
      engine.setTrack(trackMeta(t));
    }
    saveVersion(v.id, (x) => x.tracks.forEach((y) => { y.offsetSec = v.tracks.find((t) => t.id === y.id)?.offsetSec ?? y.offsetSec; }));
    toast('Tempo 0 detectado em todas as faixas');
    drawTab();
  }

  // ---------- Aba Click e saída ----------
  function tabOutput() {
    const out = el('div', { class: 'stack' });
    if (PlayerEngine.canSelectOutput) {
      const sel = select([['default', 'Padrão do sistema']], ui.outputId, { style: { width: 'auto' }, 'aria-label': 'Saída de áudio' });
      const fill = async (ask) => {
        const list = await engine.listOutputs(ask);
        clear(sel);
        sel.appendChild(el('option', { value: 'default' }, 'Padrão do sistema'));
        list.filter((d) => d.deviceId !== 'default').forEach((d, i) => sel.appendChild(el('option', { value: d.deviceId, selected: d.deviceId === ui.outputId }, d.label || `Saída ${i + 1}`)));
      };
      fill(false);
      sel.addEventListener('change', async () => {
        try { await engine.setOutput(sel.value); ui.outputId = sel.value; toast('Saída de áudio alterada'); } catch (e) { toast(e.message, 'bad'); }
      });
      out.append(el('div', { class: 'row' }, sel, el('button', { class: 'btn small', onclick: () => fill(true) }, 'Mostrar nomes das saídas')),
        el('p', { class: 'small muted' }, 'Para ver os nomes (ex.: placa de som USB), o navegador pede permissão de microfone. Nada é gravado.'));
    } else {
      out.append(el('div', { class: 'notice info' }, 'Este navegador não permite escolher a saída de áudio dentro do app (é o caso do iPhone). O som sai pelo dispositivo escolhido no sistema: fone, cabo, Bluetooth ou interface USB.'));
    }

    return [
      el('section', { class: 'card stack' },
        el('h2', null, 'Click'),
        el('div', { class: 'form-grid' },
          el('div', { class: 'field' }, el('label', null, 'Lado do click'),
            el('div', { class: 'side-toggle' }, [['L', 'Esquerdo'], ['C', 'Centro'], ['R', 'Direito']].map(([k, l]) => el('button', { class: prefs.side === k ? 'on' : '', onclick: () => { prefs.side = k; savePrefs(); applyPrefs(); drawTab(); } }, l)))),
          el('div', { class: 'field' }, el('label', null, 'Contagem antes de começar'),
            select([['0', 'Sem contagem'], ['1', '1 compasso'], ['2', '2 compassos']], String(prefs.countIn), { onchange: (e) => { prefs.countIn = Number(e.target.value); savePrefs(); applyPrefs(); } })),
          el('label', { class: 'row small', for: 'accent' }, el('input', { type: 'checkbox', id: 'accent', checked: prefs.accent, onchange: (e) => { prefs.accent = e.target.checked; savePrefs(); applyPrefs(); } }), 'Acento no tempo 1'),
          el('label', { class: 'row small', for: 'stage2' }, el('input', { type: 'checkbox', id: 'stage2', checked: prefs.stage, onchange: (e) => { prefs.stage = e.target.checked; savePrefs(); applyPrefs(); } }), 'Modo palco (música em mono no lado oposto)'))),
      el('section', { class: 'card stack' }, el('h2', null, 'Saída de áudio'), out),
      el('section', { class: 'card stack' },
        el('h2', null, 'Memória'),
        el('label', { class: 'row small', for: 'economy' }, el('input', { type: 'checkbox', id: 'economy', checked: prefs.economy, onchange: (e) => { prefs.economy = e.target.checked; savePrefs(); toast('Vale para as faixas carregadas a partir de agora'); } }), 'Economizar memória (faixas em mono, 24 kHz)'),
        el('p', { class: 'small muted' }, 'Recomendado no celular: uma multipista de 8 faixas de 5 minutos ocupa cerca de 0,8 GB de memória em qualidade total e uns 200 MB no modo economia.')),
    ];
  }

  // ---------- atualização contínua ----------
  function frame() {
    const p = engine.position();
    const dur = timelineDur();
    const spb = engine.spb;
    if (p < 0) {
      const beatsLeft = Math.ceil(-p / spb);
      clear(clock).append(`−${beatsLeft}`, el('small', null, 'contagem'));
    } else {
      const bar = Math.floor(p / barLen()) + 1;
      const beat = Math.floor((p % barLen()) / spb) + 1;
      clear(clock).append(`${bar}.${beat}`, el('small', null, `${fmtDuration(p)} / ${fmtDuration(dur)}`));
    }
    const beatIdx = ((Math.floor(p / spb) % engine.beats) + engine.beats) % engine.beats;
    if (dots.children.length !== engine.beats) drawDots();
    [...dots.children].forEach((d, i) => { d.className = engine.playing && i === beatIdx ? 'on' + (i === 0 ? ' down' : '') : ''; });
    refreshCueUI();
    raf = requestAnimationFrame(frame);
  }

  const onKey = (e) => {
    if (e.target.closest('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (document.querySelector('.modal-backdrop')) return;
    const list = sortedCues();
    if (e.code === 'Space') { e.preventDefault(); togglePlay(); return; }
    if (/^Digit[0-9]$/.test(e.code) || /^Numpad[0-9]$/.test(e.code)) {
      const n = Number(e.code.slice(-1));
      const c = list[n === 0 ? 9 : n - 1];
      if (c) { e.preventDefault(); cues.launch(c.id); }
      return;
    }
    if (e.key === 'PageDown' || (e.key === 'ArrowRight' && !e.target.closest('.timeline'))) { e.preventDefault(); cues.step(1); return; }
    if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && !e.target.closest('.timeline'))) { e.preventDefault(); cues.step(-1); return; }
    if (e.key === 'Escape') { cues.cancel(); return; }
    if (e.key === 'l' || e.key === 'L') {
      if (cues.loopId) cues.setLoop(null);
      else { const cur = cues.sectionAt(Math.max(0, engine.position())); if (cur) cues.setLoop(cur.id); }
      ui.loopSectionId = cues.loopId;
      if (ui.tab === 'tocar') drawTab();
      return;
    }
    if ((e.key === 'm' || e.key === 'M') && cues.arrangement().length) {
      cues.setMap(!cues.mapOn); prefs.mapOn = cues.mapOn; savePrefs();
      toast(cues.mapOn ? 'Seguindo o mapa' : 'Mapa desligado');
      if (ui.tab === 'tocar') drawTab();
    }
  };
  document.addEventListener('keydown', onKey);

  root.append(header, tabs, tabBody);
  drawTab();
  loadStored();
  raf = requestAnimationFrame(frame);

  return {
    node: root,
    cleanup: () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      engine.onState = null;
      engine.pause();
      cues.dispose();
      wakeLock?.release?.().catch(() => {});
    },
  };
}

void go;
