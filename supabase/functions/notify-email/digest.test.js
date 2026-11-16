// Issue #59 — the weekly adviser digest email, rendered from mocked
// adviser_digests data. Run with `node --test supabase/functions/*/*.test.js`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DASHBOARD_PATH, composeDigest, hadActivity, sortTeams, teamPath } from './digest.js';

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
  const { text, html } = composeDigest({ data: busy, appUrl });

  test('each team links to its page', () => {
    for (const id of ['t-alpha', 't-zulu', 't-bravo']) {
      const link = `${app}${teamPath(id)}`;
      assert.equal(link, `${app}/admin/teams/${id}`);
      assert.ok(text.includes(`Open the team: ${link}`), `text links to ${id}`);
      assert.ok(html.includes(`<a href="${link}">Open the team</a>`), `html links to ${id}`);
    }
  });

  test('the email links to the dashboard', () => {
    assert.ok(text.includes(`All your teams: ${app}${DASHBOARD_PATH}`));
    assert.ok(html.includes(`<a href="${app}${DASHBOARD_PATH}">`));
  });

  test('says how to turn it off', () => {
    assert.match(text, /turn off this weekly digest on your TeamUp profile/);
    assert.match(html, /turn off this weekly digest on your profile/);
  });
});

describe('a quiet week', () => {
  const { text, html } = composeDigest({ data: quiet, appUrl });

  test('says so in one line instead of being skipped', () => {
    assert.match(text, /None of your teams had any activity last week\./);
    assert.match(html, /None of your teams had any activity last week\./);
  });

  test('still lists and links every team', () => {
    assert.ok(text.includes(`Open the team: ${app}/admin/teams/t-a`));
    assert.ok(text.includes(`Open the team: ${app}/admin/teams/t-b`));
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
