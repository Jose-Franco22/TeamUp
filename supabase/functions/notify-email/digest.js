// The weekly adviser digest (issue #59), rendered from one
// public.adviser_digests row's data (supabase/38_adviser_digest.sql has its
// shape). Like email.js, no Deno or network code, so digest.test.js runs it
// under `node --test`; index.ts reads the row and sends.
//
// A figure that's null or missing isn't tracked yet (check-ins #55,
// deliverables #57, commits #58): its line is left out rather than shown as
// zero. As those stories fill the data in, their lines appear with no change
// here.

const TZ = 'America/Chicago';

// The adviser's view of a team, and their dashboard. The Advising dashboard
// (#56) doesn't exist yet; until it does, the admin dashboard is where an
// adviser sees their teams. Change DASHBOARD_PATH when #56 lands.
export const teamPath = (teamId) => `/admin/teams/${encodeURIComponent(teamId)}`;
export const DASHBOARD_PATH = '/admin';

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const base = (appUrl) => String(appUrl).replace(/\/+$/, '');

// "2026-11-09" -> "Nov 9". Dates without a time are calendar days, so
// they're read as UTC to keep the day from shifting.
function shortDay(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return String(isoDate);
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(d);
}

// A timestamp in Central, e.g. "Wed, Nov 18 at 12:00 PM".
function when(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
  return `${day} at ${time}`;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Flagged teams first (#56's rules decide which), then by title.
export function sortTeams(teams = []) {
  return [...teams].sort(
    (a, b) =>
      Number(Boolean(b.flagged)) - Number(Boolean(a.flagged)) ||
      String(a.project_title ?? '').localeCompare(String(b.project_title ?? ''))
  );
}

// Anything happened on this team during the week the digest covers.
export function hadActivity(team, weekStart) {
  if (isNum(team.checkins_submitted) && team.checkins_submitted > 0) return true;
  if (Array.isArray(team.blockers) && team.blockers.length > 0) return true;
  if (isNum(team.deliverables_to_review) && team.deliverables_to_review > 0) return true;
  if (team.last_commit_at && weekStart) {
    const commit = new Date(team.last_commit_at);
    const start = new Date(`${weekStart}T00:00:00Z`);
    // Roughly the week's start in Central; a commit late on the Sunday
    // before is close enough to count as quiet.
    if (!Number.isNaN(commit.getTime()) && commit >= start) return true;
  }
  return false;
}

// The lines under one team's heading, as [text, html] pairs.
function teamLines(team) {
  const lines = [];
  if (isNum(team.checkins_submitted) && isNum(team.checkins_expected)) {
    const s = `Check-ins last week: ${team.checkins_submitted} of ${team.checkins_expected}`;
    lines.push([s, escapeHtml(s)]);
  }
  if (Array.isArray(team.blockers) && team.blockers.length) {
    const label = team.blockers.length === 1 ? 'Open blocker' : 'Open blockers';
    lines.push([
      `${label}:\n${team.blockers.map((b) => `    - ${b}`).join('\n')}`,
      `${label}:<ul>${team.blockers.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`,
    ]);
  }
  if (isNum(team.deliverables_to_review) && team.deliverables_to_review > 0) {
    const n = team.deliverables_to_review;
    const s = `${n} deliverable${n === 1 ? '' : 's'} waiting for your review`;
    lines.push([s, escapeHtml(s)]);
  }
  if (team.last_commit_at) {
    const s = `Last commit: ${when(team.last_commit_at)}`;
    lines.push([s, escapeHtml(s)]);
  }
  return lines;
}

// Returns { subject, text, html } for one adviser's digest.
//   data         the adviser_digests row's data
//   appUrl       where the app is hosted
//   adviserName  for the greeting; optional
export function composeDigest({ data, appUrl, adviserName }) {
  const app = base(appUrl);
  const weekStart = data?.week_start;
  const weekEnd = data?.week_end;
  const teams = sortTeams(data?.teams ?? []);
  const due = Array.isArray(data?.due_this_week) ? data.due_this_week : [];
  const quiet = teams.every((t) => !hadActivity(t, weekStart));
  const dashboard = `${app}${DASHBOARD_PATH}`;

  const range = weekStart && weekEnd ? `${shortDay(weekStart)} – ${shortDay(weekEnd)}` : 'last week';
  const subject = `Your TeamUp teams: week of ${weekStart ? shortDay(weekStart) : 'last week'}`;
  const hello = adviserName ? `Hi ${adviserName},` : 'Hi,';
  const intro = `Here's how the ${teams.length === 1 ? 'team' : `${teams.length} teams`} you advise did ${range}.`;

  const text = [hello, '', intro, ''];
  const html = [`<p>${escapeHtml(hello)}</p>`, `<p>${escapeHtml(intro)}</p>`];

  if (quiet) {
    const s = 'None of your teams had any activity last week.';
    text.push(s, '');
    html.push(`<p><strong>${escapeHtml(s)}</strong></p>`);
  }

  if (due.length) {
    text.push('Due this week:', ...due.map((m) => `  - ${m.name}: ${when(m.due_at)}`), '');
    html.push(
      '<h3 style="margin-bottom:4px">Due this week</h3>',
      `<ul>${due.map((m) => `<li>${escapeHtml(m.name)}: ${escapeHtml(when(m.due_at))}</li>`).join('')}</ul>`
    );
  }

  for (const team of teams) {
    const title = team.project_title || 'Untitled project';
    const link = `${app}${teamPath(team.team_id)}`;
    const heading = team.flagged ? `${title} (needs attention)` : title;
    const lines = quiet ? [] : teamLines(team);

    text.push(heading, ...lines.map(([t]) => `  ${t}`), `  Open the team: ${link}`, '');
    html.push(
      `<h3 style="margin-bottom:4px">${escapeHtml(title)}` +
        (team.flagged ? ' <span style="color:#b00020;font-size:13px">needs attention</span>' : '') +
        '</h3>',
      lines.length ? `<ul>${lines.map(([, h]) => `<li>${h}</li>`).join('')}</ul>` : '',
      `<p style="margin-top:4px"><a href="${escapeHtml(link)}">Open the team</a></p>`
    );
  }

  text.push(`All your teams: ${dashboard}`, '', 'You can turn off this weekly digest on your TeamUp profile.');
  html.push(
    `<p><a href="${escapeHtml(dashboard)}">See all your teams on TeamUp</a></p>`,
    '<p style="color:#666;font-size:12px">You\'re getting this because you advise teams on TeamUp. ' +
      'You can turn off this weekly digest on your profile.</p>'
  );

  return { subject, text: `${text.join('\n')}\n`, html: html.filter(Boolean).join('') };
}
