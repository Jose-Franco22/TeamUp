// Issue #60 — expertise and capacity, through the client.
//
// supabase/48_adviser_expertise.sql is the boundary. These exist because mock
// mode is what the components and the demo run against, so a rule the
// database has and mock mode does not is how #47 shipped broken: the panel
// goes on working in the demo and 403s in production.
//
// The cases that carry the design are the two the issue text would not have
// asked for:
//
//   * a **pending** invitation does not fill a spot, so an adviser with one
//     spot left and two invitations open can still accept either one. That is
//     why the cap is checked when accepting rather than when inviting, and
//     why invite_adviser()'s check and respond_to_adviser_request()'s are not
//     the same check written twice.
//   * **lowering the maximum** below the teams already advised is allowed and
//     retroactive to nothing. The accepted rows survive it.
//
// And one on the order of the refusals: a student is told they are not
// faculty, never something about advising limits they could not have set.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  addExpertise,
  inviteAdviser,
  myAdvising,
  removeExpertise,
  respondToAdviserRequest,
  searchAdvisers,
  setAdvisingAvailable,
  setAdvisingMaxTeams,
  setSessionUserId,
} from './client';
import { adviserExpertise, adviserRequests, users } from './mockData';
import { ADVISING_MAX_MAX } from '../lib/validation';

// From mockData.js, and all of it matters here:
//
//   p-parking  u-nicolas owns it; u-dana already advises it (ar-1, accepted)
//   p-degree   u-alexis owns it; u-luis has an unanswered invitation (ar-2)
//   p-scam     u-maria owns it; u-priya turned it down (ar-3), so it can ask
//              again. u-luis and u-dana are ON that team, so neither can
//              advise it.
//   p-lab      u-omar owns it; nobody has been asked. u-priya is on the team.
//
// Which leaves p-scam and p-lab as the two projects an invitation can
// actually be sent from, and they have different candidates.
const DEGREE = 'p-degree';
const SCAM = 'p-scam';
const LAB = 'p-lab';
const LUIS_INVITE = 'ar-2';

const snapshot = {};

beforeEach(() => {
  snapshot.adviserRequests = adviserRequests.map((r) => ({ ...r }));
  snapshot.adviserExpertise = adviserExpertise.map((r) => ({ ...r }));
  snapshot.users = users.map((u) => ({ ...u }));
});

afterEach(() => {
  adviserRequests.length = 0;
  adviserRequests.push(...snapshot.adviserRequests);
  adviserExpertise.length = 0;
  adviserExpertise.push(...snapshot.adviserExpertise);
  users.forEach((u, i) => Object.assign(u, snapshot.users[i]));
  setSessionUserId(null);
});

describe('myAdvising', () => {
  test('tells a faculty account that it is one, with its settings and areas', async () => {
    setSessionUserId('u-dana');

    expect(await myAdvising()).toEqual({
      is_faculty: true,
      available: true,
      max_teams: 2,
      advising: 1,
      is_full: false,
      expertise: [
        { id: 's-opencv', name: 'OpenCV', category: 'Data' },
        { id: 's-python', name: 'Python', category: 'Data' },
      ],
    });
  });

  // The whole reason this function exists: nothing else on the client can
  // answer it, because faculty_directory is revoked from `authenticated`.
  test('tells a student they are not faculty, which is what hides the card', async () => {
    setSessionUserId('u-marcus');
    expect((await myAdvising()).is_faculty).toBe(false);
  });

  test('available is on by default, which is what keeps every faculty account searchable', async () => {
    setSessionUserId('u-luis');
    const mine = await myAdvising();
    expect(mine.available).toBe(true);
    expect(mine.max_teams).toBe(null);
    expect(mine.is_full).toBe(false);
  });

  test('answers nobody who is not signed in', async () => {
    await expect(myAdvising()).rejects.toThrow(/signed in/i);
  });
});

