// Issue #54 — answering an invitation to advise, through the client.
//
// supabase/tests/adviser_responses.test.sql is the boundary; these are here
// because mock mode is what the components and the demo run against, and the
// refusals have to be spelled the same way in both or the UI shows one thing
// and the database enforces another.
//
// The seat cases at the bottom are deliberately a repeat of advisers.test.js
// against an adviser who accepted through respondToAdviserRequest() rather
// than a fixture row: accepting is the moment a future change would be
// tempted to seat somebody.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  getAdvisedProjects,
  getMyAdviserRequests,
  getProject,
  getProjectAdviser,
  inviteAdviser,
  respondToAdviserRequest,
  setSessionUserId,
  stepDownAsAdviser,
} from './client';
import { adviserRequests, notifications, projects, teamMembers } from './mockData';

// From mockData.js: u-luis has an unanswered invitation to advise p-degree
// (u-alexis owns it); u-dana already advises p-parking; u-priya turned
// p-scam down.
const DEGREE = 'p-degree';
const PARKING = 'p-parking';
const LAB = 'p-lab';
const LUIS_INVITE = 'ar-2';

const snapshot = {};
const noticesFor = (userId, kind) =>
  notifications.filter((n) => n.user_id === userId && n.kind === kind);

beforeEach(() => {
  snapshot.adviserRequests = adviserRequests.map((r) => ({ ...r }));
  snapshot.projects = projects.map((p) => ({ ...p }));
  snapshot.teamMembers = teamMembers.map((m) => ({ ...m }));
  notifications.length = 0;
});

afterEach(() => {
  adviserRequests.length = 0;
  adviserRequests.push(...snapshot.adviserRequests);
  projects.length = 0;
  projects.push(...snapshot.projects);
  teamMembers.length = 0;
  teamMembers.push(...snapshot.teamMembers);
  notifications.length = 0;
  setSessionUserId(null);
});

// --- what is waiting for an answer ---------------------------------------

describe('getMyAdviserRequests', () => {
  test('lists the invitation with enough to answer it without leaving the page', async () => {
    setSessionUserId('u-luis');

    const [invite] = await getMyAdviserRequests();

    expect(invite).toMatchObject({
      id: LUIS_INVITE,
      project_id: DEGREE,
      project_title: 'Degree plan builder',
      owner_name: 'Alexis Covarrubias',
    });
    expect(invite.project_description).toMatch(/Constraint solver/);
  });

  test('an answered invitation is not waiting for anything', async () => {
    setSessionUserId('u-dana'); // already accepted p-parking
    expect(await getMyAdviserRequests()).toEqual([]);
  });

  test('nor is a declined one', async () => {
    setSessionUserId('u-priya');
    expect(await getMyAdviserRequests()).toEqual([]);
  });

  test('and somebody nobody has asked sees nothing', async () => {
    setSessionUserId('u-sofia');
    expect(await getMyAdviserRequests()).toEqual([]);
  });

  test('a withdrawn invitation stops being offered', async () => {
    setSessionUserId('u-alexis');
    const { cancelAdviserRequest } = await import('./client');
    await cancelAdviserRequest(DEGREE);

    setSessionUserId('u-luis');
    expect(await getMyAdviserRequests()).toEqual([]);
  });
});

// --- answering ------------------------------------------------------------

describe('respondToAdviserRequest', () => {
  test('accepting makes them the adviser and tells the owner', async () => {
    setSessionUserId('u-luis');

    const row = await respondToAdviserRequest(LUIS_INVITE, true);

    expect(row).toMatchObject({ status: 'accepted' });
    expect(row.responded_at).not.toBeNull();
    expect(noticesFor('u-alexis', 'adviser_accepted')).toHaveLength(1);
    expect(noticesFor('u-alexis', 'adviser_accepted')[0]).toMatchObject({
      project_id: DEGREE,
      actor_id: 'u-luis',
    });
  });

  test('declining leaves the project without one, and tells the owner that', async () => {
    setSessionUserId('u-luis');

    await respondToAdviserRequest(LUIS_INVITE, false);

    expect(noticesFor('u-alexis', 'adviser_declined')).toHaveLength(1);
    expect(noticesFor('u-alexis', 'adviser_accepted')).toHaveLength(0);
    setSessionUserId('u-alexis');
    expect(await getProjectAdviser(DEGREE)).toMatchObject({ status: 'declined' });
  });

  test('and the owner can then ask somebody else', async () => {
    setSessionUserId('u-luis');
    await respondToAdviserRequest(LUIS_INVITE, false);

    setSessionUserId('u-alexis');
    await expect(inviteAdviser(DEGREE, 'u-sofia')).resolves.toMatchObject({ status: 'pending' });
  });

  describe('refusals', () => {
    test('somebody who was not asked cannot answer', async () => {
      setSessionUserId('u-sofia');
      await expect(respondToAdviserRequest(LUIS_INVITE, true)).rejects.toThrow(
        'Only the person who was asked can answer this invitation'
      );
    });

    test('nor can the owner who sent it', async () => {
      setSessionUserId('u-alexis');
      await expect(respondToAdviserRequest(LUIS_INVITE, true)).rejects.toThrow(
        'Only the person who was asked can answer'
      );
    });

    test('an invitation already answered cannot be answered again', async () => {
      setSessionUserId('u-luis');
      await respondToAdviserRequest(LUIS_INVITE, true);
      await expect(respondToAdviserRequest(LUIS_INVITE, false)).rejects.toThrow(
        'That adviser request has already been answered'
      );
    });

    test('and one the owner withdrew cannot be accepted out from under them', async () => {
      setSessionUserId('u-alexis');
      const { cancelAdviserRequest } = await import('./client');
      await cancelAdviserRequest(DEGREE);

      setSessionUserId('u-luis');
      await expect(respondToAdviserRequest(LUIS_INVITE, true)).rejects.toThrow(
        'already been answered'
      );
    });

    test('an invitation that does not exist is an error', async () => {
      setSessionUserId('u-luis');
      await expect(respondToAdviserRequest('ar-nope', true)).rejects.toThrow(
        'Adviser request not found'
      );
    });

    test('and an answer that is neither accept nor decline is refused', async () => {
      setSessionUserId('u-luis');
      await expect(respondToAdviserRequest(LUIS_INVITE, undefined)).rejects.toThrow(
        'accept or decline'
      );
    });

    test('a refused answer tells nobody and changes nothing', async () => {
      setSessionUserId('u-sofia');

      await expect(respondToAdviserRequest(LUIS_INVITE, true)).rejects.toThrow();

      expect(notifications).toHaveLength(0);
      expect(adviserRequests.find((r) => r.id === LUIS_INVITE).status).toBe('pending');
    });
  });
});

