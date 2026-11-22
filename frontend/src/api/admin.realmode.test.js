// Issue #36: real-mode RPC authorization and Browse after roster RLS.
// Signed-in students read rosters directly; guests get one batched count.
import { beforeEach, expect, test, vi } from 'vitest';
import { DASHBOARD, OPEN_TEAM, UNPLACED_STUDENT } from '../test/adminFixtures';

const fake = vi.hoisted(() => {
  const state = { viewerId: 'seeker', projects: [], requests: [], counts: [], advisers: [], adminError: null };
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
      if (name === 'project_member_counts') {
        return { data: state.counts.filter((c) => args.p_project_ids.includes(c.project_id)), error: null };
      }
      // Advisers come back from an RPC rather than an embed under `projects`
      // (#53): adviser_requests has two foreign keys to `users`, and an
      // ambiguous embed is exactly what answered PGRST200 in #47.
      if (name === 'project_advisers') {
        return { data: state.advisers.filter((a) => args.p_project_ids.includes(a.project_id)), error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    }),
  };
  return { state, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

const ROSTER = [
  { user_id: 'owner', role_id: 'pm', roles: { name: 'Project Manager' }, users: { name: 'Owner', availability_hours: 10 } },
  { user_id: 'mate', role_id: 'fe', roles: { name: 'Frontend Developer' }, users: { name: 'Mate', availability_hours: 15 } },
];

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
    project_roles_needed: [], teams: { id: 'team', formed_at: null, team_members: ROSTER },
  }, {
    id: 'project-2', creator_id: 'owner-2', title: 'Another project', description: 'Also recruiting.',
    team_size_target: 3, status: 'open', creator: { name: 'Owner Two' },
    project_roles_needed: [], teams: { id: 'team-2', formed_at: null, team_members: [] },
  }];
  fake.state.counts = [{ project_id: 'project', member_count: 2 }, { project_id: 'project-2', member_count: 1 }];
  fake.state.advisers = [];
  client = await import('./client');
});

test('admin access is checked by the server without accepting a caller-supplied id', async () => {
  await expect(client.getAdminAccess()).resolves.toBe(true);
  expect(fake.supabase.rpc).toHaveBeenCalledWith('require_admin');
  fake.state.adminError = { code: '42501', message: 'Admin access required' };
  await expect(client.getAdminAccess()).rejects.toMatchObject({ code: '42501' });
});

test('a signed-in seeker sees other teams rosters without any count RPC', async () => {
  const [project] = await client.getProjects();
  expect(project.members).toEqual([
    // joined_at is null because the fake's rows don't carry one (#55).
    { user_id: 'owner', name: 'Owner', role_id: 'pm', role: 'Project Manager', joined_at: null },
    { user_id: 'mate', name: 'Mate', role_id: 'fe', role: 'Frontend Developer', joined_at: null },
  ]);
  expect(project).toMatchObject({ member_count: 2, avg_availability_hours: 13 });
  // The roster came from RLS, not from a count function: that is the point of
  // this case. The one call made is for advisers (#53), which has no embed to
  // read it from, and it is batched for the whole page.
  expect(fake.supabase.rpc).toHaveBeenCalledTimes(1);
  expect(fake.supabase.rpc).not.toHaveBeenCalledWith('project_member_counts', expect.anything());
  expect(fake.supabase.rpc).toHaveBeenCalledWith('project_advisers', {
    p_project_ids: ['project', 'project-2'],
  });
});

// #53. An adviser is not on the roster, so the card has to name them from
// somewhere else — and a guest, who sees no identities anywhere on a card,
// must not be sent them at all.
test('a signed-in viewer gets accepted advisers on the cards, and a guest gets none', async () => {
  fake.state.advisers = [{ project_id: 'project', adviser_id: 'dana', adviser_name: 'Dana Kim' }];

  const [project, second] = await client.getProjects();
  expect(project).toMatchObject({ adviser_id: 'dana', adviser_name: 'Dana Kim' });
  // Still two members: an adviser holds no seat.
  expect(project.member_count).toBe(2);
  expect(project.members.map((m) => m.user_id)).not.toContain('dana');
  expect(second).toMatchObject({ adviser_id: null, adviser_name: null });

  vi.clearAllMocks();
  fake.state.viewerId = null;
  const [asGuest] = await client.getProjects();
  expect(asGuest).toMatchObject({ adviser_id: null, adviser_name: null });
  expect(fake.supabase.rpc).not.toHaveBeenCalledWith('project_advisers', expect.anything());
});

test('guests get every seat count from one batched call, without identities or availability', async () => {
  fake.state.viewerId = null;
  const list = await client.getProjects();
  expect(fake.supabase.rpc).toHaveBeenCalledTimes(1);
  expect(fake.supabase.rpc).toHaveBeenCalledWith('project_member_counts', { p_project_ids: ['project', 'project-2'] });
  expect(list.map((p) => [p.id, p.member_count])).toEqual([['project', 2], ['project-2', 1]]);
  for (const p of list) expect(p).toMatchObject({ members: [], avg_availability_hours: null });
});

test('a guest viewing one project also gets its count from the batched call', async () => {
  fake.state.viewerId = null;
  const project = await client.getProject('project');
  expect(fake.supabase.rpc).toHaveBeenCalledWith('project_member_counts', { p_project_ids: ['project'] });
  expect(project).toMatchObject({ members: [], member_count: 2, avg_availability_hours: null });
});

test('outgoing requests count seats from the roster, with no per-request RPC', async () => {
  fake.state.requests = [{
    id: 'request', project_id: 'project', user_id: 'seeker', status: 'pending',
    project: fake.state.projects[0],
  }];
  const { outgoing } = await client.getRequests();
  expect(outgoing[0].member_count).toBe(2);
  expect(fake.supabase.rpc).not.toHaveBeenCalled();
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
