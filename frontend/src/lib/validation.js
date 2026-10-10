// Input validation shared by the forms (inline errors) and api/client.js
// (the last check before anything is sent). Every rule here is mirrored by
// a database CHECK constraint in supabase/11_profile_validation.sql — the
// database is the real boundary, since anyone signed in can call Supabase
// directly and skip this file. Change a rule in both places, and in the
// tests next to each.

export const BIO_MAX = 500;
export const AVAILABILITY_MIN = 0;
export const AVAILABILITY_MAX = 40;

// A GitHub profile link: https, github.com (optionally www.), one username
// segment (letters, digits, hyphens; GitHub caps usernames at 39), optional
// trailing slash. Same pattern as users_github_url_format_check.
export const GITHUB_URL_PATTERN = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/?$/i;

// Counts characters the way Postgres char_length() does (code points), so an
// emoji counts as one here and in the database, not two.
export function charCount(text) {
  return [...(text ?? '')].length;
}

export class ValidationError extends Error {
  constructor(fieldErrors) {
    super(Object.values(fieldErrors)[0] ?? 'Some fields are invalid');
    this.name = 'ValidationError';
    this.fieldErrors = fieldErrors;
  }
}

function checkAvailability(raw) {
  const text = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  if (text === '') return { error: `Enter how many hours a week you can work (${AVAILABILITY_MIN}–${AVAILABILITY_MAX})` };
  if (!/^\d+$/.test(text)) return { error: 'Hours must be a whole number' };
  const hours = Number(text);
  if (hours < AVAILABILITY_MIN || hours > AVAILABILITY_MAX) {
    return { error: `Hours must be between ${AVAILABILITY_MIN} and ${AVAILABILITY_MAX}` };
  }
  return { value: hours };
}

function checkGithubUrl(raw) {
  const url = String(raw ?? '').trim();
  if (url === '') return { value: '' };
  if (!GITHUB_URL_PATTERN.test(url)) {
    return { error: 'Use your GitHub profile link, like https://github.com/your-username' };
  }
  return { value: url };
}

function checkBio(raw) {
  const bio = String(raw ?? '').trim();
  if (charCount(bio) > BIO_MAX) return { error: `Bio can be at most ${BIO_MAX} characters` };
  return { value: bio };
}

const PROFILE_CHECKS = {
  bio: checkBio,
  github_url: checkGithubUrl,
  availability_hours: checkAvailability,
};

// Validates whichever profile fields are present in `input` (so a partial
// update only checks what it changes). Returns the cleaned values ready to
// save, the per-field error messages, and whether everything passed.
export function validateProfile(input) {
  const values = {};
  const errors = {};
  for (const [field, check] of Object.entries(PROFILE_CHECKS)) {
    if (!(field in input)) continue;
    const result = check(input[field]);
    if (result.error) errors[field] = result.error;
    else values[field] = result.value;
  }
  return { values, errors, isValid: Object.keys(errors).length === 0 };
}

// Turns a database CHECK violation on users into the same field message the
// form would have shown, so a rule enforced only server-side still lands
// next to the right field. Returns null for any other error.
const CONSTRAINT_FIELDS = {
  users_bio_length_check: ['bio', `Bio can be at most ${BIO_MAX} characters`],
  users_github_url_format_check: ['github_url', 'Use your GitHub profile link, like https://github.com/your-username'],
  users_availability_hours_range_check: ['availability_hours', `Hours must be between ${AVAILABILITY_MIN} and ${AVAILABILITY_MAX}`],
  users_availability_hours_check: ['availability_hours', `Hours must be between ${AVAILABILITY_MIN} and ${AVAILABILITY_MAX}`],
};

export function fieldErrorsFromDbError(error) {
  if (error?.code !== '23514') return null;
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  for (const [constraint, [field, message]] of Object.entries(CONSTRAINT_FIELDS)) {
    if (text.includes(constraint)) return { [field]: message };
  }
  return null;
}
