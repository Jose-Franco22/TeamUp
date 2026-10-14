// What the notify-email function sends, kept free of Deno and network code
// so `node --test` can check it (email.test.js). index.ts does the I/O.

// The page each kind of notification opens — the same one the app links to
// (frontend/src/components/RequestAlerts.jsx for 'join_request').
const PAGES = { join_request: '/requests' };

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// kind: the notification's kind. actorName: who caused it. projectTitle: the
// project it's about. appUrl: where the app is hosted, e.g.
// https://teamup.example.app. Returns { subject, text, html }, or null for a
// kind that isn't emailed (only 'join_request' is, today).
export function composeEmail({ kind, actorName, projectTitle, appUrl }) {
  if (kind !== 'join_request') return null;

  const who = actorName || 'Someone';
  const project = projectTitle || 'your project';
  const link = `${String(appUrl).replace(/\/+$/, '')}${PAGES[kind]}`;

  return {
    subject: `${who} asked to join ${project}`,
    text: `${who} asked to join “${project}” on TeamUp.\n\nReview the request: ${link}\n`,
    html:
      `<p>${escapeHtml(who)} asked to join “${escapeHtml(project)}” on TeamUp.</p>` +
      `<p><a href="${escapeHtml(link)}">Review the request on your Requests page</a></p>`,
  };
}
