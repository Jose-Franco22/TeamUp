// How close a deadline is, in words (issues #22 and #38).
//
// Two formatters live here on purpose, side by side, because they answer
// different questions and would give wrong answers if merged:
//
// - relativeDue() counts calendar days for the schedule on the Announcements
//   page: at 11pm, something due at 8am is "tomorrow". It works in both
//   directions ("in 5 days", "3 days ago") and gets coarser with distance.
// - formatCountdown() counts time left for the banner's countdown: at 11pm,
//   the same deadline is "9 hours" away. It only looks forward, drops to
//   hours inside the last day, and anything past is simply "Closed".
//
// They share the unit constants and nothing else.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// The banner switches to its warning style this close to the next deadline.
export const DUE_SOON_MS = 48 * HOUR;

const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'}`;

// "4 days", "1 day", "5 hours", "less than an hour", or "Closed". Rounds
// down, so "1 day" always means at least a full day is left.
export function formatCountdown(iso, now = new Date()) {
  const left = new Date(iso) - now;
  if (left <= 0) return 'Closed';
  if (left < HOUR) return 'less than an hour';
  if (left < DAY) return plural(Math.floor(left / HOUR), 'hour');
  return plural(Math.floor(left / DAY), 'day');
}

// The soonest milestone that hasn't passed yet, or null. Doesn't rely on the
// list being sorted.
export function nextDeadline(milestones, now = new Date()) {
  let next = null;
  for (const m of milestones ?? []) {
    const due = new Date(m.due_at);
    if (due > now && (!next || due < new Date(next.due_at))) next = m;
  }
  return next;
}

// Still open, and DUE_SOON_MS or less to go.
export function isDueSoon(iso, now = new Date()) {
  const left = new Date(iso) - now;
  return left > 0 && left <= DUE_SOON_MS;
}

// "today", "tomorrow", "in 5 days", "in 3 weeks", "in 4 months", "3 days
// ago" — next to the full date, so the exact one is always there too.
export function relativeDue(iso, now = new Date()) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date(iso)) - startOf(now)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const n = Math.abs(days);
  const span =
    n < 14 ? `${n} days`
    : n < 60 ? `${Math.round(n / 7)} weeks`
    : n < 365 ? `${Math.round(n / 30)} months`
    : `${Math.round(n / 365)} year${Math.round(n / 365) === 1 ? '' : 's'}`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}
