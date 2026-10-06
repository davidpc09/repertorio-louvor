// Estado do aplicativo. Neste modo ("demonstração local") os dados ficam no próprio aparelho
// (localStorage). O arquivo supabase/schema.sql tem o mesmo modelo para a versão em nuvem.

import { uid, today, toISODate } from './dom.js';

const KEY = 'repertorio-louvor.v1';
const listeners = new Set();
let state = null;
let saveTimer = null;
export let storageOk = true;

export function getState() { return state; }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Altera o estado: commit(s => { s.songs.push(...) }) */
export function commit(mutator, { silent = false } = {}) {
  mutator(state);
  scheduleSave();
  if (!silent) listeners.forEach((fn) => fn(state));
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 150);
}

export function saveNow() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    storageOk = true;
  } catch (e) {
    storageOk = false;
  }
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { storageOk = false; }
  if (raw) {
    try { state = migrate(JSON.parse(raw)); return state; } catch { /* dados corrompidos: recria */ }
  }
  state = migrate(seed());
  saveNow();
  return state;
}

export function resetDemo() {
  state = migrate(seed());
  saveNow();
  listeners.forEach((fn) => fn(state));
}

export function replaceState(next) {
  state = migrate(next);
  saveNow();
  listeners.forEach((fn) => fn(state));
}

function migrate(s) {
  s.version = 1;
  s.ministries ||= [];
  s.users ||= [];
  s.songs ||= [];
  s.setlists ||= [];
  s.executions ||= [];
  s.suggestions ||= [];
  s.session ||= { userId: null, ministryId: null };
  s.settings ||= defaultSettings();
  for (const song of s.songs) {
    song.versions ||= [];
    for (const v of song.versions) {
      v.sections ||= [];
      v.arrangement ||= [];
      v.tracks ||= [];
      if (v.id === 'v-exemplo' && !v.cuesDemo) seedExampleCues(v);
      v.singerKeys ||= [];
      v.timeSig ||= '4/4';
    }
  }
  for (const sl of s.setlists) { sl.items ||= []; sl.roster ||= []; }
  return s;
}

function defaultSettings() {
  return {
    serviceTypes: ['Domingo manhã', 'Domingo noite', 'Santa Ceia', 'Culto de oração', 'Culto jovem', 'Batismo', 'Missões', 'Ensaio'],
    functions: ['Ministro', 'Backing vocal', 'Teclado', 'Violão', 'Guitarra', 'Baixo', 'Bateria', 'Som'],
    themes: ['Adoração', 'Celebração', 'Gratidão', 'Cruz', 'Espírito Santo', 'Fidelidade', 'Entrega', 'Missões', 'Santa Ceia', 'Esperança', 'Confissão', 'Oração'],
  };
}

// ---------- Sessão e permissões ----------
export function currentUser() {
  return state.users.find((u) => u.id === state.session.userId) || null;
}
export function currentMinistry() {
  return state.ministries.find((m) => m.id === state.session.ministryId) || null;
}
export function membership(user = currentUser(), ministryId = state.session.ministryId) {
  return user?.memberships?.find((m) => m.ministryId === ministryId) || null;
}
export function isAdmin() { return membership()?.role === 'admin'; }
export function canEditSongs() {
  const m = membership();
  return !!m && (m.role === 'admin' || m.canEdit);
}

export function login(userId) {
  const u = state.users.find((x) => x.id === userId);
  if (!u) return;
  commit((s) => {
    s.session.userId = u.id;
    const keep = u.memberships.find((m) => m.ministryId === s.session.ministryId);
    s.session.ministryId = keep ? keep.ministryId : u.memberships[0]?.ministryId || null;
  });
}
export function logout() { commit((s) => { s.session.userId = null; }); }
export function switchMinistry(id) { commit((s) => { s.session.ministryId = id; }); }

