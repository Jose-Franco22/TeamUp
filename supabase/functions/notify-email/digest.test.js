// Issue #59 — the weekly adviser digest email, rendered from mocked
// adviser_digests data. Run with `node --test supabase/functions/*/*.test.js`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeDigest, dashboardPath, hadActivity, sortTeams, teamPath } from './digest.js';

const appUrl = 'https://teamup.example.app/';
const app = 'https://teamup.example.app';

const team = (over) => ({
  team_id: 't-0',
  project_title: 'Untitled',
  flagged: false,
  checkins_submitted: null,
  checkins_expected: null,
  blockers: [],
  deliverables_to_review: null,
  last_commit_at: null,
  ...over,
});

// A busy week, as it'll look once #55–#58 fill in their figures.
const busy = {
  week_start: '2026-11-09',
  week_end: '2026-11-15',
  due_this_week: [{ name: 'Demo day', due_at: '2026-11-18T18:00:00Z' }],
  teams: [
    team({ team_id: 't-alpha', project_title: 'Alpha', checkins_submitted: 4, checkins_expected: 4, last_commit_at: '2026-11-14T20:00:00Z' }),
    team({
      team_id: 't-zulu',
      project_title: 'Zulu',
      flagged: true,
      checkins_submitted: 3,
      checkins_expected: 4,
      blockers: ['Waiting on API keys', 'Need a <db> host'],
      deliverables_to_review: 2,
    }),
    team({ team_id: 't-bravo', project_title: 'Bravo', deliverables_to_review: 1 }),
  ],
};

// What the shell actually sends today: nothing tracked yet.
const quiet = {
  week_start: '2026-11-09',
  week_end: '2026-11-15',
  due_this_week: [],
  teams: [team({ team_id: 't-b', project_title: 'Bravo' }), team({ team_id: 't-a', project_title: 'Alpha' })],
};

describe('team order', () => {
  test('flagged teams come first, then by title', () => {
    assert.deepEqual(
      sortTeams(busy.teams).map((t) => t.project_title),
      ['Zulu', 'Alpha', 'Bravo']
    );
  });

  test('sections in the email follow that order', () => {
    const { text, html } = composeDigest({ data: busy, appUrl });
    const order = (s) => ['Zulu', 'Alpha', 'Bravo'].map((t) => s.indexOf(t));
    for (const s of [text, html]) {
      const [z, a, b] = order(s);
      assert.ok(z < a && a < b, 'Zulu, then Alpha, then Bravo');
    }
  });
});

describe('a busy week', () => {
  const { subject, text, html } = composeDigest({ data: busy, appUrl, adviserName: 'Dr. Enriquez' });

  test('subject names the week', () => {
    assert.equal(subject, 'Your TeamUp teams: week of Nov 9');
  });

  test('greets the adviser and names the range', () => {
    assert.match(text, /^Hi Dr\. Enriquez,/);
    assert.match(text, /the 3 teams you advise did Nov 9 – Nov 15/);
  });

  test('shows check-ins, blockers, deliverables and last commit', () => {
    assert.match(text, /Check-ins last week: 3 of 4/);
    assert.match(text, /Open blockers:\n {4}- Waiting on API keys\n {4}- Need a <db> host/);
    assert.match(text, /2 deliverables waiting for your review/);
    assert.match(text, /1 deliverable waiting for your review/);
    assert.match(text, /Last commit: Sat, Nov 14 at 2:00 PM/);
  });

  test('marks the flagged team', () => {
    assert.match(text, /^Zulu \(needs attention\)$/m);
    assert.match(html, /Zulu <span[^>]*>needs attention<\/span>/);
    assert.doesNotMatch(text, /Alpha \(needs attention\)/);
  });

  test('lists what is due this week, in Central time', () => {
    assert.match(text, /Due this week:\n {2}- Demo day: Wed, Nov 18 at 12:00 PM/);
  });

  test('does not say the week was quiet', () => {
    assert.doesNotMatch(text, /had any activity/);
  });

  test('escapes what teams typed', () => {
    assert.match(html, /Need a &lt;db&gt; host/);
    assert.doesNotMatch(html, /<db>/);
  });
});

describe('links', () => {
  // Paths are written out literally, not built from teamPath()/dashboardPath(),
  // so changing either function has to change a test too.
  const student = composeDigest({ data: busy, appUrl });
  const admin = composeDigest({ data: { ...busy, adviser_is_admin: true }, appUrl });

  test('a student adviser is sent to /team, where their advised teams are', () => {
    assert.equal(teamPath('t-alpha'), '/team');
    assert.equal(dashboardPath(), '/team');
    assert.ok(student.text.includes(`Open the team: ${app}/team\n`));
    assert.ok(student.html.includes(`<a href="${app}/team">Open the team</a>`));
    assert.ok(student.text.includes(`All your teams: ${app}/team\n`));
    assert.doesNotMatch(student.text, /\/admin/, 'never an admin-only link');
    assert.doesNotMatch(student.html, /\/admin/, 'never an admin-only link');
  });

  test('an admin adviser gets each team\'s admin page and the admin dashboard', () => {
    for (const id of ['t-alpha', 't-zulu', 't-bravo']) {
      const link = `${app}/admin/teams/${id}`;
      assert.ok(admin.text.includes(`Open the team: ${link}`), `text links to ${id}`);
      assert.ok(admin.html.includes(`<a href="${link}">Open the team</a>`), `html links to ${id}`);
    }
    assert.ok(admin.text.includes(`All your teams: ${app}/admin\n`));
    assert.ok(admin.html.includes(`<a href="${app}/admin">`));
  });

  test('only a literal true makes the links admin ones', () => {
    const odd = composeDigest({ data: { ...busy, adviser_is_admin: 'true' }, appUrl });
    assert.doesNotMatch(odd.text, /\/admin/);
  });

  test('team ids are encoded in admin links', () => {
    assert.equal(teamPath('a/b?c', { admin: true }), '/admin/teams/a%2Fb%3Fc');
  });

  test('says how to turn it off', () => {
    assert.match(student.text, /turn off this weekly digest on your TeamUp profile/);
    assert.match(student.html, /turn off this weekly digest on your profile/);
  });
});

