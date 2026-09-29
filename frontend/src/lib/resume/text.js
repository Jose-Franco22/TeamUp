// Shared text handling for every reader, in the browser and in Node.
//
// Whatever the format, a reader hands raw text to finishDocument() and gets
// back the one shape the rest of the parser reads.

// A resume that yields almost no text is a scan, not an empty resume.
const SUSPICIOUSLY_EMPTY = 200;

export function detectKind(name = '', bytes) {
  const extension = String(name).toLowerCase().split('.').pop();
  if (['pdf', 'docx', 'tex', 'txt', 'md'].includes(extension)) {
    return extension === 'md' ? 'txt' : extension;
  }

  // Fall back to the file's own signature when the name is missing or lying.
  const head = new Uint8Array(bytes).subarray(0, 4);
  const signature = String.fromCharCode(...head);
  if (signature.startsWith('%PDF')) return 'pdf';
  if (signature.startsWith('PK')) return 'docx'; // every Office file is a zip
  return 'txt';
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
  const text = String(rawText).replace(/\r\n?/g, '\n').replace(/ /g, ' ').trim();
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
