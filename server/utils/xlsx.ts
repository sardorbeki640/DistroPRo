import { deflateRawSync } from 'node:zlib';

/**
 * Minimal .xlsx writer (no dependencies): styled report sheets with a title block, a frozen header with filters,
 * formatted money, zebra rows, a SUM totals row and a summary block. Opens in Excel, LibreOffice and Google Sheets.
 */

export type XlsxType = 'text' | 'money' | 'number' | 'percent' | 'date';

export interface XlsxColumn {
  header: string;
  key: string;
  type?: XlsxType;
  width?: number;
  total?: boolean;           // SUM in the totals row (money/number columns)
}

export interface XlsxSheet {
  name: string;              // tab name
  title: string;             // big heading in row 1
  subtitle?: string[];       // lines under the heading (company, period, filters)
  columns: XlsxColumn[];
  rows: Record<string, unknown>[];
  totalsLabel?: string;      // adds a totals row when any column has total: true
  summary?: { label: string; value: unknown; type?: XlsxType }[];
}

// Style ids (cellXfs order in STYLES below).
const S = {
  title: 1, subtitle: 2, header: 3,
  text: 4, money: 5, number: 6, percent: 7, date: 8,
  textZ: 9, moneyZ: 10, numberZ: 11, percentZ: 12, dateZ: 13,
  totalLabel: 14, totalMoney: 15, totalNumber: 16,
  sumLabel: 17, sumMoney: 18, sumText: 19, sumNumber: 20, sumPercent: 21
} as const;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0;[Red]\\-#,##0"/><numFmt numFmtId="165" formatCode="#,##0.###;[Red]\\-#,##0.###"/><numFmt numFmtId="166" formatCode="0.0%;[Red]\\-0.0%"/></numFmts>
<fonts count="6">
<font><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><i/><sz val="9"/><color rgb="FF5F6B66"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="10"/><color rgb="FF1F4E3D"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F4E3D"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF2E7D5B"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF2F7F4"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDCEFE4"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD0D7D3"/></left><right style="thin"><color rgb="FFD0D7D3"/></right><top style="thin"><color rgb="FFD0D7D3"/></top><bottom style="thin"><color rgb="FFD0D7D3"/></bottom><diagonal/></border>
<border><left style="thin"><color rgb="FF9DB8AA"/></left><right style="thin"><color rgb="FF9DB8AA"/></right><top style="medium"><color rgb="FF1F4E3D"/></top><bottom style="medium"><color rgb="FF1F4E3D"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="22">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="165" fontId="4" fillId="5" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="165" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="166" fontId="4" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const esc = (value: unknown) => String(value ?? '')
  // Characters XML 1.0 does not allow.
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

const numeric = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "2026-09-30" → "30.09.2026" (the way dates are read in Uzbekistan); other text is kept. */
const displayDate = (v: unknown) => {
  const s = String(v ?? '');
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : s;
};

// A whole number in a "number" column is shown like money (no decimal separator left dangling, e.g. "1,").
const INTEGER_STYLE: Record<number, number> = { [S.number]: S.money, [S.numberZ]: S.moneyZ, [S.totalNumber]: S.totalMoney, [S.sumNumber]: S.sumMoney };

