// Issues #26 and #21 — which notifications are emailed, to whom, and what
// the email says. Run with `node --test supabase/functions/*/*.test.js`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ESSENTIAL_KINDS, composeEmail, formatDeadline, shouldEmail } from './email.js';

const appUrl = 'https://teamup.example.app';
const base = { actorName: 'Ana Villarreal', projectTitle: 'Campus parking tracker', appUrl };

describe('subject, text and link for each kind', () => {
  const cases = [
    ['join_request', 'Ana Villarreal asked to join Campus parking tracker', /Ana Villarreal asked to join “Campus parking tracker”/, '/requests'],
    ['request_accepted', "You're on the team for Campus parking tracker", /request to join “Campus parking tracker” was accepted/, '/team'],
    ['request_declined', 'Your request to join Campus parking tracker was declined', /was declined/, '/browse'],
    ['team_complete', 'Campus parking tracker is complete', /Every seat on “Campus parking tracker” is filled/, '/team'],
  ];
  for (const [kind, subject, line, path] of cases) {
    test(kind, () => {
      const email = composeEmail({ ...base, kind });
      assert.equal(email.subject, subject);
      assert.match(email.text, line);
      assert.match(email.html, line);
      assert.ok(email.text.endsWith(`${appUrl}${path}\n`), `text links to ${path}`);
      assert.match(email.html, new RegExp(`<a href="${appUrl.replace(/\./g, '\\.')}${path}">`));
    });
  }

  test('deadline_reminder names the deadline in Central time and links to Browse', () => {
    const email = composeEmail({ kind: 'deadline_reminder', appUrl, deadline: '2026-11-15T05:59:00Z' });
    assert.equal(email.subject, 'Reminder: teams lock Saturday, November 14 at 11:59 PM CST');
    assert.match(email.text, /not on a full team yet/);
    assert.ok(email.text.endsWith(`${appUrl}/browse\n`));
  });

  test('deadline_reminder still reads without a date', () => {
    const email = composeEmail({ kind: 'deadline_reminder', appUrl });
    assert.equal(email.subject, 'Reminder: the team formation deadline is coming up');
  });

  test('announcement carries its title and body and links to Announcements', () => {
    const email = composeEmail({
      kind: 'announcement',
      appUrl,
      announcement: { title: 'Demo day moved', body: 'Now on Friday.\nRoom 2.101.' },
    });
    assert.equal(email.subject, 'TeamUp announcement: Demo day moved');
    assert.match(email.text, /Demo day moved\n\nNow on Friday\.\nRoom 2\.101\./);
    assert.match(email.html, /<strong>Demo day moved<\/strong>/);
    assert.match(email.html, /Now on Friday\.<br>Room 2\.101\./);
    assert.ok(email.text.endsWith(`${appUrl}/announcements\n`));
  });
});

test('a trailing slash on the app URL does not double up', () => {
  const email = composeEmail({ ...base, kind: 'join_request', appUrl: `${appUrl}/` });
  assert.ok(email.text.endsWith(`${appUrl}/requests\n`));
});

test('names, titles and announcement text are escaped in the HTML', () => {
  const email = composeEmail({ ...base, kind: 'join_request', actorName: '<b>Eve</b>', projectTitle: 'Tom & Jerry' });
  assert.match(email.html, /&lt;b&gt;Eve&lt;\/b&gt; asked to join “Tom &amp; Jerry”/);
  assert.doesNotMatch(email.html, /<b>/);

  const a = composeEmail({ kind: 'announcement', appUrl, announcement: { title: '<script>x</script>', body: '<img src=x>' } });
  assert.doesNotMatch(a.html, /<script>|<img/);
});

test('kinds the issue does not list are not emailed', () => {
  for (const kind of ['member_left', 'member_removed', 'member_added', 'member_assigned', 'project_removed', 'nonsense']) {
    assert.equal(composeEmail({ ...base, kind }), null, kind);
    assert.equal(shouldEmail({ kind, emailNotifications: true }), false, kind);
  }
});

describe('the profile preference', () => {
  const optional = ['join_request', 'request_accepted', 'request_declined', 'team_complete'];

  test('non-essential kinds go out by default and when switched on', () => {
    for (const kind of optional) {
      assert.equal(shouldEmail({ kind, emailNotifications: true }), true, kind);
      assert.equal(shouldEmail({ kind, emailNotifications: undefined }), true, kind);
    }
  });

  test('non-essential kinds are skipped for a student who opted out', () => {
    for (const kind of optional) assert.equal(shouldEmail({ kind, emailNotifications: false }), false, kind);
  });

  test('deadline reminders and announcements are sent even when opted out', () => {
    assert.deepEqual([...ESSENTIAL_KINDS].sort(), ['announcement', 'deadline_reminder']);
    for (const kind of ESSENTIAL_KINDS) assert.equal(shouldEmail({ kind, emailNotifications: false }), true, kind);
  });
});

test('formatDeadline rejects nonsense', () => {
  assert.equal(formatDeadline('not a date'), null);
});
