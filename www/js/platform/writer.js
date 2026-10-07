// «Мои книги»: хранение рукописей и экспорт в FB2 / EPUB / DOCX (перенос main/writer.js)
import { vfs, base64ToBytes } from './vfs.js';
import JSZip from '../../vendor/jszip.js';

const DIR = 'writer';
const LIST = `${DIR}/_index.json`;

export class WriterService {
  file(id) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Недопустимый идентификатор книги');
    return `${DIR}/${id}.json`;
  }

  // Краткий список хранится отдельно, чтобы не читать все рукописи при каждом открытии раздела
  async list() {
    let idx = await vfs.readJson(LIST);
    if (!idx) {
      idx = {};
      for (const n of await vfs.list(DIR)) {
        if (!n.endsWith('.json') || n === '_index.json') continue;
        const b = await vfs.readJson(`${DIR}/${n}`);
        if (b) idx[b.id] = this.summary(b);
      }
      await vfs.writeJson(LIST, idx);
    }
    return Object.values(idx).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }

  summary(b) {
    const words = (b.chapters || []).reduce((a, c) => a + (c.words || 0), 0);
    return { id: b.id, title: b.title, author: b.author, cover: b.cover || null, chapters: (b.chapters || []).length, words, updated: b.updated, created: b.created };
  }

  async get(id) {
    const b = await vfs.readJson(this.file(id));
    if (!b) throw new Error('Рукопись не найдена');
    return b;
  }

  async save(book) {
    book.updated = new Date().toISOString();
    await vfs.writeJson(this.file(book.id), book);
    const idx = (await vfs.readJson(LIST)) || {};
    idx[book.id] = this.summary(book);
    await vfs.writeJson(LIST, idx);
    return book.updated;
  }

  async remove(id) {
    await vfs.remove(this.file(id));
    const idx = (await vfs.readJson(LIST)) || {};
    delete idx[id];
    await vfs.writeJson(LIST, idx);
  }

  async build(format, data) {
    if (format === 'fb2') return new TextEncoder().encode(data.xml);
    if (format === 'epub') {
      const zip = new JSZip();
      zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
      for (const f of data.files) zip.file(f.path, f.base64 ? base64ToBytes(f.base64) : f.text);
      return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
    }
    if (format === 'docx') return buildDocx(data);
    throw new Error('Неизвестный формат экспорта');
  }
}

async function buildDocx(data) {
  const d = await import('../../vendor/docx.js');
  const runsOf = (runs = []) => runs.map((r) => new d.TextRun({ text: r.text, bold: !!r.b, italics: !!r.i, underline: r.u ? {} : undefined, strike: !!r.s }));
  const children = [];
  children.push(new d.Paragraph({ heading: d.HeadingLevel.TITLE, alignment: d.AlignmentType.CENTER, children: [new d.TextRun(data.title || 'Без названия')] }));
  if (data.author) children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun({ text: data.author, italics: true })] }));
  if (data.annotation) children.push(new d.Paragraph({ spacing: { before: 400 }, children: [new d.TextRun({ text: data.annotation, italics: true })] }));
  for (const ch of data.chapters) {
    children.push(new d.Paragraph({ heading: d.HeadingLevel.HEADING_1, pageBreakBefore: true, children: [new d.TextRun(ch.title || '')] }));
    for (const b of ch.blocks) {
      if (b.type === 'h2' || b.type === 'h3') children.push(new d.Paragraph({ heading: b.type === 'h2' ? d.HeadingLevel.HEADING_2 : d.HeadingLevel.HEADING_3, children: runsOf(b.runs) }));
      else if (b.type === 'scene') children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.TextRun('* * *')] }));
      else if (b.type === 'quote') children.push(new d.Paragraph({ indent: { left: 720 }, children: runsOf(b.runs) }));
      else if (b.type === 'stamp') children.push(new d.Paragraph({ children: runsOf(b.runs.map((r) => ({ ...r, b: true }))) }));
      else if (b.type === 'image' && b.base64) {
        try {
          children.push(new d.Paragraph({ alignment: d.AlignmentType.CENTER, children: [new d.ImageRun({ type: b.ext === 'png' ? 'png' : 'jpg', data: base64ToBytes(b.base64), transformation: { width: b.w || 480, height: b.h || 320 } })] }));
        } catch { /* картинку пропускаем, текст важнее */ }
      } else children.push(new d.Paragraph({ indent: { firstLine: 567 }, children: runsOf(b.runs) }));
    }
  }
  const doc = new d.Document({ creator: data.author || '', title: data.title || '', sections: [{ children }] });
  return new Uint8Array(await (await d.Packer.toBlob(doc)).arrayBuffer());
}
