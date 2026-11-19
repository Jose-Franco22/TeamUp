// Issue #58 — reading a repo URL, and matching commits to members.
//
// The rejections come first, because that is where the bugs were in every
// issue before this one. Two of them are not typos but security properties:
// a host that merely *contains* github.com, and a stored ".." that would let
// the Edge Function's URL climb out of the repository it was handed.
import { describe, expect, test } from 'vitest';
import {
  ACTIVITY_MESSAGES,
  CANONICAL_REPO_PATTERN,
  WINDOW_DAYS,
  activityMessage,
  activityRows,
  isCanonicalRepoUrl,
  loginFromProfileUrl,
  matchContributor,
  membersMissingLink,
  parseRepoUrl,
  refreshedLabel,
} from './github';
import { WINDOW_DAYS as FUNCTION_WINDOW_DAYS } from '../../../supabase/functions/github-activity/activity.js';

const CANONICAL = 'https://github.com/Jose-Franco22/TeamUp';

describe('parseRepoUrl accepts', () => {
  // Each of these is a real way the link arrives: the address bar, the green
  // Code button, a copied cell with a slash on the end, the SSH remote.
  test.each([
    ['the plain https URL', CANONICAL],
    ['a trailing slash', 'https://github.com/Jose-Franco22/TeamUp/'],
    ['the .git the Code button gives you', 'https://github.com/Jose-Franco22/TeamUp.git'],
    ['both at once', 'https://github.com/Jose-Franco22/TeamUp.git/'],
    ['no scheme at all', 'github.com/Jose-Franco22/TeamUp'],
    ['http, which we store as https', 'http://github.com/Jose-Franco22/TeamUp'],
    ['www.', 'https://www.github.com/Jose-Franco22/TeamUp'],
    ['a shouted host', 'HTTPS://GITHUB.COM/Jose-Franco22/TeamUp'],
    ['the SSH remote', 'git@github.com:Jose-Franco22/TeamUp.git'],
    ['whitespace around it', '  https://github.com/Jose-Franco22/TeamUp  '],
  ])('%s', (_label, input) => {
    expect(parseRepoUrl(input)).toEqual({
      owner: 'Jose-Franco22',
      repo: 'TeamUp',
      url: CANONICAL,
    });
  });

  // The host is case-insensitive; the owner and repo are not ours to
  // change. GitHub resolves either, but the link on the page should read
  // the way the team writes it.
  test('and keeps the case of the owner and repo', () => {
    expect(parseRepoUrl('github.com/GoldNicolas/My.Repo_v2-final').url).toBe(
      'https://github.com/GoldNicolas/My.Repo_v2-final'
    );
  });

  test('dots, underscores and hyphens are all legal in a repo name', () => {
    expect(parseRepoUrl('github.com/a/.dotfiles').repo).toBe('.dotfiles');
    expect(parseRepoUrl('github.com/a/b_c-d.e').repo).toBe('b_c-d.e');
  });

  // .git is stripped from the end only. A repository really can be called
  // "foo.github.io", and one called ".gitignore-templates" is legal too.
  test('.git is a suffix, not a substring', () => {
    expect(parseRepoUrl('github.com/a/foo.github.io').repo).toBe('foo.github.io');
    expect(parseRepoUrl('github.com/a/.gitignore-templates').repo).toBe('.gitignore-templates');
  });
});

