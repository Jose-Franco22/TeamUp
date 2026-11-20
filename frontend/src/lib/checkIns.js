// Weekly team check-ins (issue #55): the week arithmetic, the form's rules,
// and how the list is grouped. The database is the real boundary for all of
// it (supabase/41_check_ins.sql); this file is what the form and the list
// show before anything is sent.

import { charCount } from './validation.js';

// Mirrored by check_ins_*_length in 41_check_ins.sql.
export const CHECK_IN_MAX = 500;

// UTRGV's time zone. Weeks run Monday–Sunday here, whatever zone the browser
// is in — a student checking in from a trip still belongs to the class's week.
export const CHECK_IN_TIME_ZONE = 'America/Chicago';

const WEEKDAYS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

const centralParts = new Intl.DateTimeFormat('en-US', {
  timeZone: CHECK_IN_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});

// The Monday (as 'YYYY-MM-DD') of the Central-time week `at` falls in — the
// twin of public.check_in_week_start(). Intl does the time-zone and
// daylight-saving work; the subtraction is on a plain calendar date, so no
// local offset can shift it by a day.
export function weekStart(at = new Date()) {
  const parts = Object.fromEntries(
    centralParts.formatToParts(new Date(at)).map((p) => [p.type, p.value])
  );
  const offset = WEEKDAYS[parts.weekday];
  const monday = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) - offset));
  return monday.toISOString().slice(0, 10);
}

// Another week's Monday, n weeks from this one (negative for earlier).
export function addWeeks(week, n) {
  const d = new Date(`${week}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 7 * n);
  return d.toISOString().slice(0, 10);
}

// "Nov 16 – 22" or "Oct 26 – Nov 1": the Monday to the Sunday.
export function formatWeek(week) {
  const fmt = (d, opts) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...opts }).format(d);
  const start = new Date(`${week}T00:00:00Z`);
  const end = new Date(`${addWeeks(week, 1)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  const sameMonth = start.getUTCMonth() === end.getUTCMonth();
  return `${fmt(start, { month: 'short', day: 'numeric' })} – ${fmt(end, sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`;
}

const FIELDS = {
  did: { label: 'What I did', required: 'Say what you worked on this week' },
  doing_next: { label: "What's next", required: "Say what you're doing next" },
  blockers: { label: 'Anything blocking me', required: null },
};

// { values, errors, isValid }, like the other validate* functions. The first
// two are required; blockers is optional and blank becomes null, as the
// database stores it.
export function validateCheckIn(input) {
  const values = {};
  const errors = {};
  for (const [field, rule] of Object.entries(FIELDS)) {
    const text = String(input?.[field] ?? '').trim();
    if (text === '') {
      if (rule.required) errors[field] = rule.required;
      else values[field] = null;
    } else if (charCount(text) > CHECK_IN_MAX) {
      errors[field] = `Keep it to ${CHECK_IN_MAX} characters or fewer`;
    } else {
      values[field] = text;
    }
  }
  return { values, errors, isValid: Object.keys(errors).length === 0 };
}

export const hasBlocker = (checkIn) => Boolean(checkIn?.blockers && checkIn.blockers.trim());

// Check-ins grouped by week, newest first, each with the members who haven't
// posted that week.
//
// Every week from the team's formation to now gets a group, even an empty
// one: a week nobody checked in is exactly what "who hasn't submitted"
// should show. Missing is measured against today's roster, since that's the
// roster the page has; weeks before the team formed list nobody as missing.
export function groupCheckIns(checkIns, members, { currentWeek = weekStart(), formedAt = null } = {}) {
  const firstWeek = formedAt ? weekStart(formedAt) : currentWeek;
  const weeks = new Set();
  for (let w = currentWeek; w >= firstWeek; w = addWeeks(w, -1)) weeks.add(w);
  for (const c of checkIns) weeks.add(c.week_start);

  return [...weeks]
    .sort((a, b) => b.localeCompare(a))
    .map((week) => {
      const posted = checkIns
        .filter((c) => c.week_start === week)
        .sort((a, b) => String(a.user_name ?? '').localeCompare(String(b.user_name ?? '')));
      const postedBy = new Set(posted.map((c) => c.user_id));
      const missing = week < firstWeek ? [] : members.filter((m) => !postedBy.has(m.user_id));
      return { week, checkIns: posted, missing };
    });
}
