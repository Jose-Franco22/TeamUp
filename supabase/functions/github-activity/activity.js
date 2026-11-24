// What the github-activity function actually does, with nothing Deno in it
// (issue #58).
//
// index.ts is the shell: it checks who is calling, asks the database for the
// repo, and hands the writing back to Postgres. Everything that could be
// wrong about the *answer* — which commits are in the window, who wrote
// them, whether GitHub said no, whether we may skip the call entirely — is
// here, because CI runs this file under `node --test` and cannot run index.ts
// at all (.github/workflows/tests.yml: `node --test supabase/functions/*/*.test.js`).
//
// Two things this file is careful about:
//
//   1. **The token never appears in anything returned or thrown.** It goes in
//      a header, and failures report a short reason code, never the request.
//      fit-review/index.ts has the same rule for GEMINI_API_KEY.
//   2. **GitHub's rate limit is a shared resource.** 5,000 requests an hour
//      for the whole course, so the cache is not a nicety: the window below
//      is what stops thirty teams refreshing a page from spending it in an
//      afternoon. Every failure path also writes a timestamp, so a repo that
//      is 404ing is asked about once every fifteen minutes, not once a click.

// The window the team sees: "the last 14 days", as issue #58 asks for.
export const WINDOW_DAYS = 14;

// How long a fetched answer is reused. The issue asks for "at least 15
// minutes"; this is exactly that, and the arithmetic lives in isFresh().
export const CACHE_MINUTES = 15;

// At 100 per page this is 300 commits and 300 pull requests in a fortnight,
// which no senior project team will reach. Capped rather than followed to
// the end so one busy repository cannot spend the whole course's rate limit
// in a single call.
export const MAX_PAGES = 3;
const PER_PAGE = 100;

const API = 'https://api.github.com';

// Mirrors CANONICAL_REPO_PATTERN in frontend/src/lib/github.js, and
// projects_github_repo_format_check in supabase/45_github_activity.sql.
//
// Strict on purpose. The lenient reading of whatever somebody pasted happens
// once, in the browser, and set_project_repo() stores only the canonical
// form — so anything arriving here in another shape means a rule upstream
// has gone, and the right response is to refuse rather than to guess. A
// guess would build a URL out of an unvalidated string.
const CANONICAL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})$/;

/** { owner, repo } out of the stored URL, or null if it isn't canonical. */
export function splitRepo(stored) {
  const match = CANONICAL.exec(String(stored ?? '').trim());
  if (!match) return null;
  // "." and ".." pass the character class and would walk the API path.
  if (/^\.+$/.test(match[2])) return null;
  // GitHub itself refuses a repository name ending in .git, and the browser
  // strips that suffix before storing — so a stored one means the stripping
  // upstream failed, and the repository it names cannot exist. Refusing is
  // the honest answer; asking GitHub about it would 404 and be recorded as
  // "can't access this repo", which would send the team looking at their
  // repository's permissions for a problem that is in their URL.
  if (/\.git$/i.test(match[2])) return null;
  return { owner: match[1], repo: match[2] };
}

/** Whether a cached row may be used without calling GitHub again. */
export function isFresh(fetchedAt, now = new Date(), minutes = CACHE_MINUTES) {
  if (!fetchedAt) return false;
  const age = new Date(now).getTime() - new Date(fetchedAt).getTime();
  // NaN (an unparseable timestamp) fails both comparisons, which is the
  // answer we want: fetch again rather than trust it.
  if (Number.isNaN(age)) return false;
  // A timestamp in the future is a clock disagreeing with itself, not a
  // fresh row. Refetching is the safe reading.
  return age >= 0 && age < minutes * 60 * 1000;
}

const iso = (date) => new Date(date).toISOString();

/** The start of the window, as GitHub's `since` wants it. */
export function windowStart(now = new Date(), days = WINDOW_DAYS) {
  return iso(new Date(new Date(now).getTime() - days * 24 * 60 * 60 * 1000));
}

/**
 * One row per contributor, out of GitHub's commit and pull request lists.
 *
 * Keyed by login where GitHub has one. Where it does not — a commit whose
 * author email belongs to no account, which is the normal result of
 * committing from a machine that was never configured — the row keeps the
 * name off the commit itself and a null login, and the page shows it as an
 * unlinked contributor. Those commits are never silently dropped: the team's
 * total has to match what the repository holds.
 */
