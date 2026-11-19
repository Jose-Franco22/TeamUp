// Issue #58 — the GitHub half: what we ask for, what we count, what we do
// when GitHub says no, and when we don't ask at all.
// Run with `node --test supabase/functions/*/*.test.js`.
//
// Everything here drives real code with an injected `fetch` and an injected
// store, so the three Edge Function criteria on the issue are tested rather
// than asserted in a comment:
//
//   - parses commits and PRs from mocked GitHub responses into per-member
//     counts                                      → "counting" below
//   - returns cached data inside the cache window instead of calling GitHub
//     again                                       → "the cache" below
//   - a 404 or private repo returns a clear "can't access this repo" result
//     instead of an error                         → "when GitHub says no"
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_MINUTES,
  MAX_PAGES,
  WINDOW_DAYS,
  collectActivity,
  getActivity,
  isFresh,
  splitRepo,
  summarize,
  windowStart,
} from './activity.js';

const REPO = 'https://github.com/Jose-Franco22/TeamUp';
const NOW = new Date('2026-11-19T12:00:00Z');

// A commit as GitHub sends it, trimmed to the fields we read.
const commit = (login, date, name = login) => ({
  sha: Math.random().toString(16).slice(2),
  commit: { author: { name, email: `${name}@example.edu`, date } },
  author: login ? { login } : null,
});
const pull = (login, created_at) => ({ number: 1, user: login ? { login } : null, created_at });

// A fetch that answers from a table of path fragment → response.
function fakeFetch(routes, log = []) {
  return async (url, options) => {
    log.push({ url, headers: options?.headers ?? {} });
    const match = Object.keys(routes).find((key) => url.includes(key));
    const answer = match ? routes[match] : { status: 404, body: { message: 'Not Found' } };
    if (typeof answer === 'function') return answer(url);
    const { status = 200, body = [], headers = {} } = answer;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => headers[name.toLowerCase()] ?? null },
      json: async () => body,
    };
  };
}

// --- the stored URL, read strictly ---------------------------------------

describe('splitRepo', () => {
  test('splits the canonical form', () => {
    assert.deepEqual(splitRepo(REPO), { owner: 'Jose-Franco22', repo: 'TeamUp' });
  });

  // The browser does the lenient reading once, and set_project_repo() stores
  // only the canonical form. Anything else here means a rule upstream is
  // gone, and guessing would build an API URL out of unvalidated text.
  test('and refuses everything else, rather than guessing', () => {
    for (const bad of [
      'github.com/a/b',
      'https://github.com/a/b/',
      'https://github.com/a/b.git',
      'http://github.com/a/b',
      'https://www.github.com/a/b',
      'https://github.com/a',
      'https://github.com/a/b/c',
      'https://gitlab.com/a/b',
      'https://github.com.evil.example/a/b',
      '',
      null,
      undefined,
    ]) {
      assert.equal(splitRepo(bad), null, `refuses ${JSON.stringify(bad)}`);
    }
  });

  // A repo of ".." would make /repos/owner/../commits climb to another
  // endpoint. The character class alone allows it, so it is checked.
  test('and a name that is only dots, which would walk the API path', () => {
    assert.equal(splitRepo('https://github.com/a/..'), null);
    assert.equal(splitRepo('https://github.com/a/.'), null);
  });

  test('but a leading dot is a legal repository name', () => {
    assert.deepEqual(splitRepo('https://github.com/a/.dotfiles'), { owner: 'a', repo: '.dotfiles' });
  });
});

// --- the cache window ----------------------------------------------------

describe('isFresh', () => {
  const at = (minutes) => new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();

  test('a row just written is fresh, one past the window is not', () => {
    assert.equal(isFresh(at(0), NOW), true);
    assert.equal(isFresh(at(CACHE_MINUTES - 1), NOW), true);
    assert.equal(isFresh(at(CACHE_MINUTES + 1), NOW), false);
  });

  // The issue says "at least 15 minutes": at exactly the window the row has
  // stopped counting, which is the safe side of "at least".
  test('exactly at the window it is not', () => {
    assert.equal(isFresh(at(CACHE_MINUTES), NOW), false);
  });

  test('and neither is nothing, nonsense, or a row from the future', () => {
    assert.equal(isFresh(null, NOW), false);
    assert.equal(isFresh(undefined, NOW), false);
    assert.equal(isFresh('not a date', NOW), false);
    assert.equal(isFresh(new Date(NOW.getTime() + 60 * 1000).toISOString(), NOW), false);
  });
});

