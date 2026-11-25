// Issue #61 — closing a semester and starting the next, through the client
// in mock mode.
//
// supabase/tests/semesters.test.sql and semester_archive.test.sql are the
// boundary. These are here because mock mode is what the components and the
// demo run against: its refusals are spelled the way the SQL spells them,
// and after a close its reads answer the way RLS does, or the Admin page
// shows one thing and the database enforces another.
//
// From mockData.js, Fall 2026 starts with 4 teams and 8 students on them;
// 3 pending join requests (Adan to parking and degree, Rita to parking);
// Luis's unanswered invitation to advise degree; and Dana advising parking.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  closeSemester,
  createJoinRequest,
  createProject,
  exportRosters,
  getAdviserDashboard,
  getCurrentSemester,
  getMilestones,
  getMyTeam,
  getPastSemesters,
  getPastTeam,
  getProject,
  getProjects,
  getRequests,
  getSemesterClosePreview,
  isAdviser,
  myAdvising,
  saveMilestone,
  setSessionUserId,
  startSemester,
  updateProject,
} from './client';
import {
  adviserRequests,
  announcements,
  joinRequests,
  milestones,
  nextSteps,
  notifications,
  projectRolesNeeded,
  projects,
  semesters,
  teamMembers,
  teams,
} from './mockData';
import { ValidationError } from '../lib/validation';

const ADMIN = 'u-instructor';
const FALL = 'sem-fall-2026';
const ARCHIVED = 'Fall 2026 has been closed — past semesters are read-only';
const NO_SEMESTER = 'No semester is open right now — an admin has to start the next one first';

// Every array closing or starting touches, restored after each test.
const ARRAYS = {
  semesters, projects, teams, teamMembers, joinRequests, adviserRequests,
  notifications, milestones, nextSteps, announcements, projectRolesNeeded,
};
const saved = {};
const counts = () => Object.fromEntries(Object.entries(ARRAYS).map(([k, a]) => [k, a.length]));

beforeEach(() => {
  for (const [name, arr] of Object.entries(ARRAYS)) saved[name] = arr.map((row) => ({ ...row }));
});

afterEach(() => {
  for (const [name, arr] of Object.entries(ARRAYS)) arr.splice(0, arr.length, ...saved[name]);
  setSessionUserId(null);
});

async function closeFall() {
  setSessionUserId(ADMIN);
  return closeSemester(FALL, 'Fall 2026');
}

