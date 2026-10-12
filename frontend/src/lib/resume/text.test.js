// Issue #19 — deciding what a file is, and refusing the ones we can't read.
//
// This used to fall back to plain text for anything unrecognised, so a .png
// was decoded as garbage and the student got an empty result with no reason
// given. Worse, a .xlsx matched the zip signature and went to the DOCX
// reader. Both acceptance criteria ("other types show a clear error", "a
// scanned or unreadable file shows a helpful message") depend on this file.
import { describe, expect, test } from 'vitest';
import {
  SUPPORTED_EXTENSIONS,
  detectKind,
  extensionOf,
  finishDocument,
  joinWrapped,
  looksBinary,
  unsupportedFileMessage,
} from './text';

// Real file signatures, so the tests exercise the same bytes a browser would
// hand us rather than a string that happens to start with the right letters.
const bytesOf = (...parts) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

const PDF = bytesOf('%PDF-1.7\n', [0x0a, 0x25]);
const ZIP = bytesOf('PK', [0x03, 0x04], 'anything');
const PNG = bytesOf([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
const TEXT = bytesOf('Nicolas Guerra\nSkills: React, Python\n');

describe('extensionOf', () => {
  test.each([
    ['resume.pdf', 'pdf'],
    ['resume.PDF', 'pdf'],
    ['My Resume (final).docx', 'docx'],
    ['cv.2026.tex', 'tex'],
    ['C:\\Users\\me\\resume.pdf', 'pdf'],
    ['/home/me/resume.pdf', 'pdf'],
  ])('%s -> %s', (name, expected) => {
    expect(extensionOf(name)).toBe(expected);
  });

  test.each(['resume', '', '.gitignore', undefined])('%j has no extension', (name) => {
    expect(extensionOf(name)).toBe('');
  });
});

describe('detectKind: formats we support', () => {
  test.each([
    ['resume.pdf', 'pdf'],
    ['resume.docx', 'docx'],
    ['resume.tex', 'tex'],
    ['resume.txt', 'txt'],
    ['resume.md', 'txt'], // markdown is read as plain text
    ['RESUME.TEX', 'tex'], // the picker does not normalise case
  ])('%s is read as %s', (name, kind) => {
    expect(detectKind(name, TEXT)).toBe(kind);
  });

  test('the list of supported extensions is the one the file input offers', () => {
    expect(Object.keys(SUPPORTED_EXTENSIONS).sort()).toEqual(['docx', 'md', 'pdf', 'tex', 'txt']);
  });
});

describe('detectKind: formats we refuse', () => {
  test.each(['resume.png', 'resume.jpg', 'resume.xlsx', 'resume.pptx', 'resume.pages', 'resume.zip', 'resume.doc'])(
    '%s is refused',
    (name) => {
      expect(detectKind(name, TEXT)).toBeNull();
    }
  );

  // The one that mattered: .xlsx, .pptx and .docx are all zips, so the
  // signature cannot tell them apart. Believing the name is what stops a
  // spreadsheet being handed to the Word reader.
  test('a spreadsheet is refused even though it has the same signature as a .docx', () => {
    expect(detectKind('budget.xlsx', ZIP)).toBeNull();
    expect(detectKind('resume.docx', ZIP)).toBe('docx');
  });

  test('a PDF renamed to .png is refused rather than read', () => {
    expect(detectKind('resume.png', PDF)).toBeNull();
  });
});

describe('detectKind: no extension to go on', () => {
  test('falls back to the file signature', () => {
    expect(detectKind('', PDF)).toBe('pdf');
    expect(detectKind('', ZIP)).toBe('docx');
    expect(detectKind('resume', PDF)).toBe('pdf');
  });

  test('plain text with no extension is still readable', () => {
    expect(detectKind('', TEXT)).toBe('txt');
  });

  test('binary content with no extension is refused, not decoded as text', () => {
    expect(detectKind('', PNG)).toBeNull();
  });

  // Not "refused": an empty file is caught earlier by the size check in
  // readResumeFile. All this has to do is not throw.
  test('no bytes at all does not throw, and is left to the empty-file check', () => {
    expect(() => detectKind('', undefined)).not.toThrow();
    expect(detectKind('', new Uint8Array())).toBe('txt');
  });
});

describe('looksBinary', () => {
  test('a NUL byte settles it', () => {
    expect(looksBinary(bytesOf('hello', [0x00], 'world'))).toBe(true);
  });

  test('ordinary text, including accents and newlines, is not binary', () => {
    expect(looksBinary(bytesOf('Nicolás Guerra\n\tReact, Python\r\n'))).toBe(false);
  });

  test('an empty file is not binary — it is caught earlier as empty', () => {
    expect(looksBinary(new Uint8Array())).toBe(false);
  });
});

describe('unsupportedFileMessage', () => {
  test('names the extension and the formats that do work', () => {
    const message = unsupportedFileMessage('resume.png');
    expect(message).toContain('.png');
    expect(message).toMatch(/PDF/);
    expect(message).toMatch(/\.docx/);
    expect(message).toMatch(/\.tex/);
  });

  test('says something useful when there is no extension to name', () => {
    const message = unsupportedFileMessage('resume');
    expect(message).toMatch(/couldn't tell what kind of file/i);
    expect(message).toMatch(/PDF/);
  });
});

describe('finishDocument', () => {
  test('warns that a PDF is probably a scan when almost nothing came out', () => {
    const doc = finishDocument('pdf', '  ');
    expect(doc.warnings[0]).toMatch(/scan/i);
    expect(doc.text).toBe('');
  });

  test('a short text file gets a warning too, worded for a text file', () => {
    expect(finishDocument('txt', 'React').warnings[0]).toMatch(/almost no text/i);
    expect(finishDocument('txt', 'React').warnings[0]).not.toMatch(/scan/i);
  });

  test('a full resume warns about nothing', () => {
    expect(finishDocument('txt', 'React '.repeat(60)).warnings).toEqual([]);
  });

  test('normalises Windows line endings and non-breaking spaces', () => {
    const doc = finishDocument('txt', 'Skills:\r\nReact\u00a0Native');
    expect(doc.lines).toEqual(['Skills:', 'React Native']);
  });
});

describe('joinWrapped', () => {
  test('rejoins a bullet that wrapped mid-sentence', () => {
    expect(joinWrapped(['Built a parser for resumes', 'that runs in the browser.'])).toEqual([
      'Built a parser for resumes that runs in the browser.',
    ]);
  });

  test('leaves a finished sentence alone', () => {
    const lines = ['Built a parser.', 'shipped it in a week'];
    expect(joinWrapped(lines)).toEqual(lines);
  });

  test('never swallows a URL into the line above', () => {
    const lines = ['Nicolas Guerra', 'https://github.com/nguerra'];
    expect(joinWrapped(lines)).toEqual(lines);
  });
});
