// Issue #58 — linking a repository and reading its activity, through the
// client.
//
// supabase/tests/github_activity.test.sql is the boundary; these are here
// because mock mode is what the components and the demo run against, and a
// refusal spelled differently on the two sides means the UI shows one thing
// and the database enforces another.
//
// The refresh cases are the ones worth reading twice. refreshRepoActivity()
// is the only call in this file that never throws: the link and the last
// known counts stay on screen while it fails, so every failure has to come
// back as a reason the page has a sentence for.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  getMyTeam,
  getProject,
  getRepoActivity,
  refreshRepoActivity,
  setProjectRepo,
  setSessionUserId,
} from './client';
import { projects, repoActivity, repoActivityFor } from './mockData';
import { ValidationError } from '../lib/validation';
import { WINDOW_DAYS } from '../lib/github';

// From mockData.js: p-parking is Nicolas's, has u-jose on the team, and is
// the one project with a repository linked. p-degree is Alexis's, unlinked.
const PARKING = 'p-parking';
const DEGREE = 'p-degree';
const REPO = 'https://github.com/Jose-Franco22/TeamUp';

const snapshot = {};

beforeEach(() => {
  snapshot.projects = projects.map((p) => ({ ...p }));
  snapshot.repoActivity = repoActivity.map((r) => ({ ...r }));
});

afterEach(() => {
  projects.length = 0;
  projects.push(...snapshot.projects);
  repoActivity.length = 0;
  repoActivity.push(...snapshot.repoActivity);
  setSessionUserId(null);
});

// --- linking ---------------------------------------------------------------

describe('setProjectRepo', () => {
  test('the owner links a repository', async () => {
    setSessionUserId('u-alexis');

    const project = await setProjectRepo(DEGREE, 'https://github.com/utrgv/degree-plan');

    expect(project.github_repo).toBe('https://github.com/utrgv/degree-plan');
    expect((await getProject(DEGREE)).github_repo).toBe('https://github.com/utrgv/degree-plan');
  });

  // The client is the last stop before the write, so it normalises rather
  // than trusting the form to have done it. What reaches the database is
  // always the canonical form, which is what the Edge Function can read.
  test('and whatever shape they pasted is stored canonically', async () => {
    setSessionUserId('u-alexis');

    for (const pasted of [
      'github.com/utrgv/degree-plan',
      'https://github.com/utrgv/degree-plan.git',
      'https://www.github.com/utrgv/degree-plan/',
      'git@github.com:utrgv/degree-plan.git',
      '  https://github.com/utrgv/degree-plan  ',
    ]) {
      const project = await setProjectRepo(DEGREE, pasted);
      expect(project.github_repo, pasted).toBe('https://github.com/utrgv/degree-plan');
    }
  });

  test('a link we cannot read is a field error, not a save', async () => {
    setSessionUserId('u-alexis');

    await expect(setProjectRepo(DEGREE, 'https://github.com/utrgv')).rejects.toThrow(
      ValidationError
    );
    expect((await getProject(DEGREE)).github_repo).toBe('');
  });

  test('with the message the form puts under the box', async () => {
    setSessionUserId('u-alexis');
    try {
      await setProjectRepo(DEGREE, 'https://gitlab.com/group/project');
      throw new Error('should have refused');
    } catch (error) {
      expect(error.fieldErrors.github_repo).toMatch(/TeamUp reads GitHub/);
    }
  });

  test('only the owner, not a member of their own team', async () => {
    setSessionUserId('u-jose'); // on p-parking, does not own it
    await expect(setProjectRepo(PARKING, 'https://github.com/someone/else')).rejects.toThrow(
      'Only the project creator can link a repository'
    );
  });

  test('nor a student with nothing to do with it', async () => {
    setSessionUserId('u-sofia');
    await expect(setProjectRepo(PARKING, 'https://github.com/someone/else')).rejects.toThrow(
      'Only the project creator can link a repository'
    );
  });

  test('nor somebody signed out', async () => {
    await expect(setProjectRepo(PARKING, 'https://github.com/someone/else')).rejects.toThrow(
      'Not signed in'
    );
  });

  test('a project that does not exist is not found', async () => {
    setSessionUserId('u-nicolas');
    await expect(setProjectRepo('p-nope', REPO)).rejects.toThrow('Project not found');
  });

  test('passing nothing unlinks it', async () => {
    setSessionUserId('u-nicolas');

    await setProjectRepo(PARKING, '');

    expect((await getProject(PARKING)).github_repo).toBe('');
  });

  // Mirrors set_project_repo(): the old repository's commits are not an
  // approximation of the new one's, and leaving them up would show the team
  // somebody else's work for as long as the cache lasts.
  test('pointing somewhere else throws the cached answer away', async () => {
    setSessionUserId('u-nicolas');
    expect(repoActivityFor(PARKING)).not.toBeNull();

    await setProjectRepo(PARKING, 'https://github.com/utrgv/parking-tracker');

    expect(repoActivityFor(PARKING)).toBeNull();
  });

  test('unlinking throws it away too', async () => {
    setSessionUserId('u-nicolas');
    await setProjectRepo(PARKING, '');
    expect(repoActivityFor(PARKING)).toBeNull();
  });

  test('but saving the same link again keeps it', async () => {
    setSessionUserId('u-nicolas');
    await setProjectRepo(PARKING, REPO);
    expect(repoActivityFor(PARKING)).not.toBeNull();
  });

  // Mock mode and real mode have to agree on the shape, not just the value:
  // #47 shipped a query that worked here and 400'd in production.
  test('an unlinked project reads as an empty string, never undefined', async () => {
    setSessionUserId('u-sofia');
    const project = await getProject(DEGREE);
    expect(project.github_repo).toBe('');
    expect('github_repo' in project).toBe(true);
  });
});

