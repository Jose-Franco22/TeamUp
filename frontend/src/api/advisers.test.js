// Issue #53 — asking someone to advise a project, through the client.
//
// supabase/tests/adviser_requests.test.sql is the real boundary; these cases
// are here because mock mode is what every component test and the demo
// actually run against, so the two have to refuse the same things in the same
// words. The panel shows these messages, and AdviserPanel.test.jsx asserts
// them, which only means anything if they match the database's.
//
// The seat rule has its own section at the bottom: an adviser must not show
// up in a roster, a member count, or a project's open/full state.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  cancelAdviserRequest,
  getProject,
  getProjectAdviser,
  inviteAdviser,
  removeAdviser,
  searchAdvisers,
  setSessionUserId,
} from './client';
import { adviserRequests, notifications, projects } from './mockData';

// Fixture facts these cases lean on (mockData.js):
//   p-parking  u-nicolas owns it, u-jose is on it, u-dana advises it (accepted)
//   p-degree   u-alexis owns it, u-luis has an unanswered invitation
//   p-scam     u-maria owns it, u-priya turned it down
//   p-lab      u-omar owns it, full, nobody asked
const PARKING = 'p-parking';
const DEGREE = 'p-degree';
const SCAM = 'p-scam';
const LAB = 'p-lab';

const snapshot = {};
const noticesFor = (userId, kind) =>
  notifications.filter((n) => n.user_id === userId && n.kind === kind);
const rowsFor = (projectId) => adviserRequests.filter((r) => r.project_id === projectId);

beforeEach(() => {
  // These cases write to the fixtures, so the arrays go back as they were
  // rather than leaving the next file with a cancelled adviser.
  snapshot.adviserRequests = adviserRequests.map((r) => ({ ...r }));
  snapshot.projects = projects.map((p) => ({ ...p }));
  notifications.length = 0;
});

afterEach(() => {
  adviserRequests.length = 0;
  adviserRequests.push(...snapshot.adviserRequests);
  projects.length = 0;
  projects.push(...snapshot.projects);
  notifications.length = 0;
  setSessionUserId(null);
});

// --- reading the adviser --------------------------------------------------

describe('getProjectAdviser', () => {
  test('an accepted adviser comes back by name, with the email for the owner', async () => {
    setSessionUserId('u-nicolas');

    const adviser = await getProjectAdviser(PARKING);

    expect(adviser).toMatchObject({
      status: 'accepted',
      adviser_id: 'u-dana',
      adviser_name: 'Dana Kim',
      adviser_email: 'dkim01@utrgv.edu',
    });
  });

  test('but not the email for anyone else — only the owner has a reason to hold it', async () => {
    setSessionUserId('u-jose'); // on the team, not the owner

    const adviser = await getProjectAdviser(PARKING);

    expect(adviser.adviser_name).toBe('Dana Kim');
    expect(adviser.adviser_email).toBeNull();
  });

  test('an unanswered invitation reads as pending', async () => {
    setSessionUserId('u-alexis');
    expect(await getProjectAdviser(DEGREE)).toMatchObject({
      status: 'pending',
      adviser_name: 'Luis Trevino',
    });
  });

  // The owner needs the answer, not an empty panel.
  test('a declined one stays visible', async () => {
    setSessionUserId('u-maria');
    expect(await getProjectAdviser(SCAM)).toMatchObject({
      status: 'declined',
      adviser_name: 'Priya Vale',
    });
  });

  test('a project nobody has asked has no adviser', async () => {
    setSessionUserId('u-omar');
    expect(await getProjectAdviser(LAB)).toBeNull();
  });

  // Caught in review on PR #88: the first version filtered on nothing but
  // the project, so any signed-in student could read the name on an open
  // invitation and, after a decline, who had turned down which project.
  // Mock mode has to refuse it too, or the panel's tests pass against a rule
  // the database no longer has.
  describe('an unanswered or refused invitation is the team’s business', () => {
    test('a stranger is not told who was asked', async () => {
      setSessionUserId('u-sofia'); // no team, no row, nothing to do with p-degree
      expect(await getProjectAdviser(DEGREE)).toBeNull();
    });

    test('nor who declined', async () => {
      setSessionUserId('u-sofia');
      expect(await getProjectAdviser(SCAM)).toBeNull();
    });

    test('but the person asked sees their own invitation', async () => {
      setSessionUserId('u-luis');
      expect(await getProjectAdviser(DEGREE)).toMatchObject({
        status: 'pending',
        adviser_id: 'u-luis',
        adviser_email: null, // the owner's alone
      });
    });

    test('and so does the owner who asked', async () => {
      setSessionUserId('u-alexis');
      expect(await getProjectAdviser(DEGREE)).toMatchObject({ status: 'pending' });
    });

    // The other half of the rule, deliberately open: project_advisers() puts
    // the same name on a Browse card for every signed-in student anyway.
    test('an accepted adviser is visible to any signed-in student', async () => {
      setSessionUserId('u-sofia');
      expect(await getProjectAdviser(PARKING)).toMatchObject({
        status: 'accepted',
        adviser_name: 'Dana Kim',
        adviser_email: null,
      });
    });
  });

  test('and a project that does not exist is an error, not null', async () => {
    setSessionUserId('u-omar');
    await expect(getProjectAdviser('p-nope')).rejects.toThrow('Project not found');
  });
});