// ---------- Consultas ----------
export function songsOfMinistry(mid = state.session.ministryId) {
  return state.songs.filter((s) => s.ministryId === mid);
}
export function findSong(id) { return state.songs.find((s) => s.id === id); }
export function findVersion(songId, versionId) {
  const s = findSong(songId);
  return s?.versions.find((v) => v.id === versionId) || s?.versions[0] || null;
}
export function findVersionAnywhere(versionId) {
  for (const s of state.songs) {
    const v = s.versions.find((x) => x.id === versionId);
    if (v) return { song: s, version: v };
  }
  return null;
}
export function membersOfMinistry(mid = state.session.ministryId) {
  return state.users.filter((u) => u.active !== false && u.memberships.some((m) => m.ministryId === mid));
}
export function userName(id) { return state.users.find((u) => u.id === id)?.name || '—'; }

/** Última data em que a música foi tocada (execuções registradas). */
export function lastPlayed(songId) {
  let last = null;
  for (const e of state.executions) if (e.songId === songId && (!last || e.date > last)) last = e.date;
  return last;
}
export function playCount(songId, from, to) {
  return state.executions.filter((e) => e.songId === songId && (!from || e.date >= from) && (!to || e.date <= to)).length;
}

export function newVersion(partial = {}) {
  return {
    id: uid('v'), name: 'Original', keyOriginal: '', keyMinistry: '', bpm: null, timeSig: '4/4', durationSec: null,
    lyrics: '', chords: '', youtube: '', linkVS: '', linkInstrumental: '', linkVozes: '', singerKeys: [], sections: [], tracks: [],
    ...partial,
  };
}

export function newSong(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: uid('s'), ministryId: state.session.ministryId, title: '', composer: '', artist: '', themes: [], services: [], notes: '',
    createdAt: now, updatedAt: now, versions: [newVersion()], ...partial,
  };
}

/** Marca o setlist como realizado e registra as execuções (base dos relatórios). */
export function markSetlistDone(setlistId, done = true) {
  commit((s) => {
    const sl = s.setlists.find((x) => x.id === setlistId);
    if (!sl) return;
    s.executions = s.executions.filter((e) => e.setlistId !== setlistId);
    sl.status = done ? 'realizado' : 'publicado';
    if (done) {
      for (const it of sl.items) {
        s.executions.push({ id: uid('e'), ministryId: sl.ministryId, songId: it.songId, versionId: it.versionId, setlistId: sl.id, date: sl.date });
      }
    }
  });
}

// ---------- Dados de demonstração ----------
const DEMO_COLORS = ['#2c7fb8', '#16a085', '#c0392b', '#5b4bc4', '#6b7280'];
/** Cues e mapa de exemplo: Intro → Verso → Refrão → Ponte → Refrão ×2 → Final. */
function seedExampleCues(v) {
  v.sections.forEach((c, i) => { c.color ||= DEMO_COLORS[i % DEMO_COLORS.length]; c.follow ||= 'next'; });
  const id = (name) => v.sections.find((c) => c.name === name)?.id;
  if (id('Intro') && id('Refrão') && !v.arrangement.length) {
    v.arrangement = [
      { id: uid('m'), sectionId: id('Intro'), repeats: 1 },
      { id: uid('m'), sectionId: id('Verso 1'), repeats: 1 },
      { id: uid('m'), sectionId: id('Refrão'), repeats: 1 },
      { id: uid('m'), sectionId: id('Ponte'), repeats: 1 },
      { id: uid('m'), sectionId: id('Refrão'), repeats: 2 },
      { id: uid('m'), sectionId: id('Final'), repeats: 1 },
    ].filter((st) => st.sectionId);
  }
  v.cuesDemo = true;
}

function rng(seed) {
  let x = seed;
  return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
}

