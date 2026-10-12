// Issue #17 — Logic tests for profile validation.
// Issue #23 — Logic tests for project validation (second half of the file).
import { describe, expect, test } from 'vitest';
import {
  BIO_MAX,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  DESCRIPTION_RANGE,
  GITHUB_URL_PATTERN,
  TEAM_SIZE_MAX,
  TEAM_SIZE_MIN,
  TEAM_SIZE_RANGE,
  TITLE_MAX,
  TITLE_MIN,
  TITLE_RANGE,
  ValidationError,
  charCount,
  fieldErrorsFromDbError,
  validateProfile,
  validateProject,
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

// --- Issue #23 — project validation ---------------------------------------
//
// Every rule here is also enforced by create_project() and update_project()
// and by a CHECK constraint on `projects`, because anyone signed in can call
// Supabase directly and skip this file entirely. The last test in this block
// guards the two copies against drifting apart.

const text = (n) => 'x'.repeat(n);
const ROLE_A = 'r-frontend';
const ROLE_B = 'r-backend';
const ok = {
  title: 'Campus parking tracker',
  description: 'Live lot occupancy estimated from existing camera feeds.',
  team_size_target: 4,
  own_role_id: ROLE_A,
  roles_needed: [{ role_id: ROLE_A, skill_id: 's-react', quantity_needed: 2 }],
};

describe('validateProject: title', () => {
  test.each([TITLE_MIN, 20, TITLE_MAX])('accepts a %i-character title', (n) => {
    expect(validateProject({ title: text(n) }).isValid).toBe(true);
  });

  test.each([TITLE_MIN - 1, TITLE_MAX + 1])('rejects a %i-character title', (n) => {
    const { isValid, errors } = validateProject({ title: text(n) });
    expect(isValid).toBe(false);
    expect(errors.title).toBe(TITLE_RANGE);
  });

  test('trims before counting, so "   ab   " is two characters, not eight', () => {
    const { isValid, errors } = validateProject({ title: '   ab   ' });
    expect(isValid).toBe(false);
    expect(errors.title).toBe(TITLE_RANGE);
  });

  test('trims before counting, so padding cannot push a title over the max', () => {
    expect(validateProject({ title: `   ${text(TITLE_MAX)}   ` }).isValid).toBe(true);
  });

  test('returns the trimmed value, which is what gets stored', () => {
    expect(validateProject({ title: '  Parking tracker  ' }).values.title).toBe('Parking tracker');
  });

  test.each(['', '   ', null, undefined])('%j asks for a title rather than quoting a range', (value) => {
    expect(validateProject({ title: value }).errors.title).toMatch(/give your project a title/i);
  });

  test('counts an emoji as one character, the way char_length does', () => {
    // Four code points. Postgres agrees, so the form and the constraint
    // cannot disagree about whether this is too short.
    expect(charCount('🙂🙂🙂🙂')).toBe(4);
    expect(validateProject({ title: '🙂🙂🙂🙂' }).isValid).toBe(false);
    expect(validateProject({ title: '🙂🙂🙂🙂🙂' }).isValid).toBe(true);
  });
});

describe('validateProject: description', () => {
  test.each([DESCRIPTION_MIN, 500, DESCRIPTION_MAX])('accepts a %i-character description', (n) => {
    expect(validateProject({ description: text(n) }).isValid).toBe(true);
  });

  test.each([DESCRIPTION_MIN - 1, DESCRIPTION_MAX + 1])('rejects a %i-character description', (n) => {
    const { isValid, errors } = validateProject({ description: text(n) });
    expect(isValid).toBe(false);
    expect(errors.description).toBe(DESCRIPTION_RANGE);
  });

  test('trims before counting', () => {
    expect(validateProject({ description: `  ${text(DESCRIPTION_MIN - 1)}  ` }).isValid).toBe(false);
  });

  test.each(['', '   ', null, undefined])('%j asks for a description', (value) => {
    expect(validateProject({ description: value }).errors.description).toMatch(
      /describe what the project is/i
    );
  });
});

describe('validateProject: team size', () => {
  test.each([TEAM_SIZE_MIN, 3, TEAM_SIZE_MAX, '2', '4', ' 3 '])('accepts %j', (value) => {
    const { isValid, values } = validateProject({ team_size_target: value });
    expect(isValid).toBe(true);
    expect(values.team_size_target).toBe(Number(String(value).trim()));
  });

  test.each([1, 5, 0, 100, '1', '5'])('rejects %j as out of range', (value) => {
    expect(validateProject({ team_size_target: value }).errors.team_size_target).toBe(TEAM_SIZE_RANGE);
  });

  test.each([2.5, '2.5', '3.0', 'three', '1e1', 'NaN', -1, '-1'])('rejects %j as not a whole number', (value) => {
    expect(validateProject({ team_size_target: value }).errors.team_size_target).toMatch(/whole number/);
  });

  test.each(['', '   ', null, undefined])('%j asks for a size', (value) => {
    expect(validateProject({ team_size_target: value }).errors.team_size_target).toMatch(
      /how many people/i
    );
  });

  test('matches the bounds api/client.js exports, so the two cannot drift', async () => {
    const { MIN_TEAM_SIZE, MAX_TEAM_SIZE } = await import('../api/client');
    expect(TEAM_SIZE_MIN).toBe(MIN_TEAM_SIZE);
    expect(TEAM_SIZE_MAX).toBe(MAX_TEAM_SIZE);
  });

  // Editing, not creating: the roster is already larger than the new target.
  test('a target below the people already seated says so specifically', () => {
    const { isValid, errors } = validateProject({ team_size_target: 2 }, { memberCount: 3 });
    expect(isValid).toBe(false);
    expect(errors.team_size_target).toMatch(/3 people are already on this team/);
  });

  test('a target equal to the current roster is fine', () => {
    expect(validateProject({ team_size_target: 3 }, { memberCount: 3 }).isValid).toBe(true);
  });
});

describe('validateProject: roles needed', () => {
  test('no roles at all is valid — listing them is optional', () => {
    expect(validateProject({ team_size_target: 4, roles_needed: [] }).isValid).toBe(true);
  });

  test('roles filling exactly the open seats are accepted', () => {
    // A team of 4 is you plus 3.
    const rows = [
      { role_id: ROLE_A, quantity_needed: 2 },
      { role_id: ROLE_B, quantity_needed: 1 },
    ];
    expect(validateProject({ team_size_target: 4, roles_needed: rows }).isValid).toBe(true);
  });

  test('one more person than there are seats is rejected, and the message does the arithmetic', () => {
    const rows = [
      { role_id: ROLE_A, quantity_needed: 2 },
      { role_id: ROLE_B, quantity_needed: 2 },
    ];
    const { isValid, errors } = validateProject({ team_size_target: 4, roles_needed: rows });
    expect(isValid).toBe(false);
    expect(errors.roles_needed).toBe(
      'A team of 4 has 3 open seats besides you, but you listed 4 people'
    );
  });

  test('the seat count follows the roster when editing, not just the target', () => {
    // A team of 4 with 3 already seated has one seat left, not three.
    const two = [{ role_id: ROLE_A, quantity_needed: 2 }];
    const one = [{ role_id: ROLE_A, quantity_needed: 1 }];
    expect(validateProject({ team_size_target: 4, roles_needed: two }, { memberCount: 3 }).isValid).toBe(false);
    expect(validateProject({ team_size_target: 4, roles_needed: one }, { memberCount: 3 }).isValid).toBe(true);
  });

  test('"1 open seat" is singular', () => {
    const rows = [{ role_id: ROLE_A, quantity_needed: 2 }];
    expect(validateProject({ team_size_target: 2, roles_needed: rows }).errors.roles_needed).toMatch(
      /1 open seat besides you/
    );
  });

  test('a row with no role picked is rejected rather than silently dropped', () => {
    const rows = [{ role_id: '', quantity_needed: 1 }];
    expect(validateProject({ team_size_target: 4, roles_needed: rows }).errors.roles_needed).toMatch(
      /needs a role selected/
    );
  });

  test('the same role twice is rejected — it is the primary key', () => {
    const rows = [
      { role_id: ROLE_A, quantity_needed: 1 },
      { role_id: ROLE_A, quantity_needed: 1 },
    ];
    expect(validateProject({ team_size_target: 4, roles_needed: rows }).errors.roles_needed).toMatch(
      /same role twice/
    );
  });

  test.each([0, 4, -1, 2.5, '2.5', '', null])('a quantity of %j is rejected', (quantity) => {
    const rows = [{ role_id: ROLE_A, quantity_needed: quantity }];
    expect(validateProject({ team_size_target: 4, roles_needed: rows }).errors.roles_needed).toMatch(
      /between 1 and 3 people/
    );
  });

  test('a seat complaint is suppressed while the size itself is wrong', () => {
    // Two messages for one mistake is noise; the size field reports it.
    const rows = [{ role_id: ROLE_A, quantity_needed: 3 }];
    const { errors } = validateProject({ team_size_target: 99, roles_needed: rows });
    expect(errors.team_size_target).toBeTruthy();
    expect(errors.roles_needed).toBeUndefined();
  });

  test.each([undefined, null, 'nonsense'])('%j as the roles list is treated as none', (value) => {
    expect(validateProject({ team_size_target: 4, roles_needed: value }).isValid).toBe(true);
  });
});

describe('validateProject: the whole form', () => {
  test('a complete, valid project passes with every value cleaned', () => {
    const { isValid, values, errors } = validateProject(ok);
    expect(errors).toEqual({});
    expect(isValid).toBe(true);
    expect(values.title).toBe(ok.title);
    expect(values.team_size_target).toBe(4);
  });

  test('only the fields present are checked, so a partial edit stays partial', () => {
    expect(validateProject({ title: ok.title }).isValid).toBe(true);
    expect(validateProject({}).isValid).toBe(true);
  });

  test('every broken field reports its own error at once', () => {
    const { errors } = validateProject({
      title: 'ab',
      description: 'too short',
      team_size_target: 9,
      own_role_id: '',
    });
    expect(Object.keys(errors).sort()).toEqual([
      'description',
      'own_role_id',
      'team_size_target',
      'title',
    ]);
  });

  test('a missing role for yourself is an error, since team_members.role_id is NOT NULL', () => {
    expect(validateProject({ own_role_id: '' }).errors.own_role_id).toMatch(/choose the role/i);
    expect(validateProject({ own_role_id: ROLE_A }).isValid).toBe(true);
  });

  test('a ValidationError carries the field errors and reads as a sentence', () => {
    const { errors } = validateProject({ title: 'ab' });
    const error = new ValidationError(errors);
    expect(error.fieldErrors.title).toBe(TITLE_RANGE);
    expect(error.message).toBe(TITLE_RANGE);
  });
});

describe('validateProject: the database agrees', () => {
  test('a CHECK violation on projects maps back to the right field', () => {
    const violation = (constraint) => ({
      code: '23514',
      message: `new row violates check constraint "${constraint}"`,
    });
    expect(fieldErrorsFromDbError(violation('projects_title_length_check'))).toEqual({
      title: TITLE_RANGE,
    });
    expect(fieldErrorsFromDbError(violation('projects_description_length_check'))).toEqual({
      description: DESCRIPTION_RANGE,
    });
  });

  // Guards against the two copies drifting: the numbers here and the ones in
  // the migration have to be the same, or the form accepts what the database
  // then refuses.
  test('the migration enforces the same lengths this file does', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sql = readFileSync(resolve(process.cwd(), '../supabase/16_project_validation.sql'), 'utf8');

    expect(sql).toContain(`char_length(btrim(title)) between ${TITLE_MIN} and ${TITLE_MAX}`);
    expect(sql).toContain(
      `char_length(btrim(description)) between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX}`
    );
    // The readable messages the functions raise must match the ones shown in
    // the form, so a student never sees two different sentences for one rule.
    expect(sql).toContain(TITLE_RANGE);
    expect(sql).toContain(DESCRIPTION_RANGE);
  });
});
