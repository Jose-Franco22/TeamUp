// Issue #42 — a next step's text and optional due date. Same rules as the
// next_steps constraints / save_next_step() in supabase/33_next_steps.sql,
// whose pgTAP tests are the boundary.
import { expect, test } from 'vitest';
import { NEXT_STEP_TITLE_MAX, validateNextStep } from './validation';

const ch = (...codes) => String.fromCodePoint(...codes);

test('the text is trimmed and the due date is optional', () => {
  expect(validateNextStep({ title: '  Confirm the roster  ' })).toEqual({
    values: { title: 'Confirm the roster', due_at: null },
    errors: {},
    isValid: true,
  });
  const dated = validateNextStep({ title: 'Submit the proposal', due_at: '2026-11-07T23:59:00Z' });
  expect(dated.values.due_at).toBe('2026-11-07T23:59:00.000Z');
});

test.each([
  ['no text', undefined, 'Write what teams need to do'],
  ['empty text', '', 'Write what teams need to do'],
  ['only spaces', '    ', 'Write what teams need to do'],
  ['punctuation alone', '!!! ???', 'The step has to include letters or numbers'],
  ['a line break', 'Two\nlines', "The step can't contain line breaks, hidden or control characters"],
  ['a zero-width space', `Hidden${ch(0x200b)}text`, "The step can't contain line breaks, hidden or control characters"],
  ['too long', 'x'.repeat(NEXT_STEP_TITLE_MAX + 1), `Keep the step to ${NEXT_STEP_TITLE_MAX} characters or fewer`],
])('%s is refused', (_, title, error) => {
  const { errors, isValid } = validateNextStep({ title });
  expect(isValid).toBe(false);
  expect(errors.title).toBe(error);
});

test('text in any script counts as words', () => {
  expect(validateNextStep({ title: '提交提案' }).isValid).toBe(true);
});

test('a due date outside 2000-2099 is refused', () => {
  expect(validateNextStep({ title: 'Far future', due_at: '2100-01-01T00:00:00Z' }).errors.due_at)
    .toBe('Pick a due date between 2000 and 2099');
  expect(validateNextStep({ title: 'Nonsense', due_at: 'not a date' }).errors.due_at)
    .toBe('Pick a valid date and time, or leave it blank');
});