describe('parseRepoUrl refuses', () => {
  const error = (input) => parseRepoUrl(input).error;

  test('nothing at all', () => {
    expect(error('')).toMatch(/Paste your repository link/);
    expect(error('   ')).toMatch(/Paste your repository link/);
    expect(error(null)).toMatch(/Paste your repository link/);
    expect(error(undefined)).toMatch(/Paste your repository link/);
  });

  // THE SECURITY ONE. A substring check would accept every one of these and
  // send our token to someone else's server.
  test.each([
    'https://github.com.evil.example/Jose-Franco22/TeamUp',
    'https://evil.example/github.com/Jose-Franco22/TeamUp',
    'https://notgithub.com/Jose-Franco22/TeamUp',
    'https://github.example.com/Jose-Franco22/TeamUp',
    'git@evil.example:Jose-Franco22/TeamUp.git',
  ])('a host that only looks like GitHub: %s', (input) => {
    expect(error(input)).toBeTruthy();
    expect(parseRepoUrl(input).url).toBeUndefined();
  });

  test('another host we recognise, by name', () => {
    expect(error('https://gitlab.com/group/project')).toMatch(/TeamUp reads GitHub/);
    expect(error('https://bitbucket.org/team/project')).toMatch(/TeamUp reads GitHub/);
  });

  // The commonest wrong paste: the thing already on their profile.
  test('a profile link, and says so', () => {
    expect(error('https://github.com/GoldNicolas')).toMatch(/profile link, not a repository/);
    expect(error('github.com/GoldNicolas/')).toMatch(/profile link, not a repository/);
  });

  test('a page inside a repo, and says so', () => {
    expect(error('https://github.com/a/b/tree/main')).toMatch(/not a page inside it/);
    expect(error('https://github.com/a/b/pull/58')).toMatch(/not a page inside it/);
    expect(error('https://github.com/a/b/blob/main/README.md')).toMatch(/not a page inside it/);
  });

  test('anything trailing a query or a fragment', () => {
    expect(error('https://github.com/a/b?tab=readme-ov-file')).toMatch(/Leave off anything after/);
    expect(error('https://github.com/a/b#install')).toMatch(/Leave off anything after/);
  });

  test('spaces inside', () => {
    expect(error('https://github.com/my org/my repo')).toMatch(/no spaces/);
    expect(error('github.com/a/b c')).toMatch(/no spaces/);
  });

  // THE OTHER SECURITY ONE. The Edge Function builds
  // api.github.com/repos/<owner>/<repo>/commits from the stored value; a
  // repo of ".." would walk it up to a different endpoint entirely.
  test('a name that is only dots', () => {
    expect(error('github.com/a/..')).toBeTruthy();
    expect(error('github.com/a/.')).toBeTruthy();
    expect(error('github.com/a/...')).toBeTruthy();
  });

  test('an empty segment', () => {
    expect(error('github.com//TeamUp')).toBeTruthy();
    expect(error('github.com/a//')).toBeTruthy();
  });

  test('an owner or repo past what GitHub allows', () => {
    expect(error(`github.com/${'a'.repeat(40)}/b`)).toBeTruthy();
    expect(error(`github.com/a/${'b'.repeat(101)}`)).toBeTruthy();
    // The boundary itself is fine.
    expect(parseRepoUrl(`github.com/${'a'.repeat(39)}/${'b'.repeat(100)}`).error).toBeUndefined();
  });

  test('characters neither an owner nor a repo may contain', () => {
    expect(error('github.com/a~b/c')).toBeTruthy();
    expect(error('github.com/a/b!c')).toBeTruthy();
    expect(error('github.com/a/b%2Fc')).toBeTruthy();
    expect(error('github.com/ünicode/repo')).toBeTruthy();
  });
});

// The mirror-drift guard. The database CHECK and the Edge Function's strict
// reader both assume the stored value is canonical; if parseRepoUrl ever
// accepts something outside that, this fails here rather than in production.
//
// This caught a real one: `a/b.git` satisfies the shape, because a dot is a
// legal character in a repo name — but GitHub refuses a name ending in .git,
// so splitRepo() refuses it, and parseRepoUrl now does too.
test('everything parseRepoUrl accepts is in the canonical form', () => {
  const accepted = [
    CANONICAL,
    'github.com/a/b',
    'http://www.github.com/a/b.git/',
    'git@github.com:a/b.git',
    `github.com/${'a'.repeat(39)}/${'b'.repeat(100)}`,
    'github.com/a/.dotfiles',
    'github.com/a/foo.github.io',
  ];
  for (const input of accepted) {
    const { url, error } = parseRepoUrl(input);
    expect(error, input).toBeUndefined();
    expect(url, input).toMatch(CANONICAL_REPO_PATTERN);
    expect(isCanonicalRepoUrl(url), input).toBe(true);
  }
});