describe('the maximum', () => {
  test('saves a number in range and reports it back', async () => {
    setSessionUserId('u-luis');
    expect((await setAdvisingMaxTeams(3)).max_teams).toBe(3);
    expect((await setAdvisingMaxTeams(ADVISING_MAX_MAX)).max_teams).toBe(ADVISING_MAX_MAX);
  });

  test('empty means no limit, which is an answer rather than a missing one', async () => {
    setSessionUserId('u-dana');
    expect((await setAdvisingMaxTeams('')).max_teams).toBe(null);
  });

  test('refuses zero, since turning the switch off is the way to take no teams', async () => {
    setSessionUserId('u-luis');
    await expect(setAdvisingMaxTeams(0)).rejects.toThrow(/between 1 and 20/);
  });

  test('refuses more than twenty, and anything that is not a whole number', async () => {
    setSessionUserId('u-luis');
    await expect(setAdvisingMaxTeams(21)).rejects.toThrow(/between 1 and 20/);
    await expect(setAdvisingMaxTeams('two')).rejects.toThrow(/whole number/);
  });

  test('becoming full is a consequence of the number, not a separate switch', async () => {
    setSessionUserId('u-dana');
    expect((await setAdvisingMaxTeams(1)).is_full).toBe(true);
    expect((await setAdvisingMaxTeams(2)).is_full).toBe(false);
  });
});

describe('lowering the maximum below the teams already advised', () => {
  test('is allowed, keeps the teams, and only stops new ones', async () => {
    setSessionUserId('u-dana');

    const mine = await setAdvisingMaxTeams(1);

    expect(mine.advising).toBe(1);
    expect(mine.is_full).toBe(true);
    // The assertion that matters: nothing went back and tidied up what she
    // already advises.
    expect(
      adviserRequests.filter((r) => r.adviser_id === 'u-dana' && r.status === 'accepted')
    ).toHaveLength(1);

    setSessionUserId('u-omar');
    await expect(inviteAdviser(LAB, 'u-dana')).rejects.toThrow(/as many teams as they take on/);
  });
});

describe('availability', () => {
  test('turning it off hides the adviser from search but keeps their teams', async () => {
    setSessionUserId('u-dana');
    const mine = await setAdvisingAvailable(false);
    expect(mine.available).toBe(false);
    expect(mine.advising).toBe(1);

    setSessionUserId('u-omar');
    expect(await searchAdvisers(LAB, 'Dana')).toEqual([]);
  });

  // Search is the only way in, so hiding would be enough — but invite_adviser
  // takes a user id, and a page left open still has one. The maximum is set
  // too, so which of the two refusals comes back is the test.
  test('and refuses a direct invitation for that reason rather than the limit', async () => {
    setSessionUserId('u-dana');
    await setAdvisingAvailable(false);
    await setAdvisingMaxTeams(1);

    setSessionUserId('u-omar');
    await expect(inviteAdviser(LAB, 'u-dana')).rejects.toThrow(/not taking advising requests/);
  });

  test('turning it back on puts them back in search', async () => {
    setSessionUserId('u-dana');
    await setAdvisingAvailable(false);
    await setAdvisingAvailable(true);

    setSessionUserId('u-omar');
    expect((await searchAdvisers(LAB, 'Dana')).map((u) => u.id)).toEqual(['u-dana']);
  });
});

describe('inviting someone who is full', () => {
  test('is refused up front rather than after they have to say no', async () => {
    // Sofia takes one team and is on no roster, so both free projects can ask
    // her.
    setSessionUserId('u-sofia');
    expect((await setAdvisingMaxTeams(1)).is_full).toBe(false);

    setSessionUserId('u-maria');
    const invite = await inviteAdviser(SCAM, 'u-sofia');
    setSessionUserId('u-sofia');
    await respondToAdviserRequest(invite.id, true);
    expect((await myAdvising()).is_full).toBe(true);

    setSessionUserId('u-omar');
    await expect(inviteAdviser(LAB, 'u-sofia')).rejects.toThrow(/as many teams as they take on/);
  });

  test('a student still hears the faculty rule, which comes first', async () => {
    setSessionUserId('u-maria');
    await expect(inviteAdviser(SCAM, 'u-marcus')).rejects.toThrow(
      /Only Computer Science faculty can advise a project/
    );
  });
});

