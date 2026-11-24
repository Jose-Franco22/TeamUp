// The adviser dashboard (issue #56): which advised teams need attention, and
// the order the cards go in. The facts come from adviser_dashboard()
// (supabase/47_adviser_dashboard.sql); the rules are here, in one place.

const DAY_MS = 24 * 60 * 60 * 1000;

// A team is quiet when nobody has checked in for this long.
export const QUIET_DAYS = 7;

// Why a team needs attention, in the order the card lists them. Each is a
// flag the issue names: an overdue or sent-back deliverable, an open
// blocker, or no check-ins in the past week.
export const ATTENTION = {
  overdue: 'Deliverable overdue',
  changes_requested: 'Changes requested',
  blocker: 'Open blocker',
  quiet: `No check-ins in ${QUIET_DAYS} days`,
};

// Whole days from `iso` to `now`, or null when there is no date.
export function daysSince(iso, now = new Date()) {
  if (!iso) return null;
  const ms = new Date(now).getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / DAY_MS));
}

// "No check-ins in the past week" only means something once a team could
// have posted for a week: check-ins open when the team forms (42_), so a team
// that is still forming, or formed two days ago, isn't flagged for silence.
function isQuiet(team, now) {
  if (!team.formed_at) return false;
  if (daysSince(team.formed_at, now) < QUIET_DAYS) return false;
  const since = daysSince(team.last_check_in_at, now);
  return since === null || since >= QUIET_DAYS;
}

// The keys of ATTENTION that apply to this team; empty for a healthy one.
export function attentionReasons(team, now = new Date()) {
  const reasons = [];
  if (team.overdue_deliverables > 0) reasons.push('overdue');
  if (team.changes_requested > 0) reasons.push('changes_requested');
  if (team.open_blockers > 0) reasons.push('blocker');
  if (isQuiet(team, now)) reasons.push('quiet');
  return reasons;
}

export function needsAttention(team, now = new Date()) {
  return attentionReasons(team, now).length > 0;
}

const dueTime = (team) =>
  team.next_milestone_due_at ? new Date(team.next_milestone_due_at).getTime() : Infinity;

// Flagged teams first; within each group, the soonest next due date first
// (a team with nothing coming up goes last), then by name so the order is
// stable. Returns a new array.
export function sortAdvisedTeams(teams, now = new Date()) {
  return [...teams].sort((a, b) => {
    const flagged = Number(needsAttention(b, now)) - Number(needsAttention(a, now));
    if (flagged) return flagged;
    const due = dueTime(a) - dueTime(b);
    if (due) return due;
    return String(a.title ?? '').localeCompare(String(b.title ?? ''));
  });
}
