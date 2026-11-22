// Reading a GitHub repo URL, and matching commits back to the team (#58).
//
// Three rules live in this file, and all three are mirrored elsewhere:
//
//   - What counts as a repo URL. Mirrored by projects_github_repo_format_check
//     and the raise in set_project_repo() (supabase/42_github_activity.sql),
//     which is the real boundary — anyone signed in can call Supabase
//     directly and skip this file.
//   - What the stored value looks like. Exactly CANONICAL_REPO_PATTERN, which
//     is the pattern the CHECK constraint uses. There is a test asserting that
//     everything parseRepoUrl() accepts comes back matching it, because the
//     Edge Function splits the stored value with a *strict* reader and would
//     break on anything else.
//   - Which commit belongs to whom. A login matches the member whose profile
//     github_url names them (11_profile_validation.sql already constrains that
//     column to a one-segment profile link, which is why pulling the login
//     back out of it is safe).
//
// The lenient parsing happens once, here, at the door. Everything downstream
// — the database, the Edge Function — reads the canonical form only. That is
// deliberate: 11_profile_validation.sql warns what happens when the same
// pattern is written out twice and the copies drift.

// How far back the activity table looks. The Edge Function windows the data
// (supabase/functions/github-activity/activity.js owns the real constant);
// this copy is for the wording on screen, and a test asserts they agree.
export const WINDOW_DAYS = 14;

// GitHub's own limits: an owner is 1–39 of letters, digits and hyphens; a
// repository name is 1–100 of those plus dots and underscores.
const OWNER = '[A-Za-z0-9-]{1,39}';
const REPO = '[A-Za-z0-9._-]{1,100}';

// The stored form, and the only form anything downstream reads.
export const CANONICAL_REPO_PATTERN = new RegExp(`^https://github\\.com/${OWNER}/${REPO}$`);

/**
 * Whether a URL is the exact form the database stores and the Edge Function
 * reads. The shape, plus the two things the character class alone allows:
 *
 *   - a name that is only dots, which would make the Edge Function's
 *     /repos/<owner>/<repo>/commits climb out of the repository;
 *   - a name ending in .git, which GitHub itself refuses — so one arriving
 *     here means the suffix was not stripped, and the repository it names
 *     cannot exist.
 *
 * All three clauses are mirrored by projects_github_repo_format_check and by
 * splitRepo() in supabase/functions/github-activity/activity.js.
 */
export function isCanonicalRepoUrl(url) {
  const text = String(url ?? '');
  return CANONICAL_REPO_PATTERN.test(text) && !/\/\.+$/.test(text) && !/\.git$/i.test(text);
}

// A GitHub profile link, as users_github_url_format_check constrains it:
// one username segment, optional www., optional trailing slash.
const PROFILE_URL = new RegExp(`^https://(?:www\\.)?github\\.com/(${OWNER})/?$`, 'i');

// Everything a paste can plausibly carry in front of "owner/repo":
// the scheme (or none), www., and the SSH form's "git@github.com:".
const PREFIX = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|git@github\.com:)/i;

export const REPO_URL_HINT = 'Use the repository link, like https://github.com/owner/repo';

// A name that is only dots is a path, not a repository: GitHub refuses both
// "." and "..", and a stored ".." would make the Edge Function's URL climb
// out of the repository it was given.
const DOTS_ONLY = /^\.+$/;

/**
 * Reads whatever somebody pasted into the box.
 *
 * Accepts the half-dozen shapes a repo link actually arrives in — with or
 * without the scheme, with www., the `.git` suffix the green Code button
 * hands out, a trailing slash, or the SSH remote — and returns the canonical
 * https form. Anything else gets a sentence saying what was wanted.
 *
 * Returns { owner, repo, url } or { error }.
 */
