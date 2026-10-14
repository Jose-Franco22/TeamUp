// Input validation shared by the forms (inline errors) and api/client.js
// (the last check before anything is sent). Every rule here is mirrored by
// a database CHECK constraint in supabase/11_profile_validation.sql — the
// database is the real boundary, since anyone signed in can call Supabase
// directly and skip this file. Change a rule in both places, and in the
// tests next to each.

export const BIO_MAX = 500;
export const AVAILABILITY_MIN = 0;
export const AVAILABILITY_MAX = 40;

// Project fields (issue #23). Mirrored by CHECK constraints in
// supabase/16_project_validation.sql and by the raises in create_project()
// and update_project(), which are the real boundary.
export const TITLE_MIN = 5;
export const TITLE_MAX = 100;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 2000;
// A senior project team is 2 to 4. Repeated from api/client.js rather than
// imported, because client.js imports this file and the cycle is not worth
// one constant; the test asserts the two agree.
export const TEAM_SIZE_MIN = 2;
export const TEAM_SIZE_MAX = 4;
// project_roles_needed.quantity_needed, as create_project() enforces it.
export const ROLE_QUANTITY_MIN = 1;
export const ROLE_QUANTITY_MAX = 3;

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

// --- Projects (issue #23) -------------------------------------------------

export const TITLE_RANGE = `Title must be between ${TITLE_MIN} and ${TITLE_MAX} characters`;
export const DESCRIPTION_RANGE = `Description must be between ${DESCRIPTION_MIN} and ${DESCRIPTION_MAX} characters`;
export const TEAM_SIZE_RANGE = `A team has to be between ${TEAM_SIZE_MIN} and ${TEAM_SIZE_MAX} people`;

// Trim first, then count: "   ab   " is a two-character title, not eight,
// and it is the trimmed value that gets stored.
function checkTitle(raw) {
  const title = String(raw ?? '').trim();
  if (title === '') return { error: 'Give your project a title' };
  const length = charCount(title);
  if (length < TITLE_MIN || length > TITLE_MAX) return { error: TITLE_RANGE };
  return { value: title };
}

function checkDescription(raw) {
  const description = String(raw ?? '').trim();
  if (description === '') return { error: 'Describe what the project is' };
  const length = charCount(description);
  if (length < DESCRIPTION_MIN || length > DESCRIPTION_MAX) return { error: DESCRIPTION_RANGE };
  return { value: description };
}

function checkTeamSize(raw) {
  const text = typeof raw === 'number' ? String(raw) : String(raw ?? '').trim();
  if (text === '') return { error: 'Choose how many people the team should have' };
  if (!/^\d+$/.test(text)) return { error: 'Team size must be a whole number' };
  const size = Number(text);
  if (size < TEAM_SIZE_MIN || size > TEAM_SIZE_MAX) return { error: TEAM_SIZE_RANGE };
  return { value: size };
}

/**
 * The roles a project is recruiting for.
 *
 * Needs the other two numbers to judge: the team size says how many seats
 * exist, and memberCount how many are already taken. On create that is
 * always 1 (you); on edit it is the current roster, which is why lowering
 * the target below it has to be refused.
 */
function checkRolesNeeded(raw, { teamSize, memberCount }) {
  const rows = Array.isArray(raw) ? raw : [];

  const seen = new Set();
  for (const row of rows) {
    if (!row?.role_id) return { error: 'Every role you list needs a role selected' };
    if (seen.has(row.role_id)) return { error: 'You listed the same role twice' };
    seen.add(row.role_id);

    const quantity = Number(row.quantity_needed);
    if (!Number.isInteger(quantity) || quantity < ROLE_QUANTITY_MIN || quantity > ROLE_QUANTITY_MAX) {
      return { error: `Each role needs between ${ROLE_QUANTITY_MIN} and ${ROLE_QUANTITY_MAX} people` };
    }
  }

  // Can't judge the seat count without a valid size; that field reports its
  // own error, and two messages for one mistake is noise.
  if (teamSize == null) return { value: rows };

  const openSeats = teamSize - memberCount;
  const assigned = rows.reduce((sum, row) => sum + (Number(row.quantity_needed) || 0), 0);
  if (assigned > openSeats) {
    return {
      error:
        `A team of ${teamSize} has ${openSeats} open seat${openSeats === 1 ? '' : 's'} ` +
        `besides you, but you listed ${assigned} people`,
    };
  }
  return { value: rows };
}

/**
 * Validates whichever project fields are present in `input`, the same way
 * validateProfile does, so a partial update only checks what it changes.
 *
 * `memberCount` is how many people already hold a seat: 1 when creating,
 * the current roster size when editing.
 */