test('a name that still ends in .git after stripping is refused', () => {
  // GitHub allows no repository called this, and splitRepo() in the Edge
  // Function would refuse the stored value.
  expect(parseRepoUrl('github.com/a/b.git.git').error).toBeTruthy();
  expect(isCanonicalRepoUrl('https://github.com/a/b.git')).toBe(false);
});

describe('isCanonicalRepoUrl', () => {
  test('accepts the stored form', () => {
    expect(isCanonicalRepoUrl(CANONICAL)).toBe(true);
  });

  test('and refuses everything the character class alone would allow', () => {
    expect(isCanonicalRepoUrl('https://github.com/a/..')).toBe(false);
    expect(isCanonicalRepoUrl('https://github.com/a/.')).toBe(false);
    expect(isCanonicalRepoUrl('https://github.com/a/b.git')).toBe(false);
    expect(isCanonicalRepoUrl('https://github.com/a/b/')).toBe(false);
    expect(isCanonicalRepoUrl('http://github.com/a/b')).toBe(false);
    expect(isCanonicalRepoUrl('')).toBe(false);
    expect(isCanonicalRepoUrl(null)).toBe(false);
  });
});

test('the window is the same number the Edge Function uses', () => {
  expect(WINDOW_DAYS).toBe(FUNCTION_WINDOW_DAYS);
});

// --- matching a login to a member ----------------------------------------

describe('loginFromProfileUrl', () => {
  test('reads the username out of a profile link', () => {
    expect(loginFromProfileUrl('https://github.com/GoldNicolas')).toBe('GoldNicolas');
    expect(loginFromProfileUrl('https://github.com/GoldNicolas/')).toBe('GoldNicolas');
    expect(loginFromProfileUrl('https://www.github.com/GoldNicolas')).toBe('GoldNicolas');
  });

  test('and refuses anything that is not one', () => {
    // A repo URL in that column would mean the profile constraint was gone.
    // Guessing "a" out of it would credit one student with another's work.
    expect(loginFromProfileUrl('https://github.com/a/b')).toBeNull();
    expect(loginFromProfileUrl('')).toBeNull();
    expect(loginFromProfileUrl(null)).toBeNull();
    expect(loginFromProfileUrl('https://gitlab.com/someone')).toBeNull();
  });
});

const MEMBERS = [
  { user_id: 'u-nicolas', name: 'Nicolas Guerra', github_url: 'https://github.com/GoldNicolas' },
  { user_id: 'u-jose', name: 'Jose Franco Garza', github_url: 'https://github.com/Jose-Franco22/' },
  { user_id: 'u-sofia', name: 'Sofia Ramirez', github_url: '' },
];

describe('matchContributor', () => {
  test('finds the member whose profile names that login', () => {
    expect(matchContributor('GoldNicolas', MEMBERS).user_id).toBe('u-nicolas');
    expect(matchContributor('Jose-Franco22', MEMBERS).user_id).toBe('u-jose');
  });

  // GitHub logins are case-insensitive, and the commit author's capitals
  // need not match what the student typed into their profile.
  test('ignoring case on both sides', () => {
    expect(matchContributor('goldnicolas', MEMBERS).user_id).toBe('u-nicolas');
    expect(matchContributor('GOLDNICOLAS', MEMBERS).user_id).toBe('u-nicolas');
  });

  test('and nobody when there is nobody', () => {
    expect(matchContributor('dependabot', MEMBERS)).toBeNull();
    expect(matchContributor('', MEMBERS)).toBeNull();
    expect(matchContributor(null, MEMBERS)).toBeNull();
    expect(matchContributor('GoldNicolas', [])).toBeNull();
    expect(matchContributor('GoldNicolas', null)).toBeNull();
  });

  // A member with no URL must never be matched by accident — an empty
  // github_url against an empty login is the one that would have.
  test('a member with no GitHub URL matches no login, not even an empty one', () => {
    expect(matchContributor('', [MEMBERS[2]])).toBeNull();
    expect(matchContributor('Sofia', [MEMBERS[2]])).toBeNull();
  });
});

