// Issue #17 — Logic tests for profile validation.
import { describe, expect, test } from 'vitest';
import {
  BIO_MAX,
  GITHUB_URL_PATTERN,
  ValidationError,
  charCount,
  fieldErrorsFromDbError,
  validateProfile,
} from './validation';

describe('availability_hours', () => {
  test.each([0, 20, 40, '0', '20', '40', ' 12 '])('accepts %j', (value) => {
    const { isValid, values } = validateProfile({ availability_hours: value });
    expect(isValid).toBe(true);
    expect(values.availability_hours).toBe(Number(String(value).trim()));
  });

  test.each([-1, 41, 2.5, '', '   ', 'e', 'abc', '-1', '41', '2.5', '1e1', null, undefined, 500])(
    'rejects %j',
    (value) => {
      const { isValid, errors } = validateProfile({ availability_hours: value });
      expect(isValid).toBe(false);
      expect(errors.availability_hours).toBeTruthy();
    }
  );

  test('a decimal gets a whole-number message, an out-of-range number gets the range', () => {
    expect(validateProfile({ availability_hours: '2.5' }).errors.availability_hours).toMatch(/whole number/);
    expect(validateProfile({ availability_hours: '41' }).errors.availability_hours).toMatch(/between 0 and 40/);
  });
});

describe('github_url', () => {
  test.each([
    '',
    '   ',
    'https://github.com/jose-franco22',
    'https://github.com/Jose-Franco22/',
    'https://www.github.com/nguerra',
    'HTTPS://GITHUB.COM/adanbarrera',
    ' https://github.com/a ',
    `https://github.com/${'a'.repeat(39)}`,
  ])('accepts %j', (value) => {
    const { isValid, values } = validateProfile({ github_url: value });
    expect(isValid).toBe(true);
    expect(values.github_url).toBe(value.trim());
  });

  test.each([
    'github.com/x',
    'http://github.com/x',
    'https://gitlab.com/x',
    'https://github.com/',
    'https://github.com',
    'https://github.com/x/repo',
    'https://github.com/x?tab=repos',
    'https://github.com.evil.com/x',
    'https://evilgithub.com/x',
    'https://github.com/has space',
    `https://github.com/${'a'.repeat(40)}`,
    'javascript:alert(1)',
    'asdf',
  ])('rejects %j', (value) => {
    const { isValid, errors } = validateProfile({ github_url: value });
    expect(isValid).toBe(false);
    expect(errors.github_url).toMatch(/github\.com\/your-username/);
  });
});

describe('bio', () => {
  test('accepts exactly 500 characters and rejects 501', () => {
    expect(validateProfile({ bio: 'a'.repeat(BIO_MAX) }).isValid).toBe(true);
    expect(validateProfile({ bio: 'a'.repeat(BIO_MAX + 1) }).errors.bio).toMatch(/at most 500/);
  });

  test('whitespace-only bio is saved as empty', () => {
    const { isValid, values } = validateProfile({ bio: '   \n\t  ' });
    expect(isValid).toBe(true);
    expect(values.bio).toBe('');
  });

  test('surrounding whitespace is trimmed and does not count toward the limit', () => {
    const { isValid, values } = validateProfile({ bio: `  ${'a'.repeat(BIO_MAX)}  ` });
    expect(isValid).toBe(true);
    expect(values.bio).toBe('a'.repeat(BIO_MAX));
  });

  test('emoji count as one character, matching Postgres char_length()', () => {
    expect(charCount('🚀🚀')).toBe(2);
    expect(validateProfile({ bio: '🚀'.repeat(BIO_MAX) }).isValid).toBe(true);
    expect(validateProfile({ bio: '🚀'.repeat(BIO_MAX + 1) }).isValid).toBe(false);
  });

  test('SQL-looking text is just text', () => {
    const bio = "Robert'); DROP TABLE users;--";
    expect(validateProfile({ bio }).values.bio).toBe(bio);
  });
});

describe('validateProfile as a whole', () => {
  test('only checks the fields it is given (partial updates)', () => {
    const result = validateProfile({ bio: 'Hi' });
    expect(result).toEqual({ values: { bio: 'Hi' }, errors: {}, isValid: true });
  });

  test('reports every invalid field at once', () => {
    const { errors } = validateProfile({ bio: 'a'.repeat(501), github_url: 'nope', availability_hours: 99 });
    expect(Object.keys(errors).sort()).toEqual(['availability_hours', 'bio', 'github_url']);
  });

  test('ValidationError carries the field errors and the first message', () => {
    const err = new ValidationError({ github_url: 'bad link', bio: 'too long' });
    expect(err).toBeInstanceOf(Error);
    expect(err.fieldErrors).toEqual({ github_url: 'bad link', bio: 'too long' });
    expect(err.message).toBe('bad link');
  });
});

describe('fieldErrorsFromDbError', () => {
  test('maps each users CHECK constraint to its field', () => {
    const err = (name) => ({
      code: '23514',
      message: `new row for relation "users" violates check constraint "${name}"`,
    });
    expect(fieldErrorsFromDbError(err('users_bio_length_check'))).toHaveProperty('bio');
    expect(fieldErrorsFromDbError(err('users_github_url_format_check'))).toHaveProperty('github_url');
    expect(fieldErrorsFromDbError(err('users_availability_hours_range_check'))).toHaveProperty('availability_hours');
  });

  test('returns null for anything that is not a known CHECK violation', () => {
    expect(fieldErrorsFromDbError({ code: '42501', message: 'permission denied' })).toBeNull();
    expect(fieldErrorsFromDbError({ code: '23514', message: 'violates check constraint "other_check"' })).toBeNull();
    expect(fieldErrorsFromDbError(null)).toBeNull();
  });
});

test('the GitHub pattern is the one the database uses', async () => {
  // Guards against the two copies drifting apart: the SQL migration must
  // contain this exact pattern source.
  // Tests run with frontend/ as the working directory.
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const sql = readFileSync(resolve(process.cwd(), '../supabase/11_profile_validation.sql'), 'utf8');
  expect(sql).toContain(GITHUB_URL_PATTERN.source.replaceAll('\\/', '/'));
});