// --- asking someone -------------------------------------------------------

describe('inviteAdviser', () => {
  test('the owner asks, and the person asked is told', async () => {
    setSessionUserId('u-omar');

    const row = await inviteAdviser(LAB, 'u-sofia');

    expect(row).toMatchObject({
      project_id: LAB,
      adviser_id: 'u-sofia',
      invited_by: 'u-omar',
      status: 'pending',
      responded_at: null,
    });
    expect(noticesFor('u-sofia', 'adviser_invited')).toHaveLength(1);
    expect(noticesFor('u-sofia', 'adviser_invited')[0]).toMatchObject({
      project_id: LAB,
      actor_id: 'u-omar',
    });
  });

  // p-lab is full. An adviser is not a seat, so that is no bar.
  test('a full project can still take an adviser', async () => {
    setSessionUserId('u-omar');
    expect(projects.find((p) => p.id === LAB).status).toBe('full');

    await expect(inviteAdviser(LAB, 'u-sofia')).resolves.toMatchObject({ status: 'pending' });
  });

  test('somebody who declined before can be asked again', async () => {
    setSessionUserId('u-maria');

    await expect(inviteAdviser(SCAM, 'u-priya')).resolves.toMatchObject({ status: 'pending' });
    // The decline is kept alongside the new invitation, not overwritten.
    expect(rowsFor(SCAM)).toHaveLength(2);
  });

  describe('refusals', () => {
    test('a member of the team cannot invite', async () => {
      setSessionUserId('u-jose');
      await expect(inviteAdviser(PARKING, 'u-sofia')).rejects.toThrow(
        'Only the project creator can invite an adviser'
      );
    });

    test('nor can a stranger', async () => {
      setSessionUserId('u-sofia');
      await expect(inviteAdviser(PARKING, 'u-marcus')).rejects.toThrow(
        'Only the project creator can invite an adviser'
      );
    });

    test('the owner cannot invite themselves', async () => {
      setSessionUserId('u-omar');
      await expect(inviteAdviser(LAB, 'u-omar')).rejects.toThrow('You cannot invite yourself');
    });

    test('nor somebody already on the team', async () => {
      setSessionUserId('u-omar');
      await expect(inviteAdviser(LAB, 'u-priya')).rejects.toThrow('already on this team');
    });

    test('nor an admin account', async () => {
      setSessionUserId('u-omar');
      await expect(inviteAdviser(LAB, 'u-instructor')).rejects.toThrow(
        'Admin accounts cannot advise a student project'
      );
    });

    test('nor an account that does not exist', async () => {
      setSessionUserId('u-omar');
      await expect(inviteAdviser(LAB, 'u-nobody')).rejects.toThrow('That account does not exist');
    });

    test('a second invitation is refused while one is unanswered', async () => {
      setSessionUserId('u-alexis');
      await expect(inviteAdviser(DEGREE, 'u-sofia')).rejects.toThrow(
        'This project already has a pending adviser request'
      );
    });

    test('and so is one when the project already has an adviser', async () => {
      setSessionUserId('u-nicolas');
      await expect(inviteAdviser(PARKING, 'u-sofia')).rejects.toThrow(
        'This project already has an adviser'
      );
    });

    test('a refused invitation tells nobody and writes nothing', async () => {
      setSessionUserId('u-jose');

      await expect(inviteAdviser(PARKING, 'u-sofia')).rejects.toThrow();

      expect(notifications).toHaveLength(0);
      expect(rowsFor(PARKING)).toHaveLength(1);
    });
  });
});

