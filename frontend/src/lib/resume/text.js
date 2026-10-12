// Shared text handling for every reader, in the browser and in Node.
//
// Whatever the format, a reader hands raw text to finishDocument() and gets
// back the one shape the rest of the parser reads.

// A resume that yields almost no text is a scan, not an empty resume.
const SUSPICIOUSLY_EMPTY = 200;

const NBSP = String.fromCharCode(0xa0);

// Raised when a file cannot be read at all. Its message is written for the
// student, never a library stack trace. It lives here rather than in
// readFile.js so the Node tools, which have their own readers, can throw the
// same error for the same reasons.
export class ResumeReadError extends Error {}

// The formats a resume can arrive in, mapped to how this parser treats them.
// Markdown is read as plain text; everything else is itself.
export const SUPPORTED_EXTENSIONS = {
  pdf: 'pdf',
  docx: 'docx',
  tex: 'tex',
  txt: 'txt',
  md: 'txt',
};

export function extensionOf(name = '') {
  const base = String(name).toLowerCase().split(/[\\/]/).pop();
  const dot = base.lastIndexOf('.');
  // A leading dot is a hidden file, not an extension, so `.gitignore` has none.
  return dot > 0 ? base.slice(dot + 1) : '';
}

// Does this look like a binary file rather than text? A single NUL settles it;
// otherwise a scattering of control characters does. Used only as a last
// resort, when the file arrived with no extension at all.
export function looksBinary(bytes) {
  const head = new Uint8Array(bytes ?? []).subarray(0, 1024);
  if (!head.length) return false;
  let odd = 0;
  for (const byte of head) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) odd++;
  }
  return odd / head.length > 0.1;
}

/**
 * Work out how to read this file, or return null if we cannot read it at all.
 *
 * Returning null is the point. This used to fall back to 'txt' for anything
 * unrecognised, which meant a .png was decoded as text and the student got an
 * empty result with no idea why — and worse, a .xlsx matched the zip signature
 * and was handed to the DOCX reader. The name is believed over the bytes for
 * exactly that reason: every Office file is a zip, so the signature cannot
 * tell a spreadsheet from a document.
 */
export function detectKind(name = '', bytes) {
  const extension = extensionOf(name);
  if (extension) {
    return SUPPORTED_EXTENSIONS[extension] ?? null;
  }

  // No extension to go on: fall back to the file's own signature.
  const head = new Uint8Array(bytes ?? []).subarray(0, 8);
  const signature = String.fromCharCode(...head);
  if (signature.startsWith('%PDF')) return 'pdf';
  if (signature.startsWith('PK')) return 'docx'; // every Office file is a zip
  if (looksBinary(bytes)) return null;
  return 'txt';
}

// What to tell the student when detectKind() gives up. Names the formats that
// do work, because "unsupported file type" on its own is not actionable.
export function unsupportedFileMessage(name = '') {
  const extension = extensionOf(name);
  const formats = 'Upload a PDF, Word (.docx), LaTeX (.tex) or plain text resume instead.';
  return extension
    ? `TeamUp can't read .${extension} files. ${formats}`
    : `TeamUp couldn't tell what kind of file that is. ${formats}`;
}

// A bullet that runs past the page width arrives as two lines, and the second
// half starts mid-sentence. Rejoin those so a quote reads as written.
export function joinWrapped(lines) {
  const joined = [];
  for (const line of lines) {
    const previous = joined[joined.length - 1];
    const continues =
      previous &&
      !/[.!?]["')\]]?$/.test(previous) && // previous line did not finish a sentence
      /^[a-z(]/.test(line) && // this one starts mid-sentence
      !/^https?:/i.test(line);
    if (continues) joined[joined.length - 1] = `${previous} ${line}`;
    else joined.push(line);
  }
  return joined;
}

export function finishDocument(kind, rawText) {
  // PDFs are full of non-breaking spaces. Built from its character code
  // rather than typed as itself: an invisible literal in the source is one
  // careless copy-paste away from becoming an ordinary space, which turns
  // this line into a no-op that nothing would notice.
  const text = String(rawText).replace(/\r\n?/g, '\n').split(NBSP).join(' ').trim();
  const warnings = [];

  if (text.length < SUSPICIOUSLY_EMPTY) {
    warnings.push(
      kind === 'pdf'
        ? 'Almost no text came out of this PDF. It is probably a scan or an image export, so upload a text PDF instead.'
        : 'This file holds almost no text.',
    );
  }

  const lines = joinWrapped(text.split('\n').map((line) => line.trim()));
  return { kind, text: lines.join('\n'), lines, warnings };
}
