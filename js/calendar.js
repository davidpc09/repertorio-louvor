// Agenda: junta eventos e cultos (setlists) e gera links/arquivos para a agenda pessoal
// (Google Agenda, agenda do iPhone, Outlook). Não precisa de login no Google.

import * as store from './store.js';

export const TIMEZONE = 'America/Sao_Paulo';
export const EVENT_TYPES = ['Culto', 'Ensaio', 'Reunião', 'Outro'];

const pad = (n) => String(n).padStart(2, '0');

function addMinutes(date, time, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, hh, mm) + minutes * 60000);
  return { date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` };
}

function nextDay(date) { return addMinutes(date, '00:00', 24 * 60).date; }

/** Lista unificada de itens da agenda do ministério atual. */
export function agendaItems({ ministryId = store.getState().session.ministryId, from = null } = {}) {
  const s = store.getState();
  const me = store.currentUser();
  const items = [];
  for (const ev of s.events || []) {
    if (ev.ministryId !== ministryId) continue;
    items.push({ kind: 'event', id: ev.id, title: ev.title || ev.type, type: ev.type || 'Outro', date: ev.date, start: ev.start || '', end: ev.end || '', location: ev.location || '', notes: ev.notes || '', source: ev });
  }
  const admin = store.isAdmin();
  for (const sl of s.setlists) {
    if (sl.ministryId !== ministryId) continue;
    if (sl.status === 'rascunho' && !admin) continue;
    const mine = sl.roster.filter((r) => r.userId === me?.id && r.status !== 'recusado').map((r) => r.func);
    const songs = sl.items.map((it, i) => `${i + 1}. ${store.findSong(it.songId)?.title || ''}${it.key ? ' (' + it.key + ')' : ''}`).join('\n');
    const notes = [sl.theme ? 'Tema: ' + sl.theme : null, songs ? 'Músicas:\n' + songs : null, mine.length ? 'Sua escala: ' + mine.join(', ') : null, sl.notes || null].filter(Boolean).join('\n\n');
    items.push({ kind: 'setlist', id: sl.id, title: sl.title || sl.serviceType || 'Culto', type: 'Culto', date: sl.date, start: sl.time || '', end: sl.time ? addMinutes(sl.date, sl.time, 120).time : '', location: '', notes, mine, status: sl.status, source: sl });
  }
  return items
    .filter((it) => it.date && (!from || it.date >= from))
    .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

function endOf(it) {
  if (!it.start) return null;
  if (it.end && it.end > it.start) return { date: it.date, time: it.end };
  return addMinutes(it.date, it.start, it.end ? 24 * 60 - 1 : 120); // fim antes do início = passa da meia-noite
}

const compact = (date, time) => date.replace(/-/g, '') + (time ? 'T' + time.replace(':', '') + '00' : '');

/** Link "Adicionar ao Google Agenda" (abre o Google Agenda com o evento preenchido). */
export function googleCalendarUrl(it) {
  let dates;
  if (it.start) {
    const e = endOf(it);
    dates = `${compact(it.date, it.start)}/${compact(e.date, e.time)}`;
  } else {
    dates = `${compact(it.date)}/${compact(nextDay(it.date))}`;
  }
  const min = store.currentMinistry()?.name || '';
  const p = new URLSearchParams({ action: 'TEMPLATE', text: it.title + (min ? ` · ${min}` : ''), dates, ctz: TIMEZONE, details: it.notes || '', location: it.location || '' });
  return 'https://calendar.google.com/calendar/render?' + p.toString();
}

function icsEscape(t) {
  return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

// linhas do iCalendar têm no máximo 75 caracteres
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = ' ' + ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
}

/** Arquivo .ics com um ou vários itens (Google Agenda, iPhone, Outlook aceitam). */
export function buildIcs(items) {
  const min = store.currentMinistry()?.name || '';
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Repertorio Louvor//PT-BR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(min || 'Repertório Louvor')}`, `X-WR-TIMEZONE:${TIMEZONE}`,
    'BEGIN:VTIMEZONE', `TZID:${TIMEZONE}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0300', 'TZNAME:-03', 'END:STANDARD', 'END:VTIMEZONE',
  ];
  for (const it of items) {
    lines.push('BEGIN:VEVENT', `UID:${it.kind}-${it.id}@repertorio-louvor`, `DTSTAMP:${stamp}`);
    if (it.start) {
      const e = endOf(it);
      lines.push(`DTSTART;TZID=${TIMEZONE}:${compact(it.date, it.start)}`, `DTEND;TZID=${TIMEZONE}:${compact(e.date, e.time)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(it.date)}`, `DTEND;VALUE=DATE:${compact(nextDay(it.date))}`);
    }
    lines.push(`SUMMARY:${icsEscape(it.title + (min ? ' · ' + min : ''))}`);
    if (it.location) lines.push(`LOCATION:${icsEscape(it.location)}`);
    if (it.notes) lines.push(`DESCRIPTION:${icsEscape(it.notes)}`);
    lines.push('BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(it.title)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
