// Announcements can't hold garbage. Same rules as announcements_title_text /
// announcements_body_text and save_announcement() in
// supabase/29_announcements.sql, whose pgTAP tests are the boundary.
import { describe, expect, test } from 'vitest';
import { ANNOUNCEMENT_BODY_MAX, ANNOUNCEMENT_TITLE_MAX, validateAnnouncement } from './validation';

const ch = (...codes) => String.fromCodePoint(...codes);
const GOOD = { title: 'Teams due Friday', body: 'Every team needs all its members by 5pm.' };

describe('announcement: what is accepted', () => {
  test('a title and a message, trimmed, with Windows line endings made plain', () => {
    const { isValid, values } = validateAnnouncement({ title: '  Teams due  ', body: '  Line one.\r\nLine two.  ' });
    expect(isValid).toBe(true);
    expect(values).toEqual({ title: 'Teams due', body: 'Line one.\nLine two.' });
  });

  test.each([
    ['another script', { title: 'Entrega — 提交', body: 'Entreguen la propuesta. 提交提案。' }],
    ['an emoji alongside words', { title: `Demo day ${ch(0x1f389)}`, body: `See you there ${ch(0x1f44b)}` }],
    ['one blank line between paragraphs', { ...GOOD, body: 'First.\n\nSecond.' }],
    ['the longest allowed', { title: 't'.repeat(ANNOUNCEMENT_TITLE_MAX), body: 'b'.repeat(ANNOUNCEMENT_BODY_MAX) }],
    ['SQL and HTML, which are just text', { title: "Robert'); DROP TABLE announcements; --", body: '<script>alert(1)</script>' }],
  ])('%s', (_, input) => {
    expect(validateAnnouncement(input).errors).toEqual({});
  });
});

describe('announcement title: garbage is refused', () => {
  test.each([
    ['blank', '   ', 'Give the announcement a title'],
    ['too long', 't'.repeat(ANNOUNCEMENT_TITLE_MAX + 1), 'Keep the title to 120 characters or fewer'],
    ['only punctuation', '!!! ???', 'The title has to include letters or numbers'],
    ['only emoji and arrows', `${ch(0x1f389, 0x1f389)} ${ch(0x2192)}`, 'The title has to include letters or numbers'],
    ['a line break', 'Two\nlines', "The title can't contain line breaks, hidden or control characters"],
    ['a tab', 'a\tb', "The title can't contain line breaks, hidden or control characters"],
    ['a zero-width space', `Hi${ch(0x200b)} there`, "The title can't contain line breaks, hidden or control characters"],
    ['a right-to-left override', `Due ${ch(0x202e)}eud`, "The title can't contain line breaks, hidden or control characters"],
  ])('%s', (_, title, error) => {
    expect(validateAnnouncement({ ...GOOD, title }).errors).toEqual({ title: error });
  });
});

describe('announcement message: garbage is refused', () => {
  test.each([
    ['empty', '', 'Write a message'],
    ['only whitespace', ' \n\t ', 'Write a message'],
    ['too long', 'b'.repeat(ANNOUNCEMENT_BODY_MAX + 1), 'Keep the message to 2000 characters or fewer'],
    ['only punctuation', '... --- !!!', 'The message has to include letters or numbers'],
    ['only emoji and symbols', `${ch(0x1f389, 0x1f389)} ${ch(0x2605)}`, 'The message has to include letters or numbers'],
    ['a terminal escape', `Bring${ch(0x1b)}[31m laptops`, "The message can't contain hidden or control characters"],
    ['a null byte', `Bring${ch(0)} laptops`, "The message can't contain hidden or control characters"],
    ['a byte-order mark', `${ch(0xfeff)}Bring laptops`, "The message can't contain hidden or control characters"],
    ['a right-to-left override', `Due ${ch(0x202e)}fdp.lasoporp`, "The message can't contain hidden or control characters"],
    ['blank lines piled up', 'One.\n \n\t\nTwo.', 'Leave at most one blank line in a row'],
  ])('%s', (_, body, error) => {
    expect(validateAnnouncement({ ...GOOD, body }).errors).toEqual({ body: error });
  });
});
