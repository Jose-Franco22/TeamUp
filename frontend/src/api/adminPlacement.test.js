// Issues #38 and #39 in mock mode: milestones, the formation deadline, and an
// admin placing students. Mirrors supabase/26_milestones.sql and
// 27_admin_placement.sql; the pgTAP tests there are the real boundary.
import { afterEach, expect, test } from 'vitest';
import {
  adminAssignStudent, adminMoveStudent, createJoinRequest, createProject, deleteMilestone,
  getAdminActions, getMilestones, removeMember, saveMilestone, setSessionUserId,
} from './client';
import { formationDeadline, notifications, projectRolesNeeded, projects, setFormationDeadline, teamMembers } from './mockData';
import { ValidationError } from '../lib/validation';

const ADMIN = 'u-instructor';
const teamOf = (userId) => teamMembers.find((tm) => tm.user_id === userId)?.team_id ?? null;
const noticesFor = (userId, kind) => notifications.filter((n) => n.user_id === userId && n.kind === kind);

afterEach(() => {
  setSessionUserId(null);
  setFormationDeadline(null);
});

// --- #39 ---------------------------------------------------------------------

test('students can\'t assign or move anyone', async () => {
  setSessionUserId('u-adan');
  await expect(adminAssignStudent('u-sofia', 't-degree', 'r-frontend')).rejects.toThrow('Admin access required');
  await expect(adminMoveStudent('u-jose', 't-degree', 'r-frontend')).rejects.toThrow('Admin access required');
  await expect(getAdminActions()).rejects.toThrow('Admin access required');
});

test('an admin assigns an unplaced student to a team with an open seat', async () => {
  setSessionUserId(ADMIN);
  await adminAssignStudent('u-sofia', 't-degree', 'r-frontend');

  expect(teamOf('u-sofia')).toBe('t-degree');
  expect(projectRolesNeeded.find((n) => n.project_id === 'p-degree' && n.role_id === 'r-frontend').quantity_needed).toBe(0);
  expect(noticesFor('u-sofia', 'member_assigned')).toMatchObject([{ project_id: 'p-degree', actor_id: ADMIN, by_admin: true }]);
  expect(noticesFor('u-alexis', 'member_added')).toMatchObject([{ project_id: 'p-degree', actor_id: 'u-sofia', by_admin: true }]);
  expect((await getAdminActions())[0]).toMatchObject({
    action: 'assign', admin_name: 'Course Instructor', student_name: 'Sofia Garza',
    to_project_title: projects.find((p) => p.id === 'p-degree').title, role_name: 'Frontend Developer',
  });
});

test('assigning to a full team, or a student who has a team, is refused', async () => {
  setSessionUserId(ADMIN);
  await expect(adminAssignStudent('u-marcus', 't-lab', 'r-backend')).rejects.toThrow('This team is already full');
  await expect(adminAssignStudent('u-jose', 't-degree', 'r-backend')).rejects.toThrow('move them instead');
  await expect(adminAssignStudent('u-marcus', 't-degree', '')).rejects.toThrow('Pick a role');
  expect(teamOf('u-marcus')).toBeNull();
});

test('moving a student settles both teams and tells everyone involved', async () => {
  setSessionUserId(ADMIN);
  await adminMoveStudent('u-sofia', 't-parking', 'r-frontend');

  expect(teamOf('u-sofia')).toBe('t-parking');
  expect(noticesFor('u-alexis', 'member_left')).toMatchObject([{ actor_id: 'u-sofia', by_admin: true }]);
  expect(noticesFor('u-nicolas', 'member_added')).toMatchObject([{ actor_id: 'u-sofia', by_admin: true }]);
  expect(noticesFor('u-sofia', 'member_assigned').at(-1)).toMatchObject({ project_id: 'p-parking' });
  expect((await getAdminActions())[0]).toMatchObject({ action: 'move', student_name: 'Sofia Garza' });
});

test('a creator can\'t be moved, and nobody moves onto their own team', async () => {
  setSessionUserId(ADMIN);
  await expect(adminMoveStudent('u-alexis', 't-parking', 'r-pm')).rejects.toThrow("creator can't be moved");
  await expect(adminMoveStudent('u-sofia', 't-parking', 'r-pm')).rejects.toThrow('already on this team');
  await expect(adminMoveStudent('u-marcus', 't-parking', 'r-pm')).rejects.toThrow('assign them instead');
});

// --- #38 ---------------------------------------------------------------------

test('after the deadline students are locked out, but admins can still place and remove', async () => {
  setFormationDeadline('2020-01-01T00:00:00Z');

  setSessionUserId('u-marcus');
  await expect(createJoinRequest('p-parking')).rejects.toThrow('so new join requests are closed');
  await expect(createProject({
    title: 'Too late project', description: 'Posted after rosters locked for the class.',
    team_size_target: 2, creator_role_id: 'r-backend', roles_needed: [],
  })).rejects.toThrow("so new projects can't be posted");

  setSessionUserId(ADMIN);
  await adminAssignStudent('u-marcus', 't-degree', 'r-backend');
  expect(teamOf('u-marcus')).toBe('t-degree');
  await removeMember('u-marcus');
  expect(teamOf('u-marcus')).toBeNull();
  expect((await getAdminActions())[0]).toMatchObject({ action: 'remove', student_name: 'Marcus Hall' });
});

test('before the deadline the same student can still request', async () => {
  setFormationDeadline('2999-01-01T00:00:00Z');
  setSessionUserId('u-marcus');
  await expect(createJoinRequest('p-parking')).resolves.toMatchObject({ status: 'pending' });
});

test('only admins change milestones, and only one is the formation deadline', async () => {
  setSessionUserId('u-adan');
  await expect(saveMilestone({ name: 'Proposal', due_at: '2026-11-01T12:00' })).rejects.toThrow('Admin access required');

  setSessionUserId(ADMIN);
  await expect(saveMilestone({ name: ' ', due_at: '' })).rejects.toBeInstanceOf(ValidationError);
  const first = await saveMilestone({ name: 'Teams due', due_at: '2026-11-01T23:59', is_formation_deadline: true });
  const second = await saveMilestone({ name: 'Teams due (late)', due_at: '2026-11-08T23:59', is_formation_deadline: true });
  const list = await getMilestones();
  expect(list.filter((m) => m.is_formation_deadline).map((m) => m.id)).toEqual([second.id]);
  expect(formationDeadline()).toBe(second.due_at);

  await saveMilestone({ ...first, name: 'Teams due (original)', is_formation_deadline: false });
  expect((await getMilestones()).find((m) => m.id === first.id).name).toBe('Teams due (original)');

  await deleteMilestone(second.id);
  expect(formationDeadline()).toBeNull();
});