describe('a quiet week', () => {
  const { text, html } = composeDigest({ data: quiet, appUrl });

  test('says so in one line instead of being skipped', () => {
    assert.match(text, /None of your teams had any activity last week\./);
    assert.match(html, /None of your teams had any activity last week\./);
  });

  test('still lists and links every team', () => {
    assert.equal(text.split(`Open the team: ${app}/team\n`).length - 1, 2);
    assert.ok(text.indexOf('Alpha') < text.indexOf('Bravo'));
  });

  test('leaves out figures that are not tracked yet rather than showing zeros', () => {
    assert.doesNotMatch(text, /Check-ins|blocker|deliverable|Last commit/);
  });

  test('a single team reads naturally', () => {
    const one = composeDigest({ data: { ...quiet, teams: [quiet.teams[0]] }, appUrl });
    assert.match(one.text, /the team you advise did/);
  });
});

describe('hadActivity', () => {
  test('nothing tracked is quiet', () => assert.equal(hadActivity(team(), '2026-11-09'), false));
  test('zero check-ins is quiet', () =>
    assert.equal(hadActivity(team({ checkins_submitted: 0, checkins_expected: 4 }), '2026-11-09'), false));
  test('a check-in is activity', () => assert.equal(hadActivity(team({ checkins_submitted: 1 }), '2026-11-09'), true));
  test('a blocker is activity', () => assert.equal(hadActivity(team({ blockers: ['x'] }), '2026-11-09'), true));
  test('a deliverable is activity', () =>
    assert.equal(hadActivity(team({ deliverables_to_review: 1 }), '2026-11-09'), true));
  test('a commit in the week is activity', () =>
    assert.equal(hadActivity(team({ last_commit_at: '2026-11-12T10:00:00Z' }), '2026-11-09'), true));
  test('an older commit is not', () =>
    assert.equal(hadActivity(team({ last_commit_at: '2026-11-01T10:00:00Z' }), '2026-11-09'), false));
});

// A mixed week: one team busy, one with nothing. The quiet line is for when
// *no* team did anything, so it must not appear, and the busy team's figures
// must not be hidden. Both other fixtures are uniformly busy or idle, so they
// can't tell `every` from `some`.
describe('a mixed week', () => {
  const mixed = {
    ...quiet,
    teams: [team({ team_id: 't-a', project_title: 'Alpha', checkins_submitted: 2, checkins_expected: 4 }), team({ team_id: 't-b', project_title: 'Bravo' })],
  };
  const { text } = composeDigest({ data: mixed, appUrl });

  test('does not call the week quiet', () => assert.doesNotMatch(text, /had any activity/));
  test('shows the busy team\'s figures', () => assert.match(text, /Check-ins last week: 2 of 4/));
});

// Everything a student or the class calendar can put in the email is escaped,
// not only blockers.
describe('escaping', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const { html } = composeDigest({
    data: {
      ...busy,
      due_this_week: [{ name: evil, due_at: '2026-11-18T18:00:00Z' }],
      teams: [team({ team_id: '"><script>x</script>', project_title: evil, checkins_submitted: 1, checkins_expected: 2 })],
      adviser_is_admin: true,
    },
    appUrl,
    adviserName: evil,
  });

  test('no raw tag survives', () => {
    assert.doesNotMatch(html, /<img/);
    assert.doesNotMatch(html, /<script/);
  });
  test('the project title is escaped', () => assert.match(html, /<h3[^>]*>&lt;img src=x onerror=alert\(1\)&gt;/));
  test('the milestone name is escaped', () => assert.match(html, /<li>&lt;img src=x onerror=alert\(1\)&gt;: /));
  test('the greeting is escaped', () => assert.match(html, /<p>Hi &lt;img/));
  test('the team id in a link is encoded', () => assert.match(html, /\/admin\/teams\/%22%3E%3Cscript%3E/));
});

// pg_cron isn't in the test database or CI, so the pgTAP check of the job
// passes trivially. Pin the schedule here instead: 13:00 UTC alone would mean
// no digest from November to March, since 13:00 UTC is 7 AM CST.
describe('the schedule in 38_adviser_digest.sql', () => {
  const sql = readFileSync(new URL('../../38_adviser_digest.sql', import.meta.url), 'utf8');

  test('runs Mondays at both 13:00 and 14:00 UTC', () => {
    assert.match(sql, /cron\.schedule\(\s*'adviser-digest',\s*'0 13,14 \* \* 1',\s*'select private\.send_adviser_digests\(\)'/);
  });
  test('the job only lets through 8 AM Central on a Monday', () => {
    assert.match(sql, /extract\(isodow from v_local\) <> 1 or extract\(hour from v_local\) <> 8/);
  });
});
