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

test('a seeker sees counts without other teams raw membership rows', async () => {
  setSessionUserId('u-adan');
  const all = await getProjects({ onlyOpen: false });
  expect(all.every((p) => p.members.length === 0)).toBe(true);
  expect(all.find((p) => p.id === 'p-parking').member_count).toBe(2);
});

test('teammates can still see their own full roster', async () => {
  setSessionUserId('u-jose');
  const all = await getProjects({ onlyOpen: false });
  expect(all.find((p) => p.id === 'p-parking').members).toHaveLength(2);
  expect(all.find((p) => p.id === 'p-degree').members).toEqual([]);
});

test('profile updates never grant admin access', async () => {
  setSessionUserId('u-adan');
  const updated = await updateCurrentUser({ is_admin: true });
  expect(updated.is_admin).toBe(false);
});