export function validateProject(input, { memberCount = 1 } = {}) {
  const values = {};
  const errors = {};

  if ('title' in input) {
    const result = checkTitle(input.title);
    if (result.error) errors.title = result.error;
    else values.title = result.value;
  }

  if ('description' in input) {
    const result = checkDescription(input.description);
    if (result.error) errors.description = result.error;
    else values.description = result.value;
  }

  let teamSize = null;
  if ('team_size_target' in input) {
    const result = checkTeamSize(input.team_size_target);
    if (result.error) errors.team_size_target = result.error;
    else {
      values.team_size_target = result.value;
      teamSize = result.value;
    }
  }

  // A size below the people already seated is its own mistake, and a
  // clearer message than the generic range.
  if (teamSize != null && memberCount > 1 && teamSize < memberCount) {
    errors.team_size_target = `${memberCount} people are already on this team, so the target can't be ${teamSize}`;
    teamSize = null;
  }

  if ('own_role_id' in input && !input.own_role_id) {
    errors.own_role_id = 'Choose the role you are taking on';
  }

  if ('roles_needed' in input) {
    const result = checkRolesNeeded(input.roles_needed, { teamSize, memberCount });
    if (result.error) errors.roles_needed = result.error;
    else values.roles_needed = result.value;
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
  projects_title_length_check: ['title', TITLE_RANGE],
  projects_description_length_check: ['description', DESCRIPTION_RANGE],
  projects_team_size_target_check: ['team_size_target', TEAM_SIZE_RANGE],
};

export function fieldErrorsFromDbError(error) {
  if (error?.code !== '23514') return null;
  const text = `${error.message ?? ''} ${error.details ?? ''}`;
  for (const [constraint, [field, message]] of Object.entries(CONSTRAINT_FIELDS)) {
    if (text.includes(constraint)) return { [field]: message };
  }
  return null;
}

// --- Milestones (issue #38) -----------------------------------------------
// Mirrored by milestones_name_length, milestones_message_text and the
// raises in save_milestone() (supabase/26_milestones.sql and
// 28_milestone_messages.sql), which are the real boundary.
export const MILESTONE_NAME_MAX = 80;
export const MILESTONE_MESSAGE_MAX = 1000;
// milestones_due_at_range: a date picker accepts year 1 or 275760.
export const MILESTONE_DUE_MIN = new Date('2000-01-01T00:00:00Z');
export const MILESTONE_DUE_MAX = new Date('2100-01-01T00:00:00Z');

// Built from code points so the characters stay visible in this file.
const span = (from, to) => `${String.fromCodePoint(from)}-${String.fromCodePoint(to)}`;
// Zero-width characters, bidirectional marks/overrides/isolates, and the
// byte-order mark: they make text read differently from what's stored.
const INVISIBLE = new RegExp(
  `[${span(0x200b, 0x200f)}${span(0x202a, 0x202e)}${span(0x2060, 0x2069)}${String.fromCodePoint(0xfeff)}]`,
  'u'
);
// Control characters other than tab and line feed.
const CONTROL = /[\x00-\x08\x0B-\x1F\x7F]/;
const HAS_WORDS = /[\p{L}\p{N}]/u;
const TWO_BLANK_LINES = /\n[ \t]*\n[ \t]*\n/;

// The message an admin writes for a milestone: optional, but when there is
// one it has to read like a message. Windows line endings become plain
// ones and whitespace at either end is dropped, as save_milestone() does.
function checkMilestoneMessage(raw) {
  const message = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t\n]+|[ \t\n]+$/g, '');
  if (message === '') return { value: '' };
  if (charCount(message) > MILESTONE_MESSAGE_MAX) {
    return { error: `Keep the message to ${MILESTONE_MESSAGE_MAX} characters or fewer` };
  }
  if (CONTROL.test(message) || INVISIBLE.test(message)) {
    return { error: "The message can't contain hidden or control characters" };
  }
  if (!HAS_WORDS.test(message)) return { error: 'The message has to include letters or numbers' };
  if (TWO_BLANK_LINES.test(message)) return { error: 'Leave at most one blank line in a row' };
  return { value: message };
}

// `due_at` is whatever the form holds — a datetime-local string such as
// "2026-11-01T23:59", read as the viewer's local time — or an ISO string.
// The cleaned value is an ISO timestamp, ready to send.
export function validateMilestone({ name, due_at, message }) {
  const errors = {};
  const values = {};

  const trimmed = String(name ?? '').trim();
  if (trimmed === '') errors.name = 'Give the milestone a name';
  else if (charCount(trimmed) > MILESTONE_NAME_MAX) {
    errors.name = `Keep the name to ${MILESTONE_NAME_MAX} characters or fewer`;
  } else if (/[\x00-\x1F\x7F]/.test(trimmed) || INVISIBLE.test(trimmed)) {
    errors.name = "The name can't contain line breaks, hidden or control characters";
  } else if (!HAS_WORDS.test(trimmed)) {
    errors.name = 'The name has to include letters or numbers';
  } else values.name = trimmed;

  const when = due_at ? new Date(due_at) : null;
  if (!when || Number.isNaN(when.getTime())) errors.due_at = 'Pick a due date and time';
  else if (when < MILESTONE_DUE_MIN || when >= MILESTONE_DUE_MAX) {
    errors.due_at = 'Pick a due date between 2000 and 2099';
  } else values.due_at = when.toISOString();

  const checked = checkMilestoneMessage(message);
  if (checked.error) errors.message = checked.error;
  else values.message = checked.value;

  return { values, errors, isValid: Object.keys(errors).length === 0 };
}
