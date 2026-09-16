// The conversion layer: any resume in, one shape out.
//
//   toDocument(bytes, { name }) -> { kind, text, lines, warnings }
//
// Everything downstream (sections, skills, evidence) reads that shape and never
// learns which format it came from, so adding .md or .rtf later costs one case
// in this file and nothing else.
//
// All three readers run locally — in Node here, and in the browser unchanged,
// which is the point: a resume never has to be uploaded anywhere.

import mammoth from 'mammoth';
import { texToText } from './latex.mjs';

// A page of text that yields almost nothing is usually a scan.
const SUSPICIOUSLY_EMPTY = 200;

const asBuffer = (input) =>
  Buffer.isBuffer(input) ? input : Buffer.from(input instanceof Uint8Array ? input : new Uint8Array(input));

export function detectKind(name = '', bytes) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (['pdf', 'docx', 'tex', 'txt', 'md'].includes(ext)) return ext === 'md' ? 'txt' : ext;

  // Fall back to the file's own signature when the name is missing or lying.
  const head = asBuffer(bytes).subarray(0, 4).toString('binary');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) return 'docx'; // any Office file is a zip
  return 'txt';
}

// pdf.js ships the 14 standard fonts as data files and warns when it cannot
// find them. In a browser the bundler provides the URL; in Node we resolve the
// installed package. Guarded so this file still imports cleanly in a browser.
async function standardFontsUrl() {
  if (typeof process === 'undefined' || !process.versions?.node) return undefined;
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
    // Fonts only matter for drawing pages, and we only read text. Without this
    // pdf.js warns on every missing font file.
    verbosity: 0,
  });
  const doc = await task.promise;

  const lines = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    // PDFs have no concept of a line: items carry x/y positions, so items that
    // share a y are one line, ordered by x.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str: item.str });
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

async function readDocx(bytes) {
  const { value } = await mammoth.extractRawText({ buffer: asBuffer(bytes) });
  return value;
}

export async function toDocument(input, { name = '' } = {}) {
  const kind = detectKind(name, input);
  const warnings = [];

  let text;
  if (kind === 'pdf') text = await readPdf(input);
  else if (kind === 'docx') text = await readDocx(input);
  else if (kind === 'tex') text = texToText(asBuffer(input).toString('utf8'));
  else text = asBuffer(input).toString('utf8');

  text = text.replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();

  if (text.length < SUSPICIOUSLY_EMPTY) {
    warnings.push(
      kind === 'pdf'
        ? 'Almost no text came out of this PDF. It is probably a scan or an image export — ask for a text PDF.'
        : 'This file holds almost no text.',
    );
  }

  const lines = text.split('\n').map((line) => line.trim());
  return { kind, text, lines, warnings };
}
