// Issue #37: exercise the shipped fixture data through the admin API.
import { afterEach, expect, test } from 'vitest';
import { getAdminDashboard, getAdminStudent, getAdminTeam, setSessionUserId } from './client';
import { teamMembers, users } from './mockData';

afterEach(() => setSessionUserId(null));

test('the dashboard lists all teams and exactly the unplaced non-admin students', async () => {
  setSessionUserId('u-instructor');
  const data = await getAdminDashboard();
  expect(data.summary).toEqual({ formed_teams: 1, open_teams: 3, unplaced_students: 6 });
  expect(data.teams).toHaveLength(4);
  const expected = users.filter((u) => !u.is_admin && !teamMembers.some((m) => m.user_id === u.id));
  expect(data.unplaced_students.map((s) => s.id).sort()).toEqual(expected.map((s) => s.id).sort());
  expect(data.unplaced_students.find((s) => s.id === 'u-sofia').pending_requests).toEqual([]);
  expect(data.unplaced_students.find((s) => s.id === 'u-adan').pending_requests.map((r) => r.id))
    .toEqual(['jr-3', 'jr-1']); // oldest first, excluding the declined jr-4
});

test('team details expose the complete roster and roles with links to pending applicants', async () => {
  setSessionUserId('u-instructor');
  const team = await getAdminTeam('t-parking');
  expect(team).toMatchObject({ id: 't-parking', project_id: 'p-parking', member_count: 2, status: 'open' });
  expect(team.members.map((m) => m.name)).toContain('Nicolas Guerra');
  expect(team.members.find((m) => m.user_id === 'u-jose').role_name).toBe('Data / ML');
  expect(team.pending_requests.map((r) => r.id)).toEqual(['jr-2', 'jr-1']);
});

test('any placed or unplaced student can be inspected without losing their team or pending links', async () => {
  setSessionUserId('u-instructor');
  const placed = await getAdminStudent('u-jose');
  expect(placed.membership).toMatchObject({ team_id: 't-parking', role_name: 'Data / ML' });
  const unplaced = await getAdminStudent('u-adan');
  expect(unplaced.membership).toBeNull();
  expect(unplaced.pending_requests.map((r) => r.team_id)).toEqual(['t-degree', 't-parking']);
  expect(unplaced.skills.some((s) => s.name === 'React')).toBe(true);
});

test.each([
  ['dashboard', () => getAdminDashboard()],
  ['team', () => getAdminTeam('t-parking')],
  ['student', () => getAdminStudent('u-jose')],
])('the %s API rejects students and guests', async (_name, load) => {
  setSessionUserId('u-adan');
  await expect(load()).rejects.toThrow('Admin access required');
  setSessionUserId(null);
  await expect(load()).rejects.toThrow('Not signed in');
});

test('missing records and instructor ids do not produce student details', async () => {
  setSessionUserId('u-instructor');
  await expect(getAdminTeam('missing')).rejects.toThrow('Team not found');
  await expect(getAdminStudent('missing')).rejects.toThrow('Student not found');
  await expect(getAdminStudent('u-instructor')).rejects.toThrow('Student not found');
});
