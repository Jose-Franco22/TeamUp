// Issue #36: real-mode RPC authorization and Browse after roster RLS.
import { beforeEach, expect, test, vi } from 'vitest';
import { DASHBOARD, OPEN_TEAM, UNPLACED_STUDENT } from '../test/adminFixtures';

const fake = vi.hoisted(() => {
  const state = { viewerId: 'seeker', projects: [], requests: [], stats: {}, adminError: null };
  const supabase = {
    auth: { getSession: vi.fn(async () => ({ data: {
      session: state.viewerId ? { user: { id: state.viewerId } } : null,
    } })) },
    from: vi.fn((table) => {
      let rows = table === 'projects' ? state.projects : state.requests;
      const query = {
        select: () => query,
        eq: (column, value) => { rows = rows.filter((r) => r[column] === value); return query; },
        order: () => query,
        single: async () => ({ data: rows[0], error: null }),
        then: (resolve) => resolve({ data: rows, error: null }),
      };
      return query;
    }),
    rpc: vi.fn(async (name, args) => {
      if (name === 'require_admin') return { data: null, error: state.adminError };
      if (['admin_dashboard', 'admin_team_details', 'admin_student_details'].includes(name)) {
        return { data: state.adminResponse, error: state.adminError };
      }
      return { data: [state.stats[args.p_project_id]], error: null };
    }),
  };
  return { state, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

let client;
beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.clearAllMocks();
  fake.state.viewerId = 'seeker';
  fake.state.adminError = null;
  fake.state.adminResponse = null;
  fake.state.requests = [];
  fake.state.projects = [{
    id: 'project', creator_id: 'owner', title: 'A project', description: 'Recruiting students.',
    team_size_target: 4, status: 'open', creator: { name: 'Owner' },
    project_roles_needed: [], teams: { id: 'team', formed_at: null, team_members: [] },
  }];
  fake.state.stats = { project: { member_count: 3, avg_availability_hours: 12 } };
  client = await import('./client');
});

test('admin access is checked by the server without accepting a caller-supplied id', async () => {
  await expect(client.getAdminAccess()).resolves.toBe(true);
  expect(fake.supabase.rpc).toHaveBeenCalledWith('require_admin');
  fake.state.adminError = { code: '42501', message: 'Admin access required' };
  await expect(client.getAdminAccess()).rejects.toMatchObject({ code: '42501' });
});

test('a seeker gets correct seat counts and matching hours when RLS hides the roster', async () => {
  const [project] = await client.getProjects();
  expect(project).toMatchObject({ members: [], member_count: 3, avg_availability_hours: 12 });
  expect(fake.supabase.rpc).toHaveBeenCalledWith('project_recruiting_stats', { p_project_id: 'project' });
});

test('members still get their own roster names and roles', async () => {
  fake.state.projects[0].teams.team_members = [{
    user_id: 'seeker', role_id: 'pm', roles: { name: 'Project Manager' },
    users: { name: 'Student', availability_hours: 10 },
  }];
  const project = await client.getProject('project');
  expect(project.members).toEqual([{
    user_id: 'seeker', name: 'Student', role_id: 'pm', role: 'Project Manager',
  }]);
  expect(project.member_count).toBe(1);
});

test('guest aggregate results expose seat counts without roster identities or availability', async () => {
  fake.state.viewerId = null;
  fake.state.stats.project.avg_availability_hours = null;
  const project = await client.getProject('project');
  expect(project).toMatchObject({ members: [], member_count: 3, avg_availability_hours: null });
});

test('outgoing requests keep the real seat count even when the embedded roster is empty', async () => {
  fake.state.requests = [{
    id: 'request', project_id: 'project', user_id: 'seeker', status: 'pending',
    project: fake.state.projects[0],
  }];
  const { outgoing } = await client.getRequests();
  expect(outgoing[0].member_count).toBe(3);
});

test.each([
  ['getAdminDashboard', undefined, 'admin_dashboard', undefined, DASHBOARD],
  ['getAdminTeam', 'team-open', 'admin_team_details', { p_team_id: 'team-open' }, OPEN_TEAM],
  ['getAdminStudent', 'adan', 'admin_student_details', { p_student_id: 'adan' }, UNPLACED_STUDENT],
])('%s uses its guarded RPC and propagates permission errors (#37)', async (method, id, rpc, params, response) => {
  fake.state.adminResponse = response;
  await expect(client[method](id)).resolves.toEqual(response);
  if (params) expect(fake.supabase.rpc).toHaveBeenCalledWith(rpc, params);
  else expect(fake.supabase.rpc).toHaveBeenCalledWith(rpc);
  expect(fake.supabase.from).not.toHaveBeenCalled();

  fake.state.adminError = { code: '42501', message: 'Admin access required' };
  await expect(client[method](id)).rejects.toMatchObject({ code: '42501' });
});