export function summarize({ commits = [], pulls = [], now = new Date(), windowDays = WINDOW_DAYS } = {}) {
  const after = new Date(windowStart(now, windowDays)).getTime();
  const byKey = new Map();

  const row = (key, login, name) => {
    if (!byKey.has(key)) {
      byKey.set(key, { login, name, commits: 0, pull_requests: 0, last_commit_at: null });
    }
    return byKey.get(key);
  };

  for (const commit of commits) {
    const when = commit?.commit?.author?.date ?? commit?.commit?.committer?.date ?? null;
    const at = when ? new Date(when).getTime() : NaN;
    // `since` already filters server-side; this is the second check, because
    // a cached or replayed response is not ours to trust, and a commit with
    // an unparseable date is not evidence of anything.
    if (Number.isNaN(at) || at < after) continue;

    const login = commit?.author?.login ?? null;
    const name = commit?.commit?.author?.name ?? null;
    // No login and no name is still a commit, and still belongs in the
    // total — grouped under one row rather than one row each.
    const entry = row(login ? `login:${login.toLowerCase()}` : `name:${name ?? ''}`, login, name);
    entry.commits += 1;
    if (!entry.last_commit_at || new Date(when) > new Date(entry.last_commit_at)) {
      entry.last_commit_at = iso(when);
    }
  }

  for (const pull of pulls) {
    const at = pull?.created_at ? new Date(pull.created_at).getTime() : NaN;
    if (Number.isNaN(at) || at < after) continue;
    const login = pull?.user?.login ?? null;
    if (!login) continue; // a pull request always has an account behind it
    row(`login:${login.toLowerCase()}`, login, null).pull_requests += 1;
  }

  const contributors = [...byKey.values()].sort(
    (a, b) =>
      b.commits - a.commits ||
      b.pull_requests - a.pull_requests ||
      String(a.login ?? a.name ?? '').localeCompare(String(b.login ?? b.name ?? ''))
  );

  const last = contributors
    .map((c) => c.last_commit_at)
    .filter(Boolean)
    .sort()
    .pop();

  return { contributors, last_commit_at: last ?? null };
}

// What a GitHub status means for us. 404 covers both a repository that does
// not exist and a private one our token cannot see — GitHub deliberately
// does not distinguish them, so neither can we, and the page says "can't
// access this repo" and explains how to grant access.
function reasonForStatus(status, headers) {
  if (status === 404) return 'not_found';
  if (status === 409) return 'empty_repo';
  if (status === 401) return 'bad_token';
  if (status === 403 || status === 429) {
    const left = headers?.get?.('x-ratelimit-remaining');
    return left === '0' ? 'rate_limited' : 'forbidden';
  }
  return 'upstream_error';
}