export function parseRepoUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { error: 'Paste your repository link' };

  // Refused before the prefix is stripped, so "github.com/a/b?x=1" is a
  // clear "that isn't a repo link" rather than a repo called "b?x=1".
  if (/\s/.test(text)) return { error: 'A repository link has no spaces in it' };
  if (/[?#]/.test(text)) {
    return { error: 'Leave off anything after the repository name — just the owner and the repo' };
  }

  if (!PREFIX.test(text)) {
    // Named hosts get their own message: a GitLab URL is a different mistake
    // from a typo, and "use a GitHub link" is the useful thing to say.
    if (/^(?:https?:\/\/)?(?:www\.)?(?:gitlab\.com|bitbucket\.org)\//i.test(text)) {
      return { error: 'TeamUp reads GitHub repositories. ' + REPO_URL_HINT };
    }
    return { error: REPO_URL_HINT };
  }

  // Strip the prefix, the .git suffix and a trailing slash — in that order,
  // so "…/repo.git/" is read the same as "…/repo".
  const path = text
    .replace(PREFIX, '')
    .replace(/\/$/, '')
    .replace(/\.git$/i, '');

  const segments = path.split('/');
  if (segments.length < 2 || segments.some((s) => s === '')) {
    // One segment is the commonest wrong paste by a mile: it's the profile
    // link, which is a real thing they own, just not the thing being asked
    // for. Worth its own sentence.
    return {
      error:
        segments.length === 1 && segments[0] !== ''
          ? 'That is a profile link, not a repository. ' + REPO_URL_HINT
          : REPO_URL_HINT,
    };
  }
  if (segments.length > 2) {
    return { error: 'Link the repository itself, not a page inside it. ' + REPO_URL_HINT };
  }

  const [owner, repo] = segments;
  if (!new RegExp(`^${OWNER}$`).test(owner) || !new RegExp(`^${REPO}$`).test(repo)) {
    return { error: REPO_URL_HINT };
  }
  if (DOTS_ONLY.test(repo)) return { error: REPO_URL_HINT };
  // One .git is stripped above; a name that still ends in one ("repo.git.git")
  // is not a repository GitHub would allow, and letting it through would put
  // a value downstream that splitRepo() refuses. Anything this function
  // accepts has to satisfy isCanonicalRepoUrl(), and there is a test for it.
  if (/\.git$/i.test(repo)) return { error: REPO_URL_HINT };

  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

/**
 * The username out of a TeamUp profile's github_url, or null.
 *
 * Only the profile shape is accepted. A repo URL in that column would mean
 * users_github_url_format_check had been dropped, and guessing the owner out
 * of it would silently credit one student with another's commits.
 */
export function loginFromProfileUrl(url) {
  const match = PROFILE_URL.exec(String(url ?? '').trim());
  return match ? match[1] : null;
}

/**
 * The member a GitHub login belongs to, or null.
 *
 * Case-insensitive, because GitHub logins are: a student who typed
 * github.com/GoldNicolas still owns commits authored as "goldnicolas".
 *
 * An empty login never matches. That is not a quirk of the data — GitHub
 * leaves `author` null on commits whose email it can't tie to an account,
 * and those are exactly the ones that must stay unattributed.
 */
export function matchContributor(login, members) {
  const wanted = String(login ?? '').trim().toLowerCase();
  if (wanted === '') return null;
  return (
    (members || []).find((m) => loginFromProfileUrl(m?.github_url)?.toLowerCase() === wanted) ??
    null
  );
}

/**
 * The activity table, as the page draws it.
 *
 * Every member gets a row, including the ones with nothing in the window —
 * a zero is information, and leaving them out would read as "not on the
 * team". Contributors that match nobody are kept, below the members, so a
 * commit is never silently dropped from the totals.
 *
 * `contributors` is what the cache holds: one row per GitHub login, as
 * supabase/functions/github-activity/activity.js aggregates it.
 */
export function activityRows(contributors, members) {
  const rows = [];
  const claimed = new Set();

  for (const member of members || []) {
    const login = loginFromProfileUrl(member.github_url);
    const found = login
      ? (contributors || []).find(
          (c) => String(c.login ?? '').toLowerCase() === login.toLowerCase()
        )
      : null;
    if (found) claimed.add(found);
    rows.push({
      user_id: member.user_id,
      name: member.name,
      login,
      // A member with no GitHub URL on their profile has no counts at all,
      // rather than zeroes: zeroes would read as "wrote nothing this week",
      // and the honest answer is "we can't tell yet".
      linked: Boolean(login),
      commits: found?.commits ?? 0,
      pull_requests: found?.pull_requests ?? 0,
      last_commit_at: found?.last_commit_at ?? null,
      unlinked: false,
    });
  }

  for (const contributor of contributors || []) {
    if (claimed.has(contributor)) continue;
    rows.push({
      user_id: null,
      // The login if GitHub gave one, otherwise the name off the commit —
      // which is all there is for a commit from an unrecognised email.
      name: contributor.login || contributor.name || 'Unknown',
      login: contributor.login ?? null,
      linked: false,
      commits: contributor.commits ?? 0,
      pull_requests: contributor.pull_requests ?? 0,
      last_commit_at: contributor.last_commit_at ?? null,
      unlinked: true,
    });
  }

  return rows;
}

// The members who still need to add their GitHub URL, in roster order. The
// page prompts them; the counts can't include them until they do.
export function membersMissingLink(members) {
  return (members || []).filter((m) => !loginFromProfileUrl(m?.github_url));
}

// --- what to say when there is no answer ---------------------------------
//
// One sentence per reason, written for a student rather than a log, the same
// way lib/matching/judge.js writes the judge's failures. The difference is
// what is still on screen underneath: the judge always has a point score to
// fall back on, and here there may be nothing but the link — so each of
// these has to say what happened *and* what to do about it, or the page is
// just a shrug.
//
// The reason codes come from three places and are deliberately one list:
// collectActivity() in the Edge Function's activity.js (and the
// repo_activity_error_known constraint, which is the same list), the
// function's own shell (signed_out, no_repo, not_on_team, not_configured,
// timeout, bad_request), and this file's own 'unavailable' for a function
// that has not been deployed.
export const ACTIVITY_MESSAGES = {
  // GitHub answers 404 for a repository that does not exist *and* for a
  // private one it will not confirm exists, so this one sentence has to
  // serve both. Issue #58 asks for the private case to explain itself, and
  // this is where that lives.
  not_found:
    'We can’t see that repository. If it’s private, add the TeamUp GitHub account as a ' +
    'read-only collaborator (Settings → Collaborators → Add people), or check the link above.',
  forbidden:
    'GitHub refused the request for this repository. If it’s private, it needs TeamUp added ' +
    'as a read-only collaborator.',
  rate_limited: 'GitHub is rate-limiting us right now — this will catch up within the hour.',
  bad_token: 'TeamUp’s GitHub access needs renewing. Tell your instructor; nothing is wrong with your repo.',
  bad_repo: 'That link isn’t a repository we can read. Change it above.',
  unreachable: 'Couldn’t reach GitHub just now. The counts below are the last ones we have.',
  upstream_error: 'GitHub had a problem answering. The counts below are the last ones we have.',
  timeout: 'GitHub took too long to answer. The counts below are the last ones we have.',
  no_repo: 'No repository is linked yet.',
  not_on_team: 'Only this team can refresh its activity.',
  no_project: 'That project no longer exists.',
  refused: 'TeamUp couldn’t check this repository just now.',
  signed_out: 'Sign in again to refresh the activity.',
  not_configured: 'Repository activity isn’t set up on the server yet.',
  unavailable: 'Repository activity isn’t available in this build yet.',
  bad_request: 'TeamUp couldn’t ask about this repository.',
};

export const activityMessage = (reason) =>
  ACTIVITY_MESSAGES[reason] ?? ACTIVITY_MESSAGES.upstream_error;

/**
 * How old the numbers are, in words: "just now", "6 minutes ago",
 * "2 hours ago", or a date once it is past a day.
 *
 * Its own function rather than lib/deadlines.js's relativeDue(), which
 * counts calendar days and would call everything here "today". The cache
 * window is fifteen minutes, so minutes are the unit that matters: "updated
 * 2 minutes ago" is the difference between trusting the table and pressing
 * refresh.
 */
export function refreshedLabel(iso, now = new Date()) {
  if (!iso) return 'never';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'never';

  const minutes = Math.floor((new Date(now).getTime() - then.getTime()) / 60000);
  // A clock disagreeing with the server's by a few seconds should read as
  // now, not as the future.
  if (minutes < 1) return 'just now';
  if (minutes === 1) return 'a minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return 'an hour ago';
  if (hours < 24) return `${hours} hours ago`;
  return `on ${then.toLocaleDateString()}`;
}