// --- reading the activity --------------------------------------------------

describe('getRepoActivity', () => {
  test('the team reads what GitHub last told us', async () => {
    setSessionUserId('u-nicolas');

    const activity = await getRepoActivity(PARKING);

    expect(activity.repo).toBe(REPO);
    expect(activity.window_days).toBe(WINDOW_DAYS);
    expect(activity.contributors.map((c) => c.login)).toContain('nguerra');
    expect(activity.error).toBeNull();
  });

  test('and so does anyone else on it', async () => {
    setSessionUserId('u-jose');
    expect((await getRepoActivity(PARKING)).repo).toBe(REPO);
  });

  // Who committed how much is the team's business. The real query returns
  // nothing because RLS hides the row, so this returns null rather than
  // throwing — the same answer, reached the same way.
  test('a student not on the team gets nothing', async () => {
    setSessionUserId('u-sofia');
    expect(await getRepoActivity(PARKING)).toBeNull();
  });

  test('nor does someone on a different team', async () => {
    setSessionUserId('u-maria'); // on t-scam
    expect(await getRepoActivity(PARKING)).toBeNull();
  });

  // The normal state of a repository linked a moment ago. The page asks for
  // a refresh rather than showing an error.
  test('a project nobody has asked about yet is null, not an error', async () => {
    setSessionUserId('u-alexis');
    expect(await getRepoActivity(DEGREE)).toBeNull();
  });

  test('and a caller gets a copy, not the fixture itself', async () => {
    setSessionUserId('u-nicolas');
    const activity = await getRepoActivity(PARKING);
    activity.contributors[0].commits = 999;
    expect(repoActivityFor(PARKING).contributors[0].commits).toBe(12);
  });
});

// --- refreshing ------------------------------------------------------------