async function fetchPages({ path, token, fetchImpl, signal }) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=${PER_PAGE}&page=${page}`;
    const response = await fetchImpl(url, {
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // A token is optional: public repositories work without one, at 60
        // requests an hour for the whole function. With one it is 5,000.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        // GitHub refuses requests with no User-Agent. Deliberately generic:
        // nothing about the course, the team or the student goes to GitHub.
        'User-Agent': 'teamup-activity',
      },
    });

    if (!response.ok) {
      return { error: reasonForStatus(response.status, response.headers) };
    }
    const body = await response.json();
    if (!Array.isArray(body)) return { error: 'upstream_error' };
    out.push(...body);
    // A short page is the last page.
    if (body.length < PER_PAGE) break;
  }
  return { items: out };
}

/**
 * Asks GitHub about one repository.
 *
 * Returns { ok: true, contributors, last_commit_at } or
 * { ok: false, reason } with one of the codes in reasonForStatus() —
 * 'empty_repo' being the one that is not really a failure: a repository with
 * no commits yet is the normal state of a team that has just linked one, and
 * it reports as an empty window rather than an error.
 */
export async function collectActivity({
  repo,
  token = null,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  signal,
  windowDays = WINDOW_DAYS,
} = {}) {
  const parts = splitRepo(repo);
  if (!parts) return { ok: false, reason: 'bad_repo' };

  const since = windowStart(now, windowDays);
  const base = `/repos/${parts.owner}/${parts.repo}`;

  let commits;
  try {
    commits = await fetchPages({
      path: `${base}/commits?since=${encodeURIComponent(since)}`,
      token,
      fetchImpl,
      signal,
    });
  } catch {
    // Nothing of the request is reported: an error message from fetch can
    // quote the URL, and the Authorization header must never ride along.
    return { ok: false, reason: 'unreachable' };
  }
  if (commits.error === 'empty_repo') {
    return { ok: true, contributors: [], last_commit_at: null };
  }
  if (commits.error) return { ok: false, reason: commits.error };

  let pulls;
  try {
    pulls = await fetchPages({
      path: `${base}/pulls?state=all&sort=created&direction=desc`,
      token,
      fetchImpl,
      signal,
    });
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  // Commits already worked, so a failure here is partial rather than total:
  // report the commits and no pull requests instead of nothing at all.
  const pullItems = pulls.error ? [] : pulls.items;

  return {
    ok: true,
    ...summarize({ commits: commits.items, pulls: pullItems, now, windowDays }),
    partial: Boolean(pulls.error) || undefined,
  };
}

/**
 * The read-through cache, which is the whole point of the function.
 *
 * `store` is { read(), write(row) } — Postgres in index.ts, a plain object in
 * the tests. Returns { row, cached } so the caller can say how old the
 * answer is.
 *
 * Three things decide whether GitHub is called:
 *   - the row's age, against CACHE_MINUTES;
 *   - whether the cached row is even about the repo we were asked about (an
 *     owner fixing a typo in the URL must not be shown the old repo's
 *     commits);
 *   - `force`, which the refresh button passes, and which the *database*
 *     rate-limits rather than this function: store.claimForce() is
 *     touch_repo_activity(), which hands out one forced fetch a minute per
 *     project. Refused, the press falls back to the window above.
 *
 * A failed fetch keeps whatever was last known and records the reason beside
 * it. Two reasons: a transient blip should not blank a working page, and
 * stamping `fetched_at` on the failure means a repository that is 404ing is
 * asked about once a quarter of an hour rather than once a click.
 */
export async function getActivity({
  store,
  repo,
  now = new Date(),
  token = null,
  fetchImpl = globalThis.fetch,
  force = false,
  signal,
  windowDays = WINDOW_DAYS,
} = {}) {
  const cached = await store.read();

  // `force` is the refresh button, and what it skips is the fifteen-minute
  // window — so the database, not this function, decides whether the press
  // gets to skip it. touch_repo_activity() claims a sixty-second slot and
  // says whether we got it.
  //
  // A refusal is not a failure. It demotes this call to an ordinary one, so
  // the window below applies again and the caller gets `cached: true`: the
  // same answer they would have had if they had never pressed the button,
  // and no new state for the page to render. It also means a refused press
  // on a project with nothing cached still fetches — what the limiter
  // protects is the window, and falling back to the window bypasses
  // nothing.
  //
  // store.claimForce is required rather than optional. A store that forgot
  // it would silently have no rate limit at all, which is the bug this
  // whole section exists to fix.
  const forcing = force && (await store.claimForce());

  if (
    cached &&
    cached.repo === repo &&
    !forcing &&
    isFresh(cached.fetched_at, now)
  ) {
    return { row: cached, cached: true };
  }

  const result = await collectActivity({ repo, token, fetchImpl, now, signal, windowDays });

  if (!result.ok) {
    const row = {
      repo,
      // Only kept when it is about the same repository; the previous repo's
      // commits are not an approximation of this one's.
      contributors: cached?.repo === repo ? (cached.contributors ?? []) : [],
      last_commit_at: cached?.repo === repo ? (cached.last_commit_at ?? null) : null,
      fetched_at: iso(now),
      window_days: windowDays,
      error: result.reason,
    };
    await store.write(row);
    return { row, cached: false };
  }

  const row = {
    repo,
    contributors: result.contributors,
    last_commit_at: result.last_commit_at,
    fetched_at: iso(now),
    window_days: windowDays,
    // 'partial' is not an error the page shows; the counts it has are right.
    error: null,
  };
  await store.write(row);
  return { row, cached: false };
}