const EXEMPLO_CIFRA = `[Intro]
G  D/F#  Em  C

[Verso 1]
G               D/F#
Cedo eu venho te buscar
Em              C
Antes da cidade despertar
G               D/F#
Tua luz desenha o meu caminho
Am7          C          D
Nunca mais caminho só

[Refrão]
C        D        G      Em
Fiel és Tu, Senhor, em cada amanhecer
C        D        Em     D/F#
Fiel és Tu, Senhor, não vou temer
C        D        G   D/F#  Em
Minha esperança está em Ti
C        D        G
Fiel és Tu

[Ponte]
Em    C     G     D
Tudo passa, Tu permaneces
Em    C     G     D
Tudo muda, Tu és o mesmo

[Final]
C  D  G`;

function seed() {
  const s = {
    version: 1,
    settings: defaultSettings(),
    ministries: [
      { id: 'min-domingo', name: 'Louvor de Domingo' },
      { id: 'min-jovens', name: 'Ministério Jovem' },
    ],
    users: [],
    songs: [],
    setlists: [],
    executions: [],
    suggestions: [],
    session: { userId: null, ministryId: 'min-domingo' },
  };
  const U = (id, name, email, functions, memberships, extra = {}) => s.users.push({ id, name, email, functions, memberships, unavailable: [], active: true, ...extra });
  U('u-lider', 'David (líder)', 'lider@exemplo.com', ['Ministro', 'Violão'], [
    { ministryId: 'min-domingo', role: 'admin' }, { ministryId: 'min-jovens', role: 'admin' }]);
  U('u-ana', 'Ana', 'ana@exemplo.com', ['Ministro', 'Backing vocal'], [
    { ministryId: 'min-domingo', role: 'membro' }, { ministryId: 'min-jovens', role: 'membro' }], { preferredKey: 'A' });
  U('u-pedro', 'Pedro', 'pedro@exemplo.com', ['Violão', 'Guitarra'], [{ ministryId: 'min-domingo', role: 'membro', canEdit: true }]);
  U('u-julia', 'Júlia', 'julia@exemplo.com', ['Teclado', 'Backing vocal'], [{ ministryId: 'min-domingo', role: 'membro' }]);
  U('u-lucas', 'Lucas', 'lucas@exemplo.com', ['Bateria'], [{ ministryId: 'min-domingo', role: 'membro' }, { ministryId: 'min-jovens', role: 'membro' }]);
  U('u-marcos', 'Marcos', 'marcos@exemplo.com', ['Baixo'], [{ ministryId: 'min-domingo', role: 'membro' }]);
  U('u-bia', 'Bia', 'bia@exemplo.com', ['Ministro'], [{ ministryId: 'min-jovens', role: 'membro' }]);

  // Músicas de exemplo (somente metadados; tons e BPM ilustrativos, confira antes de usar)
  const songs = [
    ['Bondade de Deus', 'Isaías Saad', 'G', 68, ['Gratidão', 'Fidelidade'], ['Domingo manhã', 'Domingo noite']],
    ['Lugar Secreto', 'Gabriela Rocha', 'D', 70, ['Adoração', 'Oração'], ['Culto de oração', 'Domingo noite']],
    ['Ousado Amor', 'Isaías Saad', 'C', 72, ['Adoração', 'Cruz'], ['Domingo noite', 'Santa Ceia']],
    ['Me Atraiu', 'Gabriela Rocha', 'A', 66, ['Adoração', 'Entrega'], ['Domingo noite']],
    ['Aquieta Minh\'alma', 'Ministério Zoe', 'E', 64, ['Esperança', 'Oração'], ['Culto de oração']],
    ['A Casa É Sua', 'Casa Worship', 'C', 74, ['Espírito Santo', 'Adoração'], ['Domingo manhã', 'Domingo noite']],
    ['Grande é o Senhor', 'Adhemar de Campos', 'D', 120, ['Celebração'], ['Domingo manhã']],
    ['Deus de Promessas', 'Davi Sacer', 'A', 76, ['Fidelidade', 'Esperança'], ['Domingo manhã']],
    ['Santo Espírito', 'Laura Souguellis', 'Bb', 68, ['Espírito Santo'], ['Culto de oração', 'Domingo noite']],
    ['Raridade', 'Anderson Freire', 'G', 72, ['Esperança'], ['Domingo manhã']],
    ['Em Teus Braços', 'Laura Souguellis', 'E', 70, ['Entrega', 'Adoração'], ['Domingo noite']],
    ['Porque Ele Vive', 'Hino', 'G', 84, ['Esperança', 'Cruz'], ['Santa Ceia', 'Batismo']],
    ['Te Louvarei', 'Toque no Altar', 'A', 128, ['Celebração', 'Gratidão'], ['Domingo manhã', 'Culto jovem']],
    ['Ele Continua Sendo Bom', 'Paulo César Baruk', 'E', 118, ['Celebração', 'Fidelidade'], ['Culto jovem', 'Domingo manhã']],
    ['Tua Graça Me Basta', 'Toque no Altar', 'D', 70, ['Entrega', 'Cruz'], ['Santa Ceia']],
    ['Vim Para Adorar-te', 'Adoração e Adoradores', 'D', 72, ['Adoração'], ['Domingo noite', 'Culto jovem']],
  ];
  const now = new Date().toISOString();
  songs.forEach(([title, artist, key, bpm, themes, services], i) => {
    s.songs.push({
      id: 's' + (i + 1), ministryId: 'min-domingo', title, composer: '', artist, themes, services, notes: '',
      createdAt: now, updatedAt: now,
      versions: [newVersion({ id: 'v' + (i + 1), name: 'Original', keyOriginal: key, keyMinistry: key, bpm, durationSec: 240 + (i % 5) * 30 })],
    });
  });
  // Uma música com cifra completa (letra original de exemplo) e partes marcadas, para testar cifra e player
  s.songs.push({
    id: 's-exemplo', ministryId: 'min-domingo', title: 'Fiel És Tu (exemplo)', composer: 'Letra de demonstração', artist: 'Exemplo',
    themes: ['Fidelidade', 'Adoração'], services: ['Domingo manhã', 'Culto de oração'], notes: 'Música criada só para testar cifra, transposição e player.',
    createdAt: now, updatedAt: now,
    versions: [newVersion({
      id: 'v-exemplo', name: 'Versão do ministério', keyOriginal: 'G', keyMinistry: 'G', bpm: 72, timeSig: '4/4', durationSec: 260,
      chords: EXEMPLO_CIFRA, lyrics: EXEMPLO_CIFRA.split('\n').filter((l) => !/^\s*([A-G][#b]?\S*\s*)+$/.test(l)).join('\n'),
      singerKeys: [{ userId: 'u-ana', key: 'A' }, { userId: 'u-lider', key: 'G' }],
      sections: [
        { id: uid('p'), name: 'Intro', startBar: 1, endBar: 4 },
        { id: uid('p'), name: 'Verso 1', startBar: 5, endBar: 12 },
        { id: uid('p'), name: 'Refrão', startBar: 13, endBar: 20 },
        { id: uid('p'), name: 'Ponte', startBar: 21, endBar: 28 },
        { id: uid('p'), name: 'Final', startBar: 29, endBar: 32 },
      ],
    })],
  });
  // Ministério jovem com repertório próprio
  [['Ele Continua Sendo Bom', 'Paulo César Baruk', 'E', 118], ['Te Louvarei', 'Toque no Altar', 'A', 128], ['Lugar Secreto', 'Gabriela Rocha', 'D', 70]]
    .forEach(([title, artist, key, bpm], i) => s.songs.push({
      id: 'sj' + i, ministryId: 'min-jovens', title, composer: '', artist, themes: ['Celebração'], services: ['Culto jovem'], notes: '',
      createdAt: now, updatedAt: now, versions: [newVersion({ id: 'vj' + i, keyOriginal: key, keyMinistry: key, bpm })],
    }));

  // Histórico: domingos das últimas 16 semanas, com setlists realizados
  const r = rng(42);
  const domingoSongs = s.songs.filter((x) => x.ministryId === 'min-domingo' && x.id !== 's-exemplo');
  const weights = domingoSongs.map((_, i) => (i < 4 ? 4 : i < 9 ? 2 : i < 13 ? 1 : 0)); // últimas nunca tocadas
  const pick = () => {
    const total = weights.reduce((a, b) => a + b, 0);
    let x = r() * total;
    for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x <= 0) return domingoSongs[i]; }
    return domingoSongs[0];
  };
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 7) % 7)); // último domingo
  for (let w = 16; w >= 1; w--) {
    const dt = new Date(d);
    dt.setDate(d.getDate() - 7 * (w - 1) - 7);
    const date = toISODate(dt);
    const chosen = new Set();
    while (chosen.size < 4) chosen.add(pick());
    const sl = {
      id: 'sl-h' + w, ministryId: 'min-domingo', date, time: '18:00', serviceType: w % 4 === 0 ? 'Santa Ceia' : 'Domingo noite', title: '',
      status: 'realizado', notes: '', ministerId: 'u-lider',
      items: [...chosen].map((song) => ({ id: uid('i'), songId: song.id, versionId: song.versions[0].id, key: song.versions[0].keyMinistry, singerId: 'u-lider', note: '' })),
      roster: [
        { id: uid('r'), userId: 'u-lider', func: 'Ministro', status: 'confirmado' },
        { id: uid('r'), userId: 'u-julia', func: 'Teclado', status: 'confirmado' },
        { id: uid('r'), userId: 'u-lucas', func: 'Bateria', status: 'confirmado' },
      ],
    };
    s.setlists.push(sl);
    sl.items.forEach((it) => s.executions.push({ id: uid('e'), ministryId: sl.ministryId, songId: it.songId, versionId: it.versionId, setlistId: sl.id, date }));
  }
  // Próximo domingo: rascunho publicado com escala pendente
  const next = new Date(d);
  next.setDate(d.getDate() + 7);
  s.setlists.push({
    id: 'sl-prox', ministryId: 'min-domingo', date: toISODate(next), time: '18:00', serviceType: 'Domingo noite', title: 'Culto de domingo',
    status: 'publicado', notes: 'Ensaio no sábado às 16h.', ministerId: 'u-lider',
    items: [
      { id: uid('i'), songId: 's7', versionId: 'v7', key: 'D', singerId: 'u-lider', note: 'Abertura' },
      { id: uid('i'), songId: 's-exemplo', versionId: 'v-exemplo', key: 'A', singerId: 'u-ana', note: '' },
      { id: uid('i'), songId: 's3', versionId: 'v3', key: 'C', singerId: 'u-lider', note: '' },
      { id: uid('i'), songId: 's11', versionId: 'v11', key: 'E', singerId: 'u-ana', note: 'Ministração final' },
    ],
    roster: [
      { id: uid('r'), userId: 'u-lider', func: 'Ministro', status: 'confirmado' },
      { id: uid('r'), userId: 'u-ana', func: 'Ministro', status: 'pendente' },
      { id: uid('r'), userId: 'u-julia', func: 'Teclado', status: 'confirmado' },
      { id: uid('r'), userId: 'u-pedro', func: 'Violão', status: 'pendente' },
      { id: uid('r'), userId: 'u-lucas', func: 'Bateria', status: 'recusado' },
    ],
  });
  s.users.find((u) => u.id === 'u-lucas').unavailable.push(toISODate(next));
  s.suggestions.push({ id: uid('sg'), songId: 's2', userId: 'u-ana', text: 'Podemos baixar para C? Fica melhor para minha voz.', status: 'pendente', createdAt: now });
  void today;
  return s;
}