function cell(ref: string, value: unknown, type: XlsxType, style: number): string {
  if (type === 'money' || type === 'number' || type === 'percent') {
    const n = numeric(value);
    if (n === null) return `<c r="${ref}" s="${style}"/>`;
    const s = type === 'number' && Number.isInteger(n) ? INTEGER_STYLE[style] ?? style : style;
    return `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
  }
  const text = type === 'date' ? displayDate(value) : String(value ?? '');
  return text === '' ? `<c r="${ref}" s="${style}"/>` : `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

const dataStyle = (type: XlsxType, zebra: boolean) => {
  const base = { text: S.text, money: S.money, number: S.number, percent: S.percent, date: S.date }[type];
  return zebra ? base + 5 : base;
};

function sheetXml(sheet: XlsxSheet): { xml: string; filterRef: string | null } {
  const cols = sheet.columns;
  const last = columnLetter(Math.max(0, cols.length - 1));
  const rows: string[] = [];
  const merges: string[] = [];
  let r = 1;
  rows.push(`<row r="${r}" ht="26" customHeight="1">${cell(`A${r}`, sheet.title, 'text', S.title)}${cols.slice(1).map((_, i) => `<c r="${columnLetter(i + 1)}${r}" s="${S.title}"/>`).join('')}</row>`);
  if (cols.length > 1) merges.push(`A${r}:${last}${r}`);
  for (const line of sheet.subtitle || []) {
    r++;
    rows.push(`<row r="${r}">${cell(`A${r}`, line, 'text', S.subtitle)}</row>`);
    if (cols.length > 1) merges.push(`A${r}:${last}${r}`);
  }
  r += 2;
  const headerRow = r;
  rows.push(`<row r="${r}" ht="30" customHeight="1">${cols.map((c, i) => cell(`${columnLetter(i)}${r}`, c.header, 'text', S.header)).join('')}</row>`);
  const firstData = r + 1;
  sheet.rows.forEach((row, idx) => {
    r++;
    const zebra = idx % 2 === 1;
    rows.push(`<row r="${r}">${cols.map((c, i) => cell(`${columnLetter(i)}${r}`, row[c.key], c.type || 'text', dataStyle(c.type || 'text', zebra))).join('')}</row>`);
  });
  const lastData = r;
  if (sheet.totalsLabel && cols.some(c => c.total)) {
    r++;
    const cells = cols.map((c, i) => {
      const ref = `${columnLetter(i)}${r}`;
      if (i === 0) return cell(ref, sheet.totalsLabel, 'text', S.totalLabel);
      if (!c.total) return `<c r="${ref}" s="${S.totalLabel}"/>`;
      // Cached value so every viewer shows the sum even before recalculating.
      const sum = sheet.rows.reduce((s, row) => s + (numeric(row[c.key]) || 0), 0);
      const range = `${columnLetter(i)}${firstData}:${columnLetter(i)}${Math.max(firstData, lastData)}`;
      const style = c.type === 'number' && !Number.isInteger(sum) ? S.totalNumber : S.totalMoney;
      return `<c r="${ref}" s="${style}"><f>${sheet.rows.length ? `SUM(${range})` : '0'}</f><v>${sum}</v></c>`;
    });
    rows.push(`<row r="${r}" ht="18" customHeight="1">${cells.join('')}</row>`);
  }
  if (sheet.summary?.length) {
    r++;
    for (const item of sheet.summary) {
      r++;
      const type = item.type || 'money';
      const style = type === 'money' ? S.sumMoney : type === 'number' ? S.sumNumber : type === 'percent' ? S.sumPercent : S.sumText;
      rows.push(`<row r="${r}">${cell(`A${r}`, item.label, 'text', S.sumLabel)}${cell(`B${r}`, item.value, type === 'date' ? 'date' : type, style)}</row>`);
      if (cols.length > 2) merges.push(`B${r}:${columnLetter(Math.min(cols.length - 1, 2))}${r}`);
    }
  }
  const widths = cols.map((c, i) => {
    if (c.width) return c.width;
    const longest = Math.max(c.header.length, ...sheet.rows.slice(0, 500).map(row => (c.type === 'money' || c.type === 'number' ? Math.round(numeric(row[c.key]) || 0).toLocaleString('en-US') : String(row[c.key] ?? '')).length));
    const w = Math.min(48, Math.max(c.type === 'money' ? 14 : 9, longest + 2));
    return i === 0 && sheet.summary?.length ? Math.max(w, 26) : w;
  });
  const filterRef = sheet.rows.length ? `A${headerRow}:${last}${lastData}` : null;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${last}${Math.max(r, 1)}"/>
<sheetViews><sheetView workbookViewId="0" zoomScale="100"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${headerRow + 1}" sqref="A${headerRow + 1}"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows.join('')}</sheetData>
${filterRef ? `<autoFilter ref="${filterRef}"/>` : ''}
${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
<headerFooter><oddFooter>&amp;L&amp;8&amp;A&amp;R&amp;8&amp;P / &amp;N</oddFooter></headerFooter>
</worksheet>`;
  return { xml, filterRef };
}

/** Tab names: max 31 chars, no []:*?/\ and unique. */
function safeSheetNames(sheets: XlsxSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    let name = (s.name || `Varaq ${i + 1}`).replace(/[\[\]:*?/\\]/g, ' ').trim().slice(0, 31) || `Varaq ${i + 1}`;
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 27)} (${n++})`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function buildXlsx(sheets: XlsxSheet[]): Buffer {
  if (!sheets.length) throw new Error('Eksport uchun varaq yo‘q');
  const names = safeSheetNames(sheets);
  const built = sheets.map(sheetXml);
  const files: Record<string, string> = {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Distro Pro</Application></Properties>`,
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${built.some(b => b.filterRef) ? `<definedNames>${built.map((b, i) => b.filterRef ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i].replace(/'/g, "''"))}'!${b.filterRef.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : '').join('')}</definedNames>` : ''}</workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': STYLES
  };
  built.forEach((b, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = b.xml; });
  return zip(files);
}

// ---- ZIP (deflate) ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: Record<string, string>): Buffer {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const compressed = deflateRawSync(data, { level: 6 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  const count = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

/** Content-Disposition with a readable UTF-8 file name. */
export function xlsxDisposition(fileName: string): string {
  const name = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