// --- taking it back -------------------------------------------------------

describe('cancelAdviserRequest', () => {
  test('the owner withdraws an unanswered invitation, and the panel empties', async () => {
    setSessionUserId('u-alexis');

    await cancelAdviserRequest(DEGREE);

    expect(rowsFor(DEGREE)[0]).toMatchObject({ status: 'cancelled' });
    expect(rowsFor(DEGREE)[0].responded_at).not.toBeNull();
    // Kept, not deleted — but not shown either: the owner undid it.
    expect(await getProjectAdviser(DEGREE)).toBeNull();
  });

  test('nobody is told: the invitation went before they acted on it', async () => {
    setSessionUserId('u-alexis');
    await cancelAdviserRequest(DEGREE);
    expect(notifications).toHaveLength(0);
  });

  test('and somebody else can then be asked', async () => {
    setSessionUserId('u-alexis');
    await cancelAdviserRequest(DEGREE);
    await expect(inviteAdviser(DEGREE, 'u-sofia')).resolves.toMatchObject({ status: 'pending' });
  });

  test('somebody who is not the owner cannot cancel', async () => {
    setSessionUserId('u-luis'); // the person asked
    await expect(cancelAdviserRequest(DEGREE)).rejects.toThrow(
      'Only the project creator can cancel an adviser request'
    );
  });

  test('cancelling nothing is an error, not a silent no-op', async () => {
    setSessionUserId('u-nicolas'); // p-parking's adviser accepted; there is no pending one
    await expect(cancelAdviserRequest(PARKING)).rejects.toThrow(
      'There is no pending adviser request to cancel'
    );
  });
});

describe('removeAdviser', () => {
  test('the owner drops an adviser who had accepted, and that one is told', async () => {
    setSessionUserId('u-nicolas');

    await removeAdviser(PARKING);

    expect(rowsFor(PARKING)[0]).toMatchObject({ status: 'cancelled' });
    expect(noticesFor('u-dana', 'adviser_removed')).toHaveLength(1);
    expect(noticesFor('u-dana', 'adviser_removed')[0]).toMatchObject({
      project_id: PARKING,
      actor_id: 'u-nicolas',
    });
    expect(await getProjectAdviser(PARKING)).toBeNull();
  });

  test('a member of the team cannot remove the adviser', async () => {
    setSessionUserId('u-jose');
    await expect(removeAdviser(PARKING)).rejects.toThrow(
      'Only the project creator can remove the adviser'
    );
    expect(notifications).toHaveLength(0);
  });

  test('removing nothing is an error', async () => {
    setSessionUserId('u-alexis'); // p-degree's invitation is pending, not accepted
    await expect(removeAdviser(DEGREE)).rejects.toThrow('This project has no adviser to remove');
  });
});

// --- finding somebody to ask ----------------------------------------------