// --- the table the page draws --------------------------------------------

const CONTRIBUTORS = [
  { login: 'GoldNicolas', commits: 12, pull_requests: 3, last_commit_at: '2026-11-18T10:00:00Z' },
  { login: 'dependabot[bot]', commits: 4, pull_requests: 4, last_commit_at: '2026-11-17T01:00:00Z' },
  { login: null, name: 'someone@utrgv.edu', commits: 2, pull_requests: 0, last_commit_at: '2026-11-16T09:00:00Z' },
];

describe('activityRows', () => {
  const rows = () => activityRows(CONTRIBUTORS, MEMBERS);

  test('gives every member a row, in roster order', () => {
    expect(rows().slice(0, 3).map((r) => r.user_id)).toEqual(['u-nicolas', 'u-jose', 'u-sofia']);
  });

  test('with the counts of whoever matched', () => {
    expect(rows()[0]).toMatchObject({ commits: 12, pull_requests: 3, linked: true, unlinked: false });
  });

  // A zero is an answer: "on the team, nothing in the window".
  test('a linked member with nothing in the window counts zero, not nothing', () => {
    expect(rows()[1]).toMatchObject({ user_id: 'u-jose', linked: true, commits: 0, pull_requests: 0 });
    expect(rows()[1].last_commit_at).toBeNull();
  });

  // And a missing link is a different answer: "we can't tell".
  test('a member with no GitHub URL is marked unlinked rather than zeroed', () => {
    expect(rows()[2]).toMatchObject({ user_id: 'u-sofia', linked: false, commits: 0 });
    expect(rows()[2].login).toBeNull();
  });

  test('contributors who match nobody come last, and are kept', () => {
    const extra = rows().filter((r) => r.unlinked);
    expect(extra.map((r) => r.name)).toEqual(['dependabot[bot]', 'someone@utrgv.edu']);
    expect(extra.every((r) => r.user_id === null)).toBe(true);
  });

  // The reason the unmatched rows are kept at all: the totals on the page
  // have to add up to what the repository actually holds.
  test('so no commit is dropped from the total', () => {
    const total = rows().reduce((sum, r) => sum + r.commits, 0);
    const fromGitHub = CONTRIBUTORS.reduce((sum, c) => sum + c.commits, 0);
    expect(total).toBe(fromGitHub);
  });

  test('a repo nobody has touched still lists the team', () => {
    expect(activityRows([], MEMBERS)).toHaveLength(3);
    expect(activityRows([], MEMBERS).every((r) => r.commits === 0)).toBe(true);
  });

  test('and no roster at all is not a crash', () => {
    expect(activityRows(CONTRIBUTORS, []).every((r) => r.unlinked)).toBe(true);
    expect(activityRows(null, null)).toEqual([]);
    expect(activityRows(undefined, undefined)).toEqual([]);
  });

  // Two members cannot both claim one contributor row: the profile URL
  // constraint makes duplicates unlikely, but "unlikely" is not "cannot",
  // and double-counting would be invisible on screen.
  test('one contributor is claimed once, even if two profiles name them', () => {
    const twins = [
      MEMBERS[0],
      { user_id: 'u-twin', name: 'Twin', github_url: 'https://github.com/goldnicolas' },
    ];
    const out = activityRows([CONTRIBUTORS[0]], twins);
    expect(out.map((r) => r.commits)).toEqual([12, 12]);
    // Claimed, so it is not also appended as an unlinked row.
    expect(out.filter((r) => r.unlinked)).toHaveLength(0);
  });
});

// --- the wording for a missing answer ------------------------------------

