// Issue #57 — the browser's copy of the deliverable rules. Each boundary here
// is the same one supabase/45_milestone_deliverables.sql holds; the point of
// testing both sides of it is that an off-by-one in either copy fails.
import { describe, expect, test } from 'vitest';
import {
  BAD_LINK,
  BAD_NAME,
  COMMENT_EMPTY,
  COMMENT_TOO_LONG,
  DELIVERABLE_MAX_BYTES,
  EMPTY_FILE,
  NAME_TOO_LONG,
  NOTHING_CHOSEN,
  TOO_LARGE,
  WRONG_TYPE,
  fileExtension,
  formatBytes,
  validateComment,
  validateDeliverableFile,
  validateDeliverableLink,
} from './deliverables';

const file = (name, size = 1024) => ({ name, size });

describe('validateDeliverableFile', () => {
  test('25 MB is 26,214,400 bytes, the bucket’s file_size_limit', () => {
    expect(DELIVERABLE_MAX_BYTES).toBe(26214400);
  });

  test.each(['a.pdf', 'a.PDF', 'b.docx', 'c.pptx', ' spaced name.pdf '])('takes %s', (name) => {
    expect(validateDeliverableFile(file(name))).toBeNull();
  });

  test.each(['a.doc', 'a.ppt', 'a.txt', 'a.exe', 'a.pdf.exe', 'pdf', 'a.', ''])('refuses %j as the wrong type', (name) => {
    expect(validateDeliverableFile(file(name))).toBe(WRONG_TYPE);
  });

  test('exactly 25 MB passes; one byte more does not', () => {
    expect(validateDeliverableFile(file('a.pdf', DELIVERABLE_MAX_BYTES))).toBeNull();
    expect(validateDeliverableFile(file('a.pdf', DELIVERABLE_MAX_BYTES + 1))).toBe(TOO_LARGE);
  });

  test('the wrong type is reported before the size, so a 40 MB .zip is not "too large"', () => {
    expect(validateDeliverableFile(file('a.zip', 40 * 1024 * 1024))).toBe(WRONG_TYPE);
  });

  test('an empty file, no file, a long name and a hidden-character name are refused', () => {
    expect(validateDeliverableFile(file('a.pdf', 0))).toBe(EMPTY_FILE);
    expect(validateDeliverableFile(null)).toBe(NOTHING_CHOSEN);
    expect(validateDeliverableFile(file(`${'a'.repeat(197)}.pdf`))).toBe(NAME_TOO_LONG);
    expect(validateDeliverableFile(file(`${'a'.repeat(196)}.pdf`))).toBeNull();
    expect(validateDeliverableFile(file('Report‮xcod.docx'))).toBe(BAD_NAME);
  });

  test('the extension is read after trimming', () => {
    expect(fileExtension('Report.DOCX ')).toBe('docx');
  });
});

describe('validateDeliverableLink', () => {
  test.each(['https://docs.example.edu/x', 'http://example.com', 'HTTPS://Example.com/a?b=c#d'])('takes %s', (link) => {
    expect(validateDeliverableLink(link)).toBeNull();
  });

  test.each(['javascript:alert(1)', 'example.com', 'https://localhost', 'see the drive', 'https://a b.com', 'ftp://x.com'])(
    'refuses %s',
    (link) => {
      expect(validateDeliverableLink(link)).toBe(BAD_LINK);
    }
  );

  test('2000 characters passes, 2001 does not, and empty asks for something', () => {
    const base = 'https://docs.example.edu/';
    expect(validateDeliverableLink(base + 'a'.repeat(2000 - base.length))).toBeNull();
    expect(validateDeliverableLink(base + 'a'.repeat(2001 - base.length))).toMatch(/2000 characters/);
    expect(validateDeliverableLink('   ')).toBe(NOTHING_CHOSEN);
  });
});

describe('validateComment', () => {
  test('counts what the database counts: trimmed, with CRLF as one character', () => {
    expect(validateComment(`  ${'a'.repeat(2000)}\r\n`)).toBeNull();
    expect(validateComment('a'.repeat(2001))).toBe(COMMENT_TOO_LONG);
    expect(validateComment(' \n\t ')).toBe(COMMENT_EMPTY);
  });
});

test('formatBytes', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(2048)).toBe('2 KB');
  expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
  expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
});