test('windowStart is WINDOW_DAYS before now', () => {
  assert.equal(windowStart(NOW), '2026-11-05T12:00:00.000Z');
  assert.equal(WINDOW_DAYS, 14);
});

// --- counting ------------------------------------------------------------

describe('summarize', () => {
  test('counts commits and pull requests per login', () => {
    const { contributors } = summarize({
      commits: [
        commit('GoldNicolas', '2026-11-18T10:00:00Z'),
        commit('GoldNicolas', '2026-11-17T10:00:00Z'),
        commit('Jose-Franco22', '2026-11-16T10:00:00Z'),
      ],
      pulls: [pull('GoldNicolas', '2026-11-18T11:00:00Z'), pull('Jose-Franco22', '2026-11-15T11:00:00Z')],
      now: NOW,
    });

    assert.deepEqual(
      contributors.map((c) => [c.login, c.commits, c.pull_requests]),
      [
        ['GoldNicolas', 2, 1],
        ['Jose-Franco22', 1, 1],
      ]
    );
  });

  test('the last commit is the newest one, per person and overall', () => {
    const { contributors, last_commit_at } = summarize({
      commits: [
        commit('GoldNicolas', '2026-11-10T10:00:00Z'),
        commit('GoldNicolas', '2026-11-18T10:00:00Z'),
        commit('Jose-Franco22', '2026-11-12T10:00:00Z'),
      ],
      now: NOW,
    });
    assert.equal(contributors[0].last_commit_at, '2026-11-18T10:00:00.000Z');
    assert.equal(last_commit_at, '2026-11-18T10:00:00.000Z');
  });

  // GitHub's `since` already filters, but a cached or replayed response is
  // not ours to trust, and the page's heading says "last 14 days".
  test('anything outside the window is dropped even if GitHub sent it', () => {
    const { contributors, last_commit_at } = summarize({
      commits: [commit('GoldNicolas', '2026-10-01T10:00:00Z')],
      pulls: [pull('GoldNicolas', '2026-10-01T10:00:00Z')],
      now: NOW,
    });
    assert.deepEqual(contributors, []);
    assert.equal(last_commit_at, null);
  });

  test('and a commit with an unreadable date is not evidence of anything', () => {
    const { contributors } = summarize({ commits: [commit('GoldNicolas', 'yesterday')], now: NOW });
    assert.deepEqual(contributors, []);
  });

  // The normal result of committing from a machine whose git email GitHub
  // doesn't recognise. These are what the page shows as an unlinked
  // contributor, and they must not vanish: the total has to match the repo.
  test('commits with no account behind them keep the name and a null login', () => {
    const { contributors } = summarize({
      commits: [
        commit(null, '2026-11-18T10:00:00Z', 'Nicolas Guerra'),
        commit(null, '2026-11-17T10:00:00Z', 'Nicolas Guerra'),
      ],
      now: NOW,
    });
    assert.equal(contributors.length, 1);
    assert.equal(contributors[0].login, null);
    assert.equal(contributors[0].name, 'Nicolas Guerra');
    assert.equal(contributors[0].commits, 2);
  });

  test('an unrecognised commit with no name at all is still counted, once', () => {
    const { contributors } = summarize({
      commits: [commit(null, '2026-11-18T10:00:00Z', null), commit(null, '2026-11-17T10:00:00Z', null)],
      now: NOW,
    });
    assert.equal(contributors.length, 1);
    assert.equal(contributors[0].commits, 2);
  });

  // The same person, two capitalisations of their login, is one contributor.
  test('logins are grouped case-insensitively', () => {
    const { contributors } = summarize({
      commits: [commit('GoldNicolas', '2026-11-18T10:00:00Z'), commit('goldnicolas', '2026-11-17T10:00:00Z')],
      pulls: [pull('GOLDNICOLAS', '2026-11-18T10:00:00Z')],
      now: NOW,
    });
    assert.equal(contributors.length, 1);
    assert.equal(contributors[0].commits, 2);
    assert.equal(contributors[0].pull_requests, 1);
  });

  // Somebody who opened a pull request but committed nothing in the window
  // is still a contributor, with no last commit.
  test('a pull request alone is enough to appear', () => {
    const { contributors } = summarize({ pulls: [pull('Reviewer', '2026-11-18T10:00:00Z')], now: NOW });
    assert.deepEqual(contributors, [
      { login: 'Reviewer', name: null, commits: 0, pull_requests: 1, last_commit_at: null },
    ]);
  });

  test('busiest first', () => {
    const { contributors } = summarize({
      commits: [
        commit('quiet', '2026-11-18T10:00:00Z'),
        commit('busy', '2026-11-18T10:00:00Z'),
        commit('busy', '2026-11-17T10:00:00Z'),
      ],
      now: NOW,
    });
    assert.deepEqual(contributors.map((c) => c.login), ['busy', 'quiet']);
  });

  test('nothing at all is an empty window, not a failure', () => {
    assert.deepEqual(summarize({ now: NOW }), { contributors: [], last_commit_at: null });
    assert.deepEqual(summarize(), { contributors: [], last_commit_at: null });
  });
});