describe('activityMessage', () => {
  // THE CRITERION: "for private repos the page explains how to give access".
  // GitHub answers 404 for a private repository as well as a missing one —
  // it will not confirm that a private repo exists — so this one sentence
  // carries both readings, and has to name the fix.
  test('a repo we cannot see explains how to grant access', () => {
    expect(activityMessage('not_found')).toMatch(/read-only collaborator/);
    expect(activityMessage('not_found')).toMatch(/private/);
    expect(activityMessage('forbidden')).toMatch(/read-only collaborator/);
  });

  test('a rate limit says it will pass', () => {
    expect(activityMessage('rate_limited')).toMatch(/within the hour/);
  });

  // Not the team's problem to fix, and saying so stops them digging through
  // their repository settings for an hour.
  test('our own expired token does not send the team looking at their repo', () => {
    expect(activityMessage('bad_token')).toMatch(/nothing is wrong with your repo/);
  });

  test('every reason the pieces can produce has a sentence', () => {
    // activity.js's reasons, the Edge Function shell's, and this file's own.
    const reasons = [
      // activity.js: reasonForStatus() and collectActivity()
      'not_found', 'forbidden', 'rate_limited', 'bad_token', 'bad_repo',
      'unreachable', 'upstream_error',
      // index.ts: the shell's own refusals, plus its timeout
      'signed_out', 'not_on_team', 'no_repo', 'no_project', 'refused',
      'not_configured', 'bad_request', 'timeout',
      // client.js: the function is not reachable in this build at all
      'unavailable',
    ];
    for (const reason of reasons) {
      expect(ACTIVITY_MESSAGES[reason], reason).toBeTruthy();
    }
  });

  test('and an unknown one still says something rather than nothing', () => {
    expect(activityMessage('something_new')).toBe(ACTIVITY_MESSAGES.upstream_error);
    expect(activityMessage(undefined)).toBeTruthy();
  });
});

describe('refreshedLabel', () => {
  const now = new Date('2026-11-19T12:00:00Z');
  const ago = (minutes) => new Date(now.getTime() - minutes * 60000).toISOString();

  test('counts in minutes, because the cache window is fifteen of them', () => {
    expect(refreshedLabel(ago(0), now)).toBe('just now');
    expect(refreshedLabel(ago(1), now)).toBe('a minute ago');
    expect(refreshedLabel(ago(6), now)).toBe('6 minutes ago');
    expect(refreshedLabel(ago(59), now)).toBe('59 minutes ago');
  });

  test('then hours, then a date', () => {
    expect(refreshedLabel(ago(60), now)).toBe('an hour ago');
    expect(refreshedLabel(ago(150), now)).toBe('2 hours ago');
    expect(refreshedLabel(ago(60 * 24), now)).toMatch(/^on /);
  });

  // A browser clock a few seconds ahead of the server's should not produce
  // "in 0 minutes" or a negative count.
  test('a timestamp from the near future reads as now', () => {
    expect(refreshedLabel(new Date(now.getTime() + 20000).toISOString(), now)).toBe('just now');
  });

  test('and nothing at all is "never", not a crash', () => {
    expect(refreshedLabel(null, now)).toBe('never');
    expect(refreshedLabel(undefined, now)).toBe('never');
    expect(refreshedLabel('not a date', now)).toBe('never');
  });
});

describe('membersMissingLink', () => {
  test('is who the page prompts', () => {
    expect(membersMissingLink(MEMBERS).map((m) => m.user_id)).toEqual(['u-sofia']);
  });

  test('a profile holding something that is not a profile link counts as missing', () => {
    const odd = [{ user_id: 'u-x', name: 'X', github_url: 'https://github.com/a/b' }];
    expect(membersMissingLink(odd)).toHaveLength(1);
  });

  test('nobody missing is an empty list', () => {
    expect(membersMissingLink(MEMBERS.slice(0, 2))).toEqual([]);
    expect(membersMissingLink([])).toEqual([]);
    expect(membersMissingLink(null)).toEqual([]);
  });
});
