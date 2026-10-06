// Leitura de planilhas sem bibliotecas externas: CSV, XLSX (Excel) e ODS (LibreOffice/Google).
// XLSX e ODS são arquivos ZIP com XML dentro; o navegador descompacta com DecompressionStream.
// O formato antigo .xls (binário) não é suportado: o usuário salva como .xlsx ou .csv.

import { normalize } from './dom.js';

export async function readSpreadsheet(file) {
  const name = file.name.toLowerCase();
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (name.endsWith('.xls') && !isZip) {
    throw new Error('Arquivos .xls (Excel 97–2003) não são lidos diretamente. Abra no Excel ou Google Planilhas e salve como .xlsx ou .csv.');
  }
  if (isZip) {
    const zip = await unzip(buf);
    if (zip['xl/workbook.xml']) return parseXlsx(zip);
    if (zip['content.xml']) return parseOds(zip);
    throw new Error('Arquivo compactado não reconhecido como planilha.');
  }
  return { sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCsv(decodeText(buf)) }] };
}

// ---------- CSV ----------
function decodeText(buf) {
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes(String.fromCharCode(0xfffd))) text = new TextDecoder('windows-1252').decode(buf); // planilhas salvas no Excel em português
  return text.replace(/^\uFEFF/, '');
}

export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const counts = { ';': 0, ',': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) { if (ch === '"') inQ = !inQ; else if (!inQ && ch in counts) counts[ch]++; }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
  const rows = [];
  let row = [];
  let cell = '';
  inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c));
}

// ---------- ZIP ----------
async function unzip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo ZIP inválido.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOff = dv.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const lNameLen = dv.getUint16(localOff + 26, true);
    const lExtraLen = dv.getUint16(localOff + 28, true);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    let bytes;
    if (method === 0) bytes = data;
    else if (method === 8) bytes = await inflate(data);
    else continue;
    out[name] = dec.decode(bytes);
  }
  return out;
}