// --- asking GitHub -------------------------------------------------------

describe('collectActivity', () => {
  test('asks for commits since the window, and counts both lists', async () => {
    const log = [];
    const result = await collectActivity({
      repo: REPO,
      token: 'ghp_secret',
      now: NOW,
      fetchImpl: fakeFetch(
        {
          '/commits': { body: [commit('GoldNicolas', '2026-11-18T10:00:00Z')] },
          '/pulls': { body: [pull('GoldNicolas', '2026-11-18T11:00:00Z')] },
        },
        log
      ),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.contributors.map((c) => [c.login, c.commits, c.pull_requests]), [
      ['GoldNicolas', 1, 1],
    ]);
    assert.ok(log[0].url.startsWith('https://api.github.com/repos/Jose-Franco22/TeamUp/commits'));
    assert.match(log[0].url, /since=2026-11-05T12%3A00%3A00.000Z/);
  });

  test('the token travels in a header and never in the URL', async () => {
    const log = [];
    await collectActivity({
      repo: REPO,
      token: 'ghp_secret',
      now: NOW,
      fetchImpl: fakeFetch({ '/commits': { body: [] }, '/pulls': { body: [] } }, log),
    });
    for (const call of log) {
      assert.equal(call.headers.Authorization, 'Bearer ghp_secret');
      assert.ok(!call.url.includes('ghp_secret'), 'the URL carries no token');
    }
  });

  test('and is simply absent when we have none — public repos still work', async () => {
    const log = [];
    const result = await collectActivity({
      repo: REPO,
      now: NOW,
      fetchImpl: fakeFetch({ '/commits': { body: [] }, '/pulls': { body: [] } }, log),
    });
    assert.equal(result.ok, true);
    assert.equal('Authorization' in log[0].headers, false);
    // GitHub refuses a request with no User-Agent at all.
    assert.equal(log[0].headers['User-Agent'], 'teamup-activity');
  });

  test('a repo past one page is followed, up to the cap', async () => {
    const full = Array.from({ length: 100 }, () => commit('GoldNicolas', '2026-11-18T10:00:00Z'));
    let commitCalls = 0;
    const result = await collectActivity({
      repo: REPO,
      now: NOW,
      fetchImpl: async (url) => {
        const isCommits = url.includes('/commits');
        if (isCommits) commitCalls += 1;
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => (isCommits ? full : []),
        };
      },
    });
    assert.equal(commitCalls, MAX_PAGES, 'stops at the cap rather than following forever');
    assert.equal(result.contributors[0].commits, MAX_PAGES * 100);
  });

  test('a short page is the last page', async () => {
    let calls = 0;
    await collectActivity({
      repo: REPO,
      now: NOW,
      fetchImpl: async (url) => {
        if (url.includes('/commits')) calls += 1;
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => [] };
      },
    });
    assert.equal(calls, 1);
  });

  describe('when GitHub says no', () => {
    const refusal = async (status, headers = {}) =>
      collectActivity({
        repo: REPO,
        now: NOW,
        fetchImpl: fakeFetch({ '/commits': { status, body: { message: 'nope' }, headers } }),
      });

    // THE CRITERION: a 404 or a private repo is a clear result, not an error.
    // GitHub answers 404 for both — it will not confirm a private repo
    // exists — so one reason covers both and the page explains access.
    test('404 (gone, or private and invisible to us) reads as not_found', async () => {
      assert.deepEqual(await refusal(404), { ok: false, reason: 'not_found' });
    });

    test('a rate limit is named, so the page can say "try later"', async () => {
      assert.deepEqual(await refusal(403, { 'x-ratelimit-remaining': '0' }), {
        ok: false,
        reason: 'rate_limited',
      });
      assert.deepEqual(await refusal(429, { 'x-ratelimit-remaining': '0' }), {
        ok: false,
        reason: 'rate_limited',
      });
    });

    test('a 403 with quota left is a permission problem, not a rate limit', async () => {
      assert.deepEqual(await refusal(403, { 'x-ratelimit-remaining': '4999' }), {
        ok: false,
        reason: 'forbidden',
      });
    });

    test('a bad token says so, rather than blaming the repo', async () => {
      assert.deepEqual(await refusal(401), { ok: false, reason: 'bad_token' });
    });

    test('anything else is upstream_error', async () => {
      assert.deepEqual(await refusal(500), { ok: false, reason: 'upstream_error' });
      assert.deepEqual(await refusal(502), { ok: false, reason: 'upstream_error' });
    });

    // A repository created five minutes ago and linked straight away. GitHub
    // answers 409, which is not a failure: there is simply nothing yet.
    test('an empty repository is an empty window, not an error', async () => {
      const result = await collectActivity({
        repo: REPO,
        now: NOW,
        fetchImpl: fakeFetch({ '/commits': { status: 409, body: { message: 'Git Repository is empty.' } } }),
      });
      assert.deepEqual(result, { ok: true, contributors: [], last_commit_at: null });
    });

    test('a thrown fetch is unreachable, and quotes nothing', async () => {
      const result = await collectActivity({
        repo: REPO,
        now: NOW,
        fetchImpl: async () => {
          throw new Error(`getaddrinfo ENOTFOUND api.github.com (token ghp_secret)`);
        },
        token: 'ghp_secret',
      });
      assert.deepEqual(result, { ok: false, reason: 'unreachable' });
      assert.ok(!JSON.stringify(result).includes('ghp_secret'));
    });

    test('a body that is not a list is refused rather than counted', async () => {
      const result = await collectActivity({
        repo: REPO,
        now: NOW,
        fetchImpl: fakeFetch({ '/commits': { body: { message: 'surprise' } } }),
      });
      assert.deepEqual(result, { ok: false, reason: 'upstream_error' });
    });

    // Commits worked and pull requests didn't: report what we have rather
    // than throwing the commits away.
    test('pull requests failing alone still reports the commits', async () => {
      const result = await collectActivity({
        repo: REPO,
        now: NOW,
        fetchImpl: fakeFetch({
          '/commits': { body: [commit('GoldNicolas', '2026-11-18T10:00:00Z')] },
          '/pulls': { status: 500, body: {} },
        }),
      });
      assert.equal(result.ok, true);
      assert.equal(result.contributors[0].commits, 1);
      assert.equal(result.contributors[0].pull_requests, 0);
      assert.equal(result.partial, true);
    });

    test('a repo that is not in the canonical form is never requested', async () => {
      let called = false;
      const result = await collectActivity({
        repo: 'https://github.com/a/../../etc',
        now: NOW,
        fetchImpl: async () => {
          called = true;
          throw new Error('should not be reached');
        },
      });
      assert.deepEqual(result, { ok: false, reason: 'bad_repo' });
      assert.equal(called, false);
    });
  });
});

