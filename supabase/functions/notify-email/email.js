// What the notify-email function sends and to whom, kept free of Deno and
// network code so `node --test` can check it (email.test.js). index.ts does
// the I/O; send.js does the sending and retrying.

// The page each emailed kind opens, matching the bell's links
// (frontend/src/components/NotificationBell.jsx). A kind missing here is not
// emailed at all — it still shows in the bell. Issue #21 lists which ones
// matter enough for email.
const PAGES = {
  join_request: '/requests',
  request_accepted: '/team',
  request_declined: '/browse',
  team_complete: '/team',
  // Written by the reminder job (#43). Students it goes to aren't on a full
  // team yet, so Browse is where they'd act on it.
  deadline_reminder: '/browse',
  // Not a notifications row: one per admin announcement, sent to everyone.
  announcement: '/announcements',
};

// Sent even to students who turned emails off on their profile (#21).
export const ESSENTIAL_KINDS = new Set(['deadline_reminder', 'announcement']);

export const isEmailedKind = (kind) => Object.hasOwn(PAGES, kind);

// emailNotifications is users.email_notifications for the recipient (true
// unless they turned it off).
export function shouldEmail({ kind, emailNotifications }) {
  if (!isEmailedKind(kind)) return false;
  return ESSENTIAL_KINDS.has(kind) || emailNotifications !== false;
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const linkFor = (kind, appUrl) => `${String(appUrl).replace(/\/+$/, '')}${PAGES[kind]}`;

// The deadline in the class's time zone (UTRGV is on Central time), e.g.
// "Friday, November 14 at 11:59 PM CST".
export function formatDeadline(dueAt) {
  const d = new Date(dueAt);
  if (Number.isNaN(d.getTime())) return null;
  const tz = 'America/Chicago';
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
  return `${day} at ${time}`;
}

// One line of text and its HTML twin, plus a call to action, wrapped the same
// way for every kind.
function build({ subject, line, lineHtml, cta, link, extraText = '', extraHtml = '' }) {
  return {
    subject,
    text: `${line}\n${extraText}\n${cta}: ${link}\n`,
    html:
      `<p>${lineHtml ?? escapeHtml(line)}</p>${extraHtml}` +
      `<p><a href="${escapeHtml(link)}">${escapeHtml(cta)}</a></p>` +
      `<p style="color:#666;font-size:12px">You're getting this because you use TeamUp. ` +
      `You can turn off non-essential emails on your profile.</p>`,
  };
}

// Returns { subject, text, html }, or null for a kind that isn't emailed.
//   kind          the notification's kind, or 'announcement'
//   actorName     who caused it
//   projectTitle  the project it's about
//   appUrl        where the app is hosted, e.g. https://teamup.example.app
//   deadline      the formation deadline's due_at, for 'deadline_reminder'
//   announcement  { title, body }, for 'announcement'
export function composeEmail({ kind, actorName, projectTitle, appUrl, deadline, announcement }) {
  if (!isEmailedKind(kind)) return null;

  const who = actorName || 'Someone';
  const project = projectTitle || 'your project';
  const quoted = `“${project}”`;
  const link = linkFor(kind, appUrl);

  switch (kind) {
    case 'join_request':
      return build({
        subject: `${who} asked to join ${project}`,
        line: `${who} asked to join ${quoted} on TeamUp.`,
        cta: 'Review the request on your Requests page',
        link,
      });
    case 'request_accepted':
      return build({
        subject: `You're on the team for ${project}`,
        line: `Your request to join ${quoted} was accepted.`,
        cta: 'Meet your team',
        link,
      });
    case 'request_declined':
      return build({
        subject: `Your request to join ${project} was declined`,
        line: `Your request to join ${quoted} was declined. Other teams are still looking.`,
        cta: 'Browse open projects',
        link,
      });
    case 'team_complete':
      return build({
        subject: `${project} is complete`,
        line: `Every seat on ${quoted} is filled. Your team's next steps are ready.`,
        cta: "See your team's next steps",
        link,
      });
    case 'deadline_reminder': {
      const when = deadline ? formatDeadline(deadline) : null;
      return build({
        subject: when ? `Reminder: teams lock ${when}` : 'Reminder: the team formation deadline is coming up',
        line: when
          ? `The team formation deadline is ${when}, and you're not on a full team yet.`
          : `The team formation deadline is coming up, and you're not on a full team yet.`,
        cta: 'Find a team on TeamUp',
        link,
      });
    }
    case 'announcement': {
      const title = announcement?.title || 'New announcement';
      const body = announcement?.body || '';
      return build({
        subject: `TeamUp announcement: ${title}`,
        line: title,
        lineHtml: `<strong>${escapeHtml(title)}</strong>`,
        extraText: body ? `\n${body}\n` : '',
        extraHtml: body ? `<p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>` : '',
        cta: 'Read it on TeamUp',
        link,
      });
    }
    default:
      return null;
  }
}
