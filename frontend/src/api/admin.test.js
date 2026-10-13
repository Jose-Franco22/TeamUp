// Issue #36: mock permissions and roster privacy mirror the database.
import { afterEach, expect, test } from 'vitest';
import {
  createJoinRequest, createProject, getAdminAccess, getCurrentUser,
  getProjects, setSessionUserId, updateCurrentUser,
} from './client';
import { rankProjects } from '../lib/browseFilters';

afterEach(() => setSessionUserId(null));

test('only an instructor passes the admin API guard', async () => {
  setSessionUserId('u-adan');
  await expect(getAdminAccess()).rejects.toThrow('Admin access required');
  setSessionUserId('u-instructor');
  await expect(getAdminAccess()).resolves.toBe(true);
});

test('admins cannot create projects or request to join student teams', async () => {
  setSessionUserId('u-instructor');
  await expect(createJoinRequest('p-parking')).rejects.toThrow('Admin accounts cannot create or join');
  await expect(createProject({
    title: 'Instructor project', description: 'This must never be created.',
    team_size_target: 2, creator_role_id: 'r-pm', roles_needed: [],
  })).rejects.toThrow('Admin accounts cannot create or join');
});

test('admin accounts never get student match scores or appear on rosters', async () => {
  setSessionUserId('u-instructor');
  const me = await getCurrentUser();
  const all = await getProjects({ onlyOpen: false });
  expect(all.flatMap((p) => p.members).map((m) => m.user_id)).not.toContain(me.id);
  expect(all.some((p) => p.members.length > 0)).toBe(true);
  expect(rankProjects(all, { student: { ...me, skills: [{ id: 's-react' }] } })
    .every((entry) => entry.fit === null)).toBe(true);
});

test('a seeker sees who is on other teams before asking to join', async () => {
  setSessionUserId('u-adan');
  const parking = (await getProjects({ onlyOpen: false })).find((p) => p.id === 'p-parking');
  expect(parking.members).toHaveLength(2);
  expect(parking.member_count).toBe(2);
});

test('guests get seat counts but no roster identities', async () => {
  const parking = (await getProjects({ onlyOpen: false })).find((p) => p.id === 'p-parking');
  expect(parking).toMatchObject({ members: [], member_count: 2, avg_availability_hours: null });
});

test('profile updates never grant admin access', async () => {
  setSessionUserId('u-adan');
  const updated = await updateCurrentUser({ is_admin: true });
  expect(updated.is_admin).toBe(false);
});
