// Reading a resume in the browser.
//
// This is the only file that knows about the DOM or about pdf.js workers.
// Both libraries are loaded on demand, so a student who never imports a resume
// never downloads them.
//
// Nothing is uploaded: the file is read from the student's own disk, parsed in
// their tab, and only the skills they confirm are ever sent to the server.

import { detectKind, finishDocument } from './text.js';
import { texToText } from './latex.js';

// A resume is a page or two. Anything much bigger is a portfolio or a mistake,
// and parsing it would freeze the tab.
export const MAX_BYTES = 8 * 1024 * 1024;
export const ACCEPTED = '.pdf,.docx,.tex,.txt,.md';

export class ResumeReadError extends Error {}

async function readPdf(bytes) {
  const pdfjs = await import('pdfjs-dist');
  // Vite hands back a URL for the worker script; without it pdf.js parses on
  // the main thread and freezes the page on a long document.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 });
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
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x: item.transform[4], str: item.str });
    }
    for (const y of [...rows.keys()].sort((a, b) => b - a)) {
      const row = rows
        .get(y)
        .sort((a, b) => a.x - b.x)
        .map((cell) => cell.str)
        .join(' ');
      lines.push(row.replace(/\s+/g, ' ').replace(/\s+([,.;:)])/g, '$1').trim());
    }
    page.cleanup();
  }
  await task.destroy();
  return lines.join('\n');
}

async function readDocx(bytes) {
  const mammoth = (await import('mammoth/mammoth.browser.js')).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
  return value;
}

// Reads a File from an <input type="file">. Throws ResumeReadError with a
// message written for the student, never a library stack trace.
export async function readResumeFile(file) {
  if (!file) throw new ResumeReadError('No file was chosen.');
  if (file.size > MAX_BYTES) {
    throw new ResumeReadError(
      `That file is ${Math.round(file.size / 1024 / 1024)} MB. Resumes should be under 8 MB.`,
    );
  }
  if (file.size === 0) throw new ResumeReadError('That file is empty.');

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectKind(file.name, bytes);

  try {
    if (kind === 'pdf') return finishDocument(kind, await readPdf(bytes));
    if (kind === 'docx') return finishDocument(kind, await readDocx(bytes));
    const text = new TextDecoder().decode(bytes);
    return finishDocument(kind, kind === 'tex' ? texToText(text) : text);
  } catch (error) {
    // A password-protected or damaged file lands here.
    throw new ResumeReadError(
      `That ${kind.toUpperCase()} could not be read. If it is password protected, save a copy without the password and try again.`,
      { cause: error },
    );
  }
}