async function inflate(data) {
  if (typeof DecompressionStream === 'undefined') throw new Error('Este navegador é antigo demais para ler .xlsx. Atualize o navegador ou use .csv.');
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([data]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
const byLocal = (node, name) => [...node.getElementsByTagName('*')].filter((n) => n.localName === name);
const childrenByLocal = (node, name) => [...node.children].filter((n) => n.localName === name);

// ---------- XLSX ----------
function colIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseXlsx(zip) {
  const shared = [];
  if (zip['xl/sharedStrings.xml']) {
    for (const si of byLocal(xml(zip['xl/sharedStrings.xml']), 'si')) {
      shared.push(byLocal(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
    }
  }
  const wb = xml(zip['xl/workbook.xml']);
  const rels = {};
  if (zip['xl/_rels/workbook.xml.rels']) {
    for (const r of byLocal(xml(zip['xl/_rels/workbook.xml.rels']), 'Relationship')) rels[r.getAttribute('Id')] = r.getAttribute('Target');
  }
  // estilos de data, para converter números seriais em datas
  const dateStyles = new Set();
  if (zip['xl/styles.xml']) {
    const st = xml(zip['xl/styles.xml']);
    const customDate = new Set(byLocal(st, 'numFmt').filter((f) => /[dmy]/i.test(f.getAttribute('formatCode') || '') && !/\[h\]|h:mm(?!.*[dy])/i.test(f.getAttribute('formatCode') || '')).map((f) => f.getAttribute('numFmtId')));
    const cellXfs = byLocal(st, 'cellXfs')[0];
    if (cellXfs) childrenByLocal(cellXfs, 'xf').forEach((xf, i) => {
      const id = Number(xf.getAttribute('numFmtId'));
      if ((id >= 14 && id <= 22) || customDate.has(String(id))) dateStyles.add(String(i));
    });
  }
  const sheets = [];
  for (const sh of byLocal(wb, 'sheet')) {
    const rid = sh.getAttribute('r:id') || [...sh.attributes].find((a) => a.localName === 'id')?.value;
    let target = rels[rid] || '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const path = 'xl/' + target;
    if (!zip[path]) continue;
    const doc = xml(zip[path]);
    const rows = [];
    for (const row of byLocal(doc, 'row')) {
      const r = [];
      for (const c of childrenByLocal(row, 'c')) {
        const ref = c.getAttribute('r');
        const idx = ref ? colIndex(ref) : r.length;
        const t = c.getAttribute('t');
        const vNode = childrenByLocal(c, 'v')[0];
        let val = vNode ? vNode.textContent : '';
        if (t === 's') val = shared[Number(val)] ?? '';
        else if (t === 'inlineStr') val = byLocal(c, 't').map((x) => x.textContent).join('');
        else if (t === 'b') val = val === '1' ? 'VERDADEIRO' : 'FALSO';
        else if (!t || t === 'n') {
          if (val !== '' && dateStyles.has(c.getAttribute('s') || '')) val = serialToDate(Number(val));
        }
        r[idx] = String(val).trim();
      }
      for (let i = 0; i < r.length; i++) if (r[i] === undefined) r[i] = '';
      rows.push(r);
    }
    sheets.push({ name: sh.getAttribute('name'), rows: rows.filter((x) => x.some((c) => c)) });
  }
  return { sheets };
}

function serialToDate(n) {
  if (!isFinite(n)) return '';
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------- ODS ----------
function parseOds(zip) {
  const doc = xml(zip['content.xml']);
  const sheets = [];
  for (const table of byLocal(doc, 'table')) {
    if (table.parentNode.localName === 'table') continue;
    const rows = [];
    for (const row of byLocal(table, 'table-row')) {
      const rep = Math.min(Number(row.getAttribute('table:number-rows-repeated') || 1), 1000);
      const r = [];
      for (const cell of [...row.children].filter((n) => n.localName === 'table-cell' || n.localName === 'covered-table-cell')) {
        const crep = Math.min(Number(cell.getAttribute('table:number-columns-repeated') || 1), 200);
        const type = cell.getAttribute('office:value-type');
        let val = type === 'date' ? (cell.getAttribute('office:date-value') || '').slice(0, 10)
          : byLocal(cell, 'p').map((p) => p.textContent).join('\n');
        if (!val && (type === 'float' || type === 'percentage')) val = cell.getAttribute('office:value') || '';
        for (let k = 0; k < crep; k++) r.push(String(val).trim());
      }
      while (r.length && !r[r.length - 1]) r.pop();
      if (r.some((c) => c)) for (let k = 0; k < rep; k++) rows.push(r);
    }
    sheets.push({ name: table.getAttribute('table:name'), rows });
  }
  return { sheets };
}

// ---------- Mapeamento de colunas ----------
export const SONG_FIELDS = [
  { key: 'title', label: 'Título', required: true, syn: ['titulo', 'título', 'musica', 'música', 'nome', 'nome da musica', 'song', 'title', 'cancao', 'canção'] },
  { key: 'artist', label: 'Artista', required: true, syn: ['artista', 'cantor', 'cantora', 'banda', 'interprete', 'intérprete', 'ministerio', 'artist', 'gravacao', 'versao original'] },
  { key: 'version', label: 'Versão', syn: ['versao', 'versão', 'arranjo', 'version'] },
  { key: 'key', label: 'Tom', syn: ['tom', 'tonalidade', 'key', 'tom do ministerio', 'tom ministerio'] },
  { key: 'bpm', label: 'BPM', syn: ['bpm', 'andamento', 'tempo', 'velocidade'] },
  { key: 'timeSig', label: 'Compasso', syn: ['compasso', 'formula de compasso', 'time signature'] },
  { key: 'themes', label: 'Temas', syn: ['temas', 'tema', 'palavras-chave', 'palavras chave', 'tags', 'categoria', 'categorias', 'assunto'] },
  { key: 'services', label: 'Cultos', syn: ['cultos', 'culto', 'cultos propicios', 'ocasiao', 'ocasião', 'momento', 'tipo de culto'] },
  { key: 'youtube', label: 'Link YouTube', syn: ['link', 'youtube', 'link youtube', 'referencia', 'referência', 'spotify', 'url'] },
  { key: 'composer', label: 'Compositor', syn: ['compositor', 'compositores', 'autor', 'autores'] },
  { key: 'notes', label: 'Observações', syn: ['observacoes', 'observações', 'obs', 'notas', 'comentarios', 'comentários'] },
];

export const HISTORY_FIELDS = [
  { key: 'date', label: 'Data', required: true, syn: ['data', 'dia', 'date', 'culto em'] },
  { key: 'title', label: 'Título', required: true, syn: SONG_FIELDS[0].syn },
  { key: 'artist', label: 'Artista', syn: SONG_FIELDS[1].syn },
  { key: 'key', label: 'Tom', syn: SONG_FIELDS[3].syn },
];

export function autoMap(header, fields) {
  const map = {};
  const used = new Set();
  const h = header.map((x) => normalize(x));
  for (const f of fields) {
    const syn = f.syn.map(normalize);
    let idx = h.findIndex((c, i) => !used.has(i) && syn.includes(c));
    if (idx < 0) idx = h.findIndex((c, i) => !used.has(i) && c && syn.some((s) => c.startsWith(s)));
    if (idx >= 0) { map[f.key] = idx; used.add(idx); }
  }
  return map;
}

/** Converte "06/10/2026", "6-10-26", "2026-10-06" ou serial do Excel em AAAA-MM-DD. */
export function parseDate(v) {
  const s = String(v || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]); if (y < 100) y += 2000;
    const d = Number(m[1]); const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) return serialToDate(Number(s));
  return null;
}

// ---------- Modelo .xlsx (gerado aqui mesmo, ZIP sem compressão) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(bytes) { let c = 0xffffffff; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function zipStore(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameB = enc.encode(name);
    const data = enc.encode(content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameB.length, true);
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nameB.length, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const cenSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cenSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function sheetXml(rows) {
  const colL = (i) => String.fromCharCode(65 + i);
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colL(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function buildTemplateXlsx() {
  const songs = [
    SONG_FIELDS.map((f) => f.label),
    ['Bondade de Deus', 'Isaías Saad', 'Original', 'G', '68', '4/4', 'Gratidão; Fidelidade', 'Domingo manhã; Domingo noite', 'https://youtube.com/…', '', 'Exemplo: apague esta linha'],
  ];
  const hist = [['Data', 'Título', 'Artista', 'Tom'], ['04/10/2026', 'Bondade de Deus', 'Isaías Saad', 'G']];
  return makeXlsx([['Músicas', songs], ['Histórico', hist]]);
}

export function makeXlsx(sheets) {
  const files = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`,
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf fontId="0"/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
  };
  sheets.forEach(([, rows], i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = sheetXml(rows); });
  return zipStore(files);
}