// --- advising more than one, and stepping down ---------------------------

describe('what an adviser holds', () => {
  test('one person can advise several projects', async () => {
    setSessionUserId('u-luis');
    await respondToAdviserRequest(LUIS_INVITE, true);

    // u-dana already advises p-parking; give Luis a second one as well.
    setSessionUserId('u-omar');
    await inviteAdviser(LAB, 'u-luis');
    setSessionUserId('u-luis');
    const [invite] = await getMyAdviserRequests();
    await respondToAdviserRequest(invite.id, true);

    const advised = await getAdvisedProjects();
    expect(advised.map((p) => p.id).sort()).toEqual([DEGREE, LAB].sort());
  });

  test('getAdvisedProjects is per caller and shaped like any other project', async () => {
    setSessionUserId('u-dana');

    const [project] = await getAdvisedProjects();

    expect(project.id).toBe(PARKING);
    expect(project).toMatchObject({ title: 'Campus parking tracker', member_count: 2 });
    expect(project.members.map((m) => m.user_id)).not.toContain('u-dana');
  });

  test('somebody who advises nothing gets nothing', async () => {
    setSessionUserId('u-sofia');
    expect(await getAdvisedProjects()).toEqual([]);
  });

  test('stepping down ends the link and tells the owner', async () => {
    setSessionUserId('u-dana');

    await stepDownAsAdviser(PARKING);

    expect(await getAdvisedProjects()).toEqual([]);
    expect(noticesFor('u-nicolas', 'adviser_stepped_down')).toHaveLength(1);
    // Which direction it went lives in the notification, not the status.
    expect(noticesFor('u-dana', 'adviser_removed')).toHaveLength(0);
    expect(adviserRequests.find((r) => r.id === 'ar-1').status).toBe('cancelled');
  });

  test('and frees the project to invite somebody new', async () => {
    setSessionUserId('u-dana');
    await stepDownAsAdviser(PARKING);

    setSessionUserId('u-nicolas');
    await expect(inviteAdviser(PARKING, 'u-sofia')).resolves.toMatchObject({ status: 'pending' });
  });

  test('somebody who is not the adviser cannot step down from it', async () => {
    setSessionUserId('u-sofia');
    await expect(stepDownAsAdviser(PARKING)).rejects.toThrow(
      'You are not the adviser for this project'
    );
  });

  test('and neither can the owner, who has remove for that', async () => {
    setSessionUserId('u-nicolas');
    await expect(stepDownAsAdviser(PARKING)).rejects.toThrow('You are not the adviser');
  });

  test('stepping down twice is an error, not a silent no-op', async () => {
    setSessionUserId('u-dana');
    await stepDownAsAdviser(PARKING);
    await expect(stepDownAsAdviser(PARKING)).rejects.toThrow('You are not the adviser');
  });
});

// --- THE SEAT RULE, against an adviser who really accepted ---------------

describe('accepting gives no seat', () => {
  test('the roster, the count and the fill state are all untouched', async () => {
    setSessionUserId('u-alexis');
    const before = await getProject(DEGREE);

    setSessionUserId('u-luis');
    await respondToAdviserRequest(LUIS_INVITE, true);

    setSessionUserId('u-alexis');
    const after = await getProject(DEGREE);

    expect(after.member_count).toBe(before.member_count);
    expect(after.status).toBe(before.status);
    expect(after.members).toEqual(before.members);
    expect(after.members.map((m) => m.user_id)).not.toContain('u-luis');
  });

  test('and the adviser keeps the team of their own they already had', async () => {
    // u-luis is on t-scam in the fixtures: advising must not disturb that.
    const before = teamMembers.filter((m) => m.user_id === 'u-luis').length;
    expect(before).toBe(1);

    setSessionUserId('u-luis');
    await respondToAdviserRequest(LUIS_INVITE, true);

    expect(teamMembers.filter((m) => m.user_id === 'u-luis')).toHaveLength(1);
  });
});
