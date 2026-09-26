// Reading a resume in Node, for the tools in this package.
//
// The browser has its own readers in frontend/src/lib/resume/readFile.js.
// Everything after reading is shared, so both sides produce the same result —
// a test in this package asserts that for every format.

import mammoth from 'mammoth';
import { detectKind, finishDocument } from '../../frontend/src/lib/resume/text.js';
import { texToText } from '../../frontend/src/lib/resume/latex.js';

export { detectKind };

const asBuffer = (input) =>
  Buffer.isBuffer(input) ? input : Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));

// pdf.js ships the standard fonts as data files and warns when it cannot find
// them. Fonts only matter for drawing pages, and we only read text.
async function standardFontsUrl() {
  const { createRequire } = await import('node:module');
  const { pathToFileURL } = await import('node:url');
  const { dirname, join } = await import('node:path');
  const pkg = createRequire(import.meta.url).resolve('pdfjs-dist/package.json');
  return pathToFileURL(join(dirname(pkg), 'standard_fonts/')).href;
}

async function readPdf(bytes) {
  // The legacy build is the one that runs outside a browser worker.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(asBuffer(bytes)),
    isEvalSupported: false,
    disableFontFace: true,
    standardFontDataUrl: await standardFontsUrl(),
    verbosity: 0,
  });
  const doc = await task.promise;

  const lines = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], str: item.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const row = rows
        .get(y)
        .sort((a, b) => a.x - b.x)
        .map((cell) => cell.str)
        .join(' ');
      // Items are joined with a space, which leaves gaps before punctuation.
      lines.push(row.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim());
    }
    page.cleanup();
  }
  await task.destroy();
  return lines.join('\n');
}

export async function toDocument(input, { name = '' } = {}) {
  const kind = detectKind(name, input);

  if (kind === 'pdf') return finishDocument(kind, await readPdf(input));
  if (kind === 'docx') {
    const { value } = await mammoth.extractRawText({ buffer: asBuffer(input) });
    return finishDocument(kind, value);
  }
  const text = asBuffer(input).toString('utf8');
  return finishDocument(kind, kind === 'tex' ? texToText(text) : text);
}