describe('accepting while full', () => {
  // The case the cap is designed around. Sofia has one spot and two
  // invitations; neither owner was wrong to send one, and she can still take
  // either.
  async function twoInvitationsForSofia() {
    setSessionUserId('u-sofia');
    await setAdvisingMaxTeams(1);
    setSessionUserId('u-maria');
    const first = await inviteAdviser(SCAM, 'u-sofia');
    setSessionUserId('u-omar');
    const second = await inviteAdviser(LAB, 'u-sofia');
    setSessionUserId('u-sofia');
    return { first, second };
  }

  test('a pending invitation does not fill a spot', async () => {
    const { first, second } = await twoInvitationsForSofia();

    const before = await myAdvising();
    expect(before.advising).toBe(0);
    expect(before.is_full).toBe(false);

    await expect(respondToAdviserRequest(first.id, true)).resolves.toMatchObject({
      status: 'accepted',
    });
    // And now the second cannot be accepted, because the first took the spot.
    await expect(respondToAdviserRequest(second.id, true)).rejects.toThrow(
      /as many teams as you said you would take on/
    );
  });

  test('but it can still be declined, since being full is a reason to say no', async () => {
    const { first, second } = await twoInvitationsForSofia();
    await respondToAdviserRequest(first.id, true);

    await expect(respondToAdviserRequest(second.id, false)).resolves.toMatchObject({
      status: 'declined',
    });
    expect((await myAdvising()).advising).toBe(1);
  });

  test('an adviser who has set no maximum is never stopped', async () => {
    setSessionUserId('u-luis');
    expect((await myAdvising()).max_teams).toBe(null);
    await expect(respondToAdviserRequest(LUIS_INVITE, true)).resolves.toMatchObject({
      status: 'accepted',
    });
  });
});

describe('expertise', () => {
  test('is added and removed a row at a time, and comes back by category then name', async () => {
    setSessionUserId('u-luis');
    expect((await myAdvising()).expertise).toEqual([]);

    expect((await addExpertise('s-react')).expertise.map((a) => a.name)).toEqual(['React']);
    expect((await addExpertise('s-python')).expertise.map((a) => a.name)).toEqual(['Python', 'React']);
    expect((await removeExpertise('s-react')).expertise.map((a) => a.name)).toEqual(['Python']);
  });

  test('adding the same area twice leaves one row', async () => {
    setSessionUserId('u-luis');
    await addExpertise('s-react');
    expect((await addExpertise('s-react')).expertise).toHaveLength(1);
  });

  test('removing something that was never there is not an error', async () => {
    setSessionUserId('u-luis');
    await expect(removeExpertise('s-git')).resolves.toMatchObject({ expertise: [] });
  });

  test('one adviser’s areas are their own', async () => {
    setSessionUserId('u-luis');
    await addExpertise('s-git');

    setSessionUserId('u-dana');
    expect((await myAdvising()).expertise.map((a) => a.id)).toEqual(['s-opencv', 's-python']);
  });
});

describe('what search shows the owner', () => {
  test('each candidate’s areas, maximum, teams and whether that is full', async () => {
    setSessionUserId('u-omar');

    const [dana] = await searchAdvisers(LAB, 'Dana');

    expect(dana).toEqual({
      id: 'u-dana',
      name: 'Dana Kim',
      email: 'dkim01@utrgv.edu',
      max_teams: 2,
      advising: 1,
      is_full: false,
      expertise: [
        { id: 's-opencv', name: 'OpenCV', category: 'Data' },
        { id: 's-python', name: 'Python', category: 'Data' },
      ],
    });
  });

  test('a faculty member who has listed nothing comes back empty, not undefined', async () => {
    setSessionUserId('u-omar');
    const [luis] = await searchAdvisers(LAB, 'Luis');
    expect(luis.expertise).toEqual([]);
    expect(luis.max_teams).toBe(null);
  });

  // Dana is second by name among p-lab's candidates (Course Instructor, Dana
  // Kim, Luis Trevino, Sofia Garza). Being full is what moves her to the end,
  // so this fails if the ordering goes back to name alone.
  test('a full adviser is still returned, marked, and sorted after everyone with room', async () => {
    setSessionUserId('u-dana');
    await setAdvisingMaxTeams(1);

    setSessionUserId('u-omar');
    const found = await searchAdvisers(LAB, 'utrgv.edu');
    const names = found.map((u) => u.name);

    expect(names).toContain('Dana Kim');
    expect(found.find((u) => u.name === 'Dana Kim').is_full).toBe(true);
    expect(names[names.length - 1]).toBe('Dana Kim');
  });

  test('an unavailable adviser is left out of the same search entirely', async () => {
    setSessionUserId('u-dana');
    await setAdvisingAvailable(false);

    setSessionUserId('u-omar');
    const names = (await searchAdvisers(LAB, 'utrgv.edu')).map((u) => u.name);
    expect(names).not.toContain('Dana Kim');
  });
});