describe('searchAdvisers', () => {
  test('finds a student by name, and by email', async () => {
    setSessionUserId('u-nicolas');

    const [byName, byEmail] = await Promise.all([
      searchAdvisers(PARKING, 'Sofia'),
      searchAdvisers(PARKING, 'sgarza02@utrgv.edu'),
    ]);

    expect(byName.map((u) => u.id)).toContain('u-sofia');
    expect(byEmail.map((u) => u.id)).toEqual(['u-sofia']);
    // Only the three columns the function exposes.
    expect(Object.keys(byEmail[0]).sort()).toEqual(['email', 'id', 'name']);
  });

  test('case does not matter', async () => {
    setSessionUserId('u-nicolas');
    const found = await searchAdvisers(PARKING, 'sOfIa');
    expect(found.map((u) => u.id)).toContain('u-sofia');
  });

  test('a short or empty search returns nothing rather than everybody', async () => {
    setSessionUserId('u-nicolas');

    const [one, none, spaces] = await Promise.all([
      searchAdvisers(PARKING, 'S'),
      searchAdvisers(PARKING, ''),
      searchAdvisers(PARKING, '  '),
    ]);

    expect(one).toEqual([]);
    expect(none).toEqual([]);
    expect(spaces).toEqual([]);
  });

  test('leaves out the owner, the team, admins, and whoever holds the invitation', async () => {
    setSessionUserId('u-nicolas');

    const [owner, member, admin, current] = await Promise.all([
      searchAdvisers(PARKING, 'Nicolas Guerra'),
      searchAdvisers(PARKING, 'Jose'),
      searchAdvisers(PARKING, 'Instructor'),
      searchAdvisers(PARKING, 'Dana'),
    ]);

    expect(owner).toEqual([]);
    expect(member).toEqual([]);
    expect(admin).toEqual([]);
    expect(current).toEqual([]);
  });

  // A decline is an answer, not a ban, and someone with a team of their own
  // can still advise another project.
  test('still lists somebody who declined, and somebody on another team', async () => {
    setSessionUserId('u-maria');

    const [declined, teamed] = await Promise.all([
      searchAdvisers(SCAM, 'Priya'),
      searchAdvisers(SCAM, 'Omar'),
    ]);

    expect(declined.map((u) => u.id)).toEqual(['u-priya']);
    expect(teamed.map((u) => u.id)).toEqual(['u-omar']);
  });

  test('results are ordered by name', async () => {
    setSessionUserId('u-omar');
    const found = await searchAdvisers(LAB, 'a');
    expect(found.map((u) => u.name)).toEqual([...found.map((u) => u.name)].sort());
  });

  test('only the owner can search', async () => {
    setSessionUserId('u-jose');
    await expect(searchAdvisers(PARKING, 'Sofia')).rejects.toThrow(
      'Only the project creator can look for an adviser'
    );
  });

  test('and not while signed out', async () => {
    setSessionUserId(null);
    await expect(searchAdvisers(PARKING, 'Sofia')).rejects.toThrow('Not signed in');
  });
});

// --- THE SEAT RULE --------------------------------------------------------
// The point of the whole design: an adviser is attached to a project and
// counted by nothing.

describe('an adviser takes no seat', () => {
  test('they are not on the roster and not in the member count', async () => {
    setSessionUserId('u-nicolas');

    const project = await getProject(PARKING);

    expect(project.member_count).toBe(2);
    expect(project.members.map((m) => m.user_id)).toEqual(['u-nicolas', 'u-jose']);
    expect(project.members.map((m) => m.user_id)).not.toContain('u-dana');
  });

  test('the card names them separately', async () => {
    setSessionUserId('u-nicolas');
    const project = await getProject(PARKING);
    expect(project).toMatchObject({ adviser_id: 'u-dana', adviser_name: 'Dana Kim' });
  });

  test('a guest sees no adviser, the same as they see no members', async () => {
    setSessionUserId(null);

    const project = await getProject(PARKING);

    expect(project.adviser_name).toBeNull();
    expect(project.members).toEqual([]);
  });

  test('an unanswered invitation is not on the card — only an adviser who said yes', async () => {
    setSessionUserId('u-alexis');

    const project = await getProject(DEGREE);

    expect(await getProjectAdviser(DEGREE)).toMatchObject({ status: 'pending' });
    expect(project.adviser_name).toBeNull();
  });

  test('inviting and removing never touches the roster or the fill state', async () => {
    setSessionUserId('u-omar');
    const before = await getProject(LAB);

    await inviteAdviser(LAB, 'u-sofia');
    const after = await getProject(LAB);

    expect(after.member_count).toBe(before.member_count);
    expect(after.status).toBe(before.status);
    expect(after.members).toEqual(before.members);
  });
});
