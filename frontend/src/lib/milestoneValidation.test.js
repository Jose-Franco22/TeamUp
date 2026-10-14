// Issue #38 — the milestone message can't hold garbage. Same rules as
// milestones_message_text / save_milestone() in
// supabase/28_milestone_messages.sql, whose pgTAP tests are the boundary.
import { describe, expect, test } from 'vitest';
import { MILESTONE_MESSAGE_MAX, validateMilestone } from './validation';

const ch = (...codes) => String.fromCodePoint(...codes);
const BASE = { name: 'Proposal due', due_at: '2026-11-01T23:59' };
const check = (message) => validateMilestone({ ...BASE, message });

describe('milestone message: what is accepted', () => {
  test.each([
    ['no message at all', undefined, ''],
    ['an empty message', '', ''],
    ['only whitespace, saved as no message', '  \n\t  ', ''],
    ['a sentence', 'Upload the proposal PDF to Blackboard.', 'Upload the proposal PDF to Blackboard.'],
    ['spaces at either end, trimmed', '  One per team.  ', 'One per team.'],
    ['Windows line endings, made plain', 'Line one.\r\nLine two.', 'Line one.\nLine two.'],
    ['one blank line between paragraphs', 'First.\n\nSecond.', 'First.\n\nSecond.'],
    ['a tabbed list', 'Bring:\n\t- laptop\n\t- charger', 'Bring:\n\t- laptop\n\t- charger'],
    ['another language and script', 'Entreguen la propuesta — 提交提案', 'Entreguen la propuesta — 提交提案'],
    ['words with an emoji', `Demo day ${ch(0x1f389)}`, `Demo day ${ch(0x1f389)}`],
    ['exactly the limit', 'a'.repeat(MILESTONE_MESSAGE_MAX), 'a'.repeat(MILESTONE_MESSAGE_MAX)],
  ])('%s', (_, message, saved) => {
    const { isValid, values, errors } = check(message);
    expect(errors.message).toBeUndefined();
    expect(isValid).toBe(true);
    expect(values.message).toBe(saved);
  });

  test('the limit counts characters the way Postgres does, so emoji count once', () => {
    expect(check(ch(0x1f389).repeat(MILESTONE_MESSAGE_MAX - 1) + 'a').isValid).toBe(true);
  });
});

describe('milestone message: garbage is refused', () => {
  test.each([
    ['one character over the limit', 'a'.repeat(MILESTONE_MESSAGE_MAX + 1), 'Keep the message to 1000 characters or fewer'],
    ['only punctuation', '... !!! --- ???', 'The message has to include letters or numbers'],
    ['only arrows, emoji and symbols', `${ch(0x2192, 0x2192)} ${ch(0x1f389, 0x1f389)} ${ch(0x2605)}`, 'The message has to include letters or numbers'],
    ['a control character', `Bring${ch(0x07)} laptops`, "The message can't contain hidden or control characters"],
    ['a terminal escape sequence', `Bring${ch(0x1b)}[31m laptops`, "The message can't contain hidden or control characters"],
    ['a null byte', `Bring${ch(0)} laptops`, "The message can't contain hidden or control characters"],
    ['a zero-width space', `Bring${ch(0x200b)} laptops`, "The message can't contain hidden or control characters"],
    ['a zero-width joiner', `Bring${ch(0x200d)} laptops`, "The message can't contain hidden or control characters"],
    ['a right-to-left override', `Due ${ch(0x202e)}fdp.lasoporp`, "The message can't contain hidden or control characters"],
    ['a byte-order mark', `${ch(0xfeff)}Bring laptops`, "The message can't contain hidden or control characters"],
    ['two blank lines in a row', 'One.\n\n\nTwo.', 'Leave at most one blank line in a row'],
    ['blank lines hiding spaces and tabs', 'One.\n \n\t\nTwo.', 'Leave at most one blank line in a row'],
  ])('%s', (_, message, error) => {
    const { isValid, errors, values } = check(message);
    expect(isValid).toBe(false);
    expect(errors.message).toBe(error);
    expect(values.message).toBeUndefined();
  });

  test('a bad message blocks saving even when the name and date are fine', () => {
    const { isValid, errors } = check('!!!');
    expect(isValid).toBe(false);
    expect(Object.keys(errors)).toEqual(['message']);
  });
});

describe('milestone name: garbage is refused', () => {
  const name = (value) => validateMilestone({ ...BASE, name: value });
  test.each([
    ['only punctuation', '... --- !!!', 'The name has to include letters or numbers'],
    ['only emoji and arrows', `${ch(0x1f389, 0x1f389)} ${ch(0x2192)}`, 'The name has to include letters or numbers'],
    ['a line break', 'Proposal\ndue', "The name can't contain line breaks, hidden or control characters"],
    ['a tab', 'Proposal\tdue', "The name can't contain line breaks, hidden or control characters"],
    ['a control character', `Proposal${ch(7)} due`, "The name can't contain line breaks, hidden or control characters"],
    ['a zero-width space', `Proposal${ch(0x200b)} due`, "The name can't contain line breaks, hidden or control characters"],
    ['a right-to-left override', `Due ${ch(0x202e)}eud`, "The name can't contain line breaks, hidden or control characters"],
  ])('%s', (_, value, error) => {
    expect(name(value).errors.name).toBe(error);
  });

  test.each([
    ['another script', 'Entrega de la propuesta — 提交'],
    ['words and an emoji', `Demo day ${ch(0x1f389)}`],
    ['SQL, which is just text', "Robert'); DROP TABLE milestones; --"],
  ])('accepts %s', (_, value) => {
    expect(name(value).errors.name).toBeUndefined();
    expect(name(value).values.name).toBe(value);
  });
});

describe('milestone due date: out-of-range values are refused', () => {
  const due = (value) => validateMilestone({ ...BASE, due_at: value });
  test.each([
    ['year 1', '0001-01-01T00:00'],
    ['before 2000', '1999-12-31T12:00'],
    ['2100 or later', '2100-01-02T00:00'],
    ['the far future a picker allows', '275760-09-13T00:00'],
    ['not a date', 'next tuesday-ish'],
  ])('%s', (_, value) => {
    expect(due(value).errors.due_at).toMatch(/Pick a due date/);
  });

  test('a date in range is fine', () => {
    expect(due('2026-11-01T23:59').errors.due_at).toBeUndefined();
  });
});