// A formation deadline a month out, and dates around it.
function springInput(overrides = {}) {
  const deadline = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const end = new Date(Date.now() + 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  return {
    name: 'Spring 2027',
    starts_on: new Date().toISOString().slice(0, 10),
    ends_on: end,
    formation_deadline: deadline.toISOString(),
    ...overrides,
  };
}

describe('the current semester', () => {
  test('is Fall 2026, with its dates', async () => {
    setSessionUserId('u-adan');
    expect(await getCurrentSemester()).toEqual({
      id: FALL, name: 'Fall 2026', starts_on: '2026-08-24', ends_on: '2026-12-12', formation_deadline: null,
    });
  });

  test("the close preview counts what closing will touch, for admins only", async () => {
    setSessionUserId(ADMIN);
    expect(await getSemesterClosePreview()).toEqual({
      semester_id: FALL, name: 'Fall 2026', starts_on: '2026-08-24', ends_on: '2026-12-12',
      teams: 4, students: 8, pending_join_requests: 3, pending_adviser_requests: 1, adviser_links: 1,
    });
    setSessionUserId('u-adan');
    await expect(getSemesterClosePreview()).rejects.toThrow('Admin access required');
  });
});

describe('closing', () => {
  test('is for admins only', async () => {
    setSessionUserId('u-nicolas');
    await expect(closeSemester(FALL, 'Fall 2026')).rejects.toThrow('Admin access required');
    expect(semesters[0].closed_at).toBeNull();
  });

  test('needs the name typed exactly — case, spaces and all', async () => {
    setSessionUserId(ADMIN);
    for (const typed of ['fall 2026', 'Fall 2026 ', 'Fall', '', null]) {
      await expect(closeSemester(FALL, typed)).rejects.toThrow('Type the semester name exactly as shown to confirm');
    }
    expect(semesters[0].closed_at).toBeNull();
  });

  test('reports what the preview showed, and deletes nothing', async () => {
    setSessionUserId(ADMIN);
    const preview = await getSemesterClosePreview();
    const before = counts();
    const summary = await closeSemester(FALL, 'Fall 2026');
    expect(summary).toEqual({ ...preview, closed_at: expect.any(String) });
    expect(counts()).toEqual(before);
    expect(semesters[0]).toMatchObject({ closed_at: summary.closed_at, closed_by: ADMIN });
  });

  test('cancels pending requests and keeps every answered one as it was', async () => {
    notifications.push({ id: 'n-x', user_id: 'u-nicolas', kind: 'join_request', project_id: 'p-parking', actor_id: 'u-adan', read_at: null });
    await closeFall();
    expect(joinRequests.map((r) => [r.id, r.status])).toEqual([
      ['jr-1', 'cancelled'], ['jr-2', 'cancelled'], ['jr-3', 'cancelled'], ['jr-4', 'declined'],
    ]);
    expect(adviserRequests.find((r) => r.id === 'ar-2').status).toBe('cancelled');
    // The record that Dana advised parking stays; the link ends with the semester.
    expect(adviserRequests.find((r) => r.id === 'ar-1').status).toBe('accepted');
    expect(notifications.find((n) => n.id === 'n-x').read_at).not.toBeNull();
  });

  test('a closed semester cannot be closed again', async () => {
    await closeFall();
    await expect(closeSemester(FALL, 'Fall 2026')).rejects.toThrow('Fall 2026 is already closed');
  });
});

describe('after closing, reads default to the current semester — which is none', () => {
  beforeEach(closeFall);

  test('Browse is empty, and an archived project is not found', async () => {
    setSessionUserId('u-adan');
    expect(await getProjects({ onlyOpen: false })).toEqual([]);
    await expect(getProject('p-parking')).rejects.toThrow('Project not found');
  });

  test('nobody has a team, nobody has requests, nobody is advising', async () => {
    setSessionUserId('u-nicolas');
    expect(await getMyTeam()).toBeNull();
    expect(await getRequests()).toEqual({ incoming: [], outgoing: [] });
    setSessionUserId('u-dana');
    expect(await isAdviser()).toBe(false);
    expect(await getAdviserDashboard()).toEqual([]);
    expect((await myAdvising()).advising).toBe(0);
  });

  test("the admin's export and the schedule are empty too", async () => {
    milestones.push({ id: 'ms-fall', name: 'Proposal', due_at: '2026-12-01T18:00:00Z', is_formation_deadline: false, semester_id: FALL });
    setSessionUserId(ADMIN);
    const exported = await exportRosters();
    expect(exported.teams).toEqual([]);
    expect(exported.members).toEqual([]);
    expect(await getMilestones()).toEqual([]);
  });

  test('archived teams refuse writes in the same sentence the database uses', async () => {
    setSessionUserId('u-alexis');
    await expect(
      updateProject(
        'p-degree',
        {
          title: 'Degree plan builder', description: 'Constraint solver for graduation paths.',
          team_size_target: 3, own_role_id: 'r-fullstack', roles_needed: [],
        },
        { memberCount: 1 }
      )
    ).rejects.toThrow(ARCHIVED);
    setSessionUserId('u-rita');
    await expect(createJoinRequest('p-degree')).rejects.toThrow(ARCHIVED);
    setSessionUserId(ADMIN);
    milestones.push({ id: 'ms-fall', name: 'Proposal', due_at: '2026-12-01T18:00:00Z', is_formation_deadline: false, semester_id: FALL });
    await expect(saveMilestone({ id: 'ms-fall', name: 'Proposal (late)', due_at: '2026-12-02T18:00:00Z' })).rejects.toThrow(ARCHIVED);
  });

  test('with no semester open, nothing new can start', async () => {
    setSessionUserId('u-nicolas');
    await expect(
      createProject({
        title: 'Campus shuttle tracker', description: 'Live shuttle positions on a campus map.',
        team_size_target: 2, creator_role_id: 'r-backend', roles_needed: [],
      })
    ).rejects.toThrow(NO_SEMESTER);
    setSessionUserId(ADMIN);
    await expect(saveMilestone({ name: 'Demo day', due_at: '2027-04-01T18:00:00Z' })).rejects.toThrow(NO_SEMESTER);
  });
});

describe('starting the next semester', () => {
  test('is refused while one is open', async () => {
    setSessionUserId(ADMIN);
    await expect(startSemester(springInput())).rejects.toThrow('Close Fall 2026 before starting the next semester');
  });

  test('checks the form before asking the database', async () => {
    await closeFall();
    const bad = startSemester(springInput({ name: ' ', formation_deadline: new Date(Date.now() - 60000).toISOString() }));
    await expect(bad).rejects.toBeInstanceOf(ValidationError);
    await expect(bad).rejects.toMatchObject({
      fieldErrors: {
        name: 'Give the semester a name',
        formation_deadline: 'The team formation deadline has to be in the future',
      },
    });
    await expect(startSemester(springInput({ ends_on: '2020-01-01' }))).rejects.toMatchObject({
      fieldErrors: { ends_on: 'The semester has to end after it starts' },
    });
  });

  test('refuses a name already used, whatever the case', async () => {
    await closeFall();
    await expect(startSemester(springInput({ name: 'fall 2026' }))).rejects.toThrow('There is already a semester called fall 2026');
  });

  test('makes it current with its formation deadline, and every student is free again', async () => {
    await closeFall();
    const input = springInput();
    const spring = await startSemester(input);
    expect(spring).toEqual({
      id: expect.any(String), name: 'Spring 2027', starts_on: input.starts_on, ends_on: input.ends_on,
      formation_deadline: input.formation_deadline,
    });
    setSessionUserId('u-adan');
    expect(await getCurrentSemester()).toEqual(spring);

    // Nicolas created an archived project; Adan's requests were cancelled.
    setSessionUserId('u-nicolas');
    const project = await createProject({
      title: 'Campus shuttle tracker', description: 'Live shuttle positions on a campus map.',
      team_size_target: 3, creator_role_id: 'r-backend', roles_needed: [],
    });
    expect((await getMyTeam()).id).toBe(project.id);
    setSessionUserId('u-adan');
    await expect(createJoinRequest(project.id)).resolves.toMatchObject({ status: 'pending' });
    expect((await getProjects({ onlyOpen: false })).map((p) => p.title)).toEqual(['Campus shuttle tracker']);
  });
});

describe('past semesters', () => {
  beforeEach(closeFall);

  test('a student sees their own archived team, and only theirs', async () => {
    setSessionUserId('u-nicolas');
    const [fall] = await getPastSemesters();
    expect(fall).toMatchObject({ id: FALL, name: 'Fall 2026', closed_at: expect.any(String) });
    expect(fall.teams.map((t) => [t.title, t.is_member, t.adviser_name])).toEqual([
      ['Campus parking tracker', true, 'Dana Kim'],
    ]);
  });

  test('an adviser sees the team they advised', async () => {
    setSessionUserId('u-dana');
    const [fall] = await getPastSemesters();
    const titles = fall.teams.map((t) => [t.title, t.is_adviser]);
    expect(titles).toContainEqual(['Campus parking tracker', true]);
  });

  test('somebody with no team that semester has no past semesters', async () => {
    setSessionUserId('u-adan');
    expect(await getPastSemesters()).toEqual([]);
  });

  test('an admin sees every team', async () => {
    setSessionUserId(ADMIN);
    const [fall] = await getPastSemesters();
    expect(fall.teams.map((t) => t.title)).toEqual([
      'Campus parking tracker', 'Degree plan builder', 'Lab equipment sign-out', 'Scam text detector',
    ]);
  });

  test('one past team opens for its members and is refused to everyone else', async () => {
    setSessionUserId('u-jose');
    const team = await getPastTeam('p-parking');
    expect(team).toMatchObject({ title: 'Campus parking tracker', adviser: { id: 'u-dana', name: 'Dana Kim' } });
    expect(team.members.map((m) => m.name)).toEqual(['Jose Franco Garza', 'Nicolas Guerra']);
    expect(team.semester).toMatchObject({ id: FALL, name: 'Fall 2026' });

    setSessionUserId('u-adan');
    await expect(getPastTeam('p-parking')).rejects.toThrow('Only the team, its adviser and admins can see a past team');
    await expect(getPastTeam('p-nope')).rejects.toThrow('Team not found');
  });
});

test('a current team is not a past one', async () => {
  setSessionUserId('u-nicolas');
  await expect(getPastTeam('p-parking')).rejects.toThrow('That team is in the current semester');
});
