// Issue #40 — who the client lets export, and what they get back.
//
// supabase/tests/export_rosters.test.sql is the boundary that matters: an
// export is a file full of names and addresses that leaves the application,
// so the database decides. These cases are here because mock mode is what
// the demo runs on, and a scope rule the mock gets wrong means the button
// shows an instructor's whole roster to somebody who would be refused in
// production — or refuses somebody production would allow, which is the
// bug nobody notices until the demo.
//
// The order the refusals fire in is the SQL's order on purpose: signed in,
// then admin, then an *accepted* adviser, then no.
import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { exportRosters, setSessionUserId } from './client';
import { adviserRequests } from './mockData';

// From mockData.js: u-instructor is the admin; u-dana advises p-parking and
// happens to sit on a different team (t-scam), which #54 allows; u-luis
// holds an unanswered invitation to p-degree; u-rita is on no team at all.
const ADMIN = 'u-instructor';
const ADVISER = 'u-dana';
const ASKED = 'u-luis';
const MEMBER = 'u-nicolas';
const UNTEAMED = 'u-rita';

const snapshot = [];

beforeEach(() => {
  snapshot.length = 0;
  snapshot.push(...adviserRequests.map((r) => ({ ...r })));
});

afterEach(() => {
  adviserRequests.length = 0;
  adviserRequests.push(...snapshot);
  setSessionUserId(null);
});

describe('an admin', () => {
  test('gets every team, member and unplaced student', async () => {
    setSessionUserId(ADMIN);

    const data = await exportRosters();

    expect(data.scope).toBe('admin');
    expect(data.teams.length).toBeGreaterThan(1);
    expect(data.members.length).toBeGreaterThan(1);
    expect(data.unplaced_students.length).toBeGreaterThan(0);
  });

  // An instructor is not a student. The trigger in 18_admin_access.sql keeps
  // admins off rosters; this sheet has to agree, or the export an instructor
  // downloads has their own name in the unplaced column.
  test('is not in their own export', async () => {
    setSessionUserId(ADMIN);

    const data = await exportRosters();

    expect(data.members.some((m) => m.user_id === ADMIN)).toBe(false);
    expect(data.unplaced_students.some((s) => s.user_id === ADMIN)).toBe(false);
  });

  test('gets the columns the sheets are made of', async () => {
    setSessionUserId(ADMIN);

    const data = await exportRosters();

    expect(data.teams[0]).toMatchObject({
      team_name: expect.any(String),
      status: expect.any(String),
      owner_name: expect.any(String),
      owner_email: expect.stringContaining('@'),
      member_count: expect.any(Number),
      team_size_target: expect.any(Number),
      adviser_status: expect.any(String),
    });
    expect(data.members[0]).toMatchObject({
      team_name: expect.any(String),
      email: expect.stringContaining('@'),
      role_name: expect.any(String),
      is_owner: expect.any(Boolean),
    });
  });

  // The seeded fixtures had no joined_at while the real column is
  // `not null default now()`, so the Joined column was blank in mock mode
  // and filled in production until #40 noticed.
  test('and every member row carries the date they joined', async () => {
    setSessionUserId(ADMIN);

    const data = await exportRosters();

    expect(data.members.every((m) => typeof m.joined_at === 'string')).toBe(true);
  });

  test('the three adviser states come back as states, not words', async () => {
    setSessionUserId(ADMIN);

    const data = await exportRosters();

    const statuses = new Set(data.teams.map((t) => t.adviser_status));
    expect(statuses.has('accepted')).toBe(true);
    expect(statuses.has('pending')).toBe(true);
    const accepted = data.teams.find((t) => t.adviser_status === 'accepted');
    expect(accepted.adviser_email).toContain('@');
    const pending = data.teams.find((t) => t.adviser_status === 'pending');
    expect(pending.adviser_name).toBeNull();
  });
});

describe('an adviser', () => {
  test('gets the teams they advise and no others', async () => {
    setSessionUserId(ADVISER);

    const data = await exportRosters();

    expect(data.scope).toBe('adviser');
    expect(data.teams).toHaveLength(1);
    expect(data.teams[0].team_name).toBe('Campus parking tracker');
  });

  // u-dana sits on t-scam as well as advising p-parking. Scope is the teams
  // they advise, not the teams they touch.
  test('not the team they happen to sit on', async () => {
    setSessionUserId(ADVISER);

    const data = await exportRosters();

    expect(data.members.some((m) => m.user_id === ADVISER)).toBe(false);
    expect(data.members.every((m) => m.team_name === 'Campus parking tracker')).toBe(true);
  });

  // THE CRITERION. A student with no team is nobody's advisee.
  test('and no unplaced students at all', async () => {
    setSessionUserId(ADVISER);

    const data = await exportRosters();

    expect(data.unplaced_students).toEqual([]);
  });
});

describe('everybody else is refused', () => {
  test('a student on a team', async () => {
    setSessionUserId(MEMBER);
    await expect(exportRosters()).rejects.toThrow(/admin or an adviser/i);
  });

  test('a student on no team', async () => {
    setSessionUserId(UNTEAMED);
    await expect(exportRosters()).rejects.toThrow(/admin or an adviser/i);
  });

  // Being asked is not advising. This is the case that fails first if the
  // scope check ever reads adviser_requests without looking at the status.
  test('somebody holding an unanswered invitation', async () => {
    setSessionUserId(ASKED);
    await expect(exportRosters()).rejects.toThrow(/admin or an adviser/i);
  });

  test('and somebody who turned one down', async () => {
    const row = adviserRequests.find((r) => r.adviser_id === ASKED);
    row.status = 'declined';
    setSessionUserId(ASKED);
    await expect(exportRosters()).rejects.toThrow(/admin or an adviser/i);
  });

  test('signed out, before any of that', async () => {
    setSessionUserId(null);
    await expect(exportRosters()).rejects.toThrow(/not signed in/i);
  });
});