// --- the cache -----------------------------------------------------------

function fakeStore(initial = null) {
  const store = {
    row: initial,
    writes: 0,
    read: async () => store.row,
    write: async (row) => {
      store.writes += 1;
      store.row = row;
    },
  };
  return store;
}

describe('the cache', () => {
  const fresh = {
    repo: REPO,
    contributors: [{ login: 'GoldNicolas', commits: 7, pull_requests: 1, last_commit_at: '2026-11-18T10:00:00Z' }],
    last_commit_at: '2026-11-18T10:00:00Z',
    fetched_at: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
    window_days: WINDOW_DAYS,
    error: null,
  };
  const never = async () => {
    throw new Error('GitHub must not be called');
  };

  // THE CRITERION: inside the window, GitHub is not called again.
  test('a row inside the window is reused and nothing is fetched', async () => {
    const store = fakeStore(fresh);
    const { row, cached } = await getActivity({ store, repo: REPO, now: NOW, fetchImpl: never });
    assert.equal(cached, true);
    assert.equal(row.contributors[0].commits, 7);
    assert.equal(store.writes, 0, 'and nothing is written either');
  });

  test('past the window it fetches again and stores the answer', async () => {
    const store = fakeStore({ ...fresh, fetched_at: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString() });
    const { row, cached } = await getActivity({
      store,
      repo: REPO,
      now: NOW,
      fetchImpl: fakeFetch({
        '/commits': { body: [commit('GoldNicolas', '2026-11-19T09:00:00Z')] },
        '/pulls': { body: [] },
      }),
    });
    assert.equal(cached, false);
    assert.equal(row.contributors[0].commits, 1);
    assert.equal(row.fetched_at, NOW.toISOString());
    assert.equal(store.writes, 1);
  });

  test('an empty cache fetches', async () => {
    const store = fakeStore(null);
    const { cached } = await getActivity({
      store,
      repo: REPO,
      now: NOW,
      fetchImpl: fakeFetch({ '/commits': { body: [] }, '/pulls': { body: [] } }),
    });
    assert.equal(cached, false);
    assert.equal(store.writes, 1);
  });

  // The owner fixes a typo in the URL. Showing the old repository's commits
  // for the next fifteen minutes would be worse than showing none.
  test('a cached row about a different repo is not an answer about this one', async () => {
    const store = fakeStore({ ...fresh, repo: 'https://github.com/someone/else' });
    const { row, cached } = await getActivity({
      store,
      repo: REPO,
      now: NOW,
      fetchImpl: fakeFetch({ '/commits': { body: [] }, '/pulls': { body: [] } }),
    });
    assert.equal(cached, false);
    assert.equal(row.repo, REPO);
    assert.deepEqual(row.contributors, []);
  });

  test('force refetches a row that was still fresh', async () => {
    const store = fakeStore(fresh);
    const { cached, row } = await getActivity({
      store,
      repo: REPO,
      now: NOW,
      force: true,
      fetchImpl: fakeFetch({ '/commits': { body: [] }, '/pulls': { body: [] } }),
    });
    assert.equal(cached, false);
    assert.deepEqual(row.contributors, []);
  });

  describe('a failed refresh', () => {
    const failing = fakeFetch({ '/commits': { status: 500, body: {} } });

    // A blip must not blank a page that was working a minute ago.
    test('keeps the last good counts and records why', async () => {
      const store = fakeStore({ ...fresh, fetched_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() });
      const { row } = await getActivity({ store, repo: REPO, now: NOW, fetchImpl: failing });
      assert.equal(row.error, 'upstream_error');
      assert.equal(row.contributors[0].commits, 7, 'the last good answer survives');
      assert.equal(row.last_commit_at, '2026-11-18T10:00:00Z');
    });

    // And it stamps the clock, so a repo that is 404ing is asked about four
    // times an hour rather than once a click.
    test('still counts as an attempt, so the next click does not retry at once', async () => {
      const store = fakeStore(null);
      await getActivity({ store, repo: REPO, now: NOW, fetchImpl: failing });
      assert.equal(store.row.fetched_at, NOW.toISOString());

      await getActivity({ store, repo: REPO, now: NOW, fetchImpl: never });
      assert.equal(store.writes, 1, 'the second call answered from the cache');
    });

    test('and carries nothing over from a different repo', async () => {
      const store = fakeStore({ ...fresh, repo: 'https://github.com/someone/else' });
      const { row } = await getActivity({ store, repo: REPO, now: NOW, fetchImpl: failing });
      assert.deepEqual(row.contributors, []);
      assert.equal(row.last_commit_at, null);
      assert.equal(row.error, 'upstream_error');
    });

    test('a 404 is stored as not_found, which is what the page explains', async () => {
      const store = fakeStore(null);
      const { row } = await getActivity({
        store,
        repo: REPO,
        now: NOW,
        fetchImpl: fakeFetch({ '/commits': { status: 404, body: {} } }),
      });
      assert.equal(row.error, 'not_found');
    });
  });

  test('a successful refresh clears a previous error', async () => {
    const store = fakeStore({ ...fresh, error: 'not_found', fetched_at: '2026-11-19T10:00:00Z' });
    const { row } = await getActivity({
      store,
      repo: REPO,
      now: NOW,
      fetchImpl: fakeFetch({ '/commits': { body: [] }, '/pulls': { body: [] } }),
    });
    assert.equal(row.error, null);
  });
});