describe('refreshRepoActivity', () => {
  // Every one of these is a reason lib/github.js has a sentence for, and
  // none of them throws: the page keeps the link and the last counts.
  test('signed out is a reason, not a rejection', async () => {
    await expect(refreshRepoActivity(PARKING)).resolves.toMatchObject({
      ok: false,
      reason: 'signed_out',
    });
  });

  test('so is not being on the team', async () => {
    setSessionUserId('u-sofia');
    await expect(refreshRepoActivity(PARKING)).resolves.toMatchObject({
      ok: false,
      reason: 'not_on_team',
    });
  });

  test('and so is a team with nothing linked', async () => {
    setSessionUserId('u-alexis');
    await expect(refreshRepoActivity(DEGREE)).resolves.toMatchObject({
      ok: false,
      reason: 'no_repo',
    });
  });

  test('a project that does not exist is one too', async () => {
    setSessionUserId('u-nicolas');
    await expect(refreshRepoActivity('p-nope')).resolves.toMatchObject({
      ok: false,
      reason: 'no_project',
    });
  });

  // The cache decision itself, which is the one thing mock mode can keep
  // honest without a GitHub to call. getActivity() in the Edge Function
  // makes the same call on the same window.
  test('an answer from the last few minutes comes back as cached', async () => {
    setSessionUserId('u-nicolas');

    const result = await refreshRepoActivity(PARKING);

    expect(result).toMatchObject({ ok: true, cached: true });
    expect(result.activity.contributors).toHaveLength(3);
  });

  test('the refresh button asks again anyway', async () => {
    setSessionUserId('u-nicolas');
    const before = repoActivityFor(PARKING).fetched_at;

    const result = await refreshRepoActivity(PARKING, { force: true });

    expect(result).toMatchObject({ ok: true, cached: false });
    expect(new Date(result.activity.fetched_at).getTime()).toBeGreaterThan(
      new Date(before).getTime()
    );
  });

  test('and an answer past the window is not reused', async () => {
    setSessionUserId('u-nicolas');
    repoActivityFor(PARKING).fetched_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    await expect(refreshRepoActivity(PARKING)).resolves.toMatchObject({
      ok: true,
      cached: false,
    });
  });

  test('a repository nobody has asked about is fetched and stored', async () => {
    setSessionUserId('u-alexis');
    await setProjectRepo(DEGREE, 'https://github.com/utrgv/degree-plan');

    const result = await refreshRepoActivity(DEGREE);

    expect(result).toMatchObject({ ok: true, cached: false });
    expect(result.activity.repo).toBe('https://github.com/utrgv/degree-plan');
    expect(result.activity.window_days).toBe(WINDOW_DAYS);
    // There is no GitHub here, so the counts are empty rather than invented.
    expect(result.activity.contributors).toEqual([]);
    expect(repoActivityFor(DEGREE)).not.toBeNull();
  });

  test('and the row it stores is the row the page then reads', async () => {
    setSessionUserId('u-alexis');
    await setProjectRepo(DEGREE, 'https://github.com/utrgv/degree-plan');
    const { activity } = await refreshRepoActivity(DEGREE);

    expect((await getRepoActivity(DEGREE)).fetched_at).toBe(activity.fetched_at);
  });
});

// --- what the team page gets ----------------------------------------------

describe('the team page', () => {
  // activityRows() matches a commit's login to the member whose profile
  // names them, so the roster has to carry github_url. It is not on the
  // plain project views, only this enriched one.
  test('carries each member’s GitHub URL, so commits can be matched', async () => {
    setSessionUserId('u-nicolas');

    const team = await getMyTeam();

    expect(team.members.map((m) => m.github_url)).toEqual([
      'https://github.com/nguerra',
      'https://github.com/Jose-Franco22',
    ]);
  });

  test('and the link itself, so the owner can change it', async () => {
    setSessionUserId('u-nicolas');
    expect((await getMyTeam()).github_repo).toBe(REPO);
  });

  test('a member with no GitHub URL carries an empty string, not undefined', async () => {
    setSessionUserId('u-maria'); // t-scam: Luis and Dana have no profile link
    const team = await getMyTeam();
    for (const member of team.members) {
      expect(typeof member.github_url).toBe('string');
    }
  });
});
