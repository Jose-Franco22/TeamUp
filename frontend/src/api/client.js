// API client.
//
// Every component calls these functions and nothing else. While
// VITE_USE_MOCKS is true they resolve from mockData; flip the env var and
// they talk to Supabase directly (see supabase/*.sql at the repo root for
// the RLS policies and functions this relies on) — no Express server in
// between. Components are unaffected either way, which is the point.

import {
  projects,
  projectRolesNeeded,
  joinRequests,
  teams,
  teamMembers,
  users,
  roles as allRoles,
  skills,
  userSkills,
  appSettings,
  notifications,
  buildProject,
  skillsForUser,
  profileEvidence,
  evidenceForUser,
} from './mockData';
import { supabase } from '../lib/supabaseClient';
import { isOpenProject } from '../lib/browseFilters';
import {
  ValidationError,
  fieldErrorsFromDbError,
  validateProfile,
  validateProject,
} from '../lib/validation';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';

// A senior project team is 2 to 4 students. Exported so the create-project
// form labels and bounds its input from the same numbers this file enforces.
export const MIN_TEAM_SIZE = 2;
export const MAX_TEAM_SIZE = 4;

// Small delay so loading states are visible during development.
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// The signed-in user id, set by SessionContext whenever the session
// changes. Mock branches below read this instead of a hardcoded user. Real
// (Supabase) branches ignore this entirely — they read the session
// straight from supabase-js via getViewerId(), which is the source of
// truth once mocks are off.
let sessionUserId = null;
export function setSessionUserId(id) {
  sessionUserId = id;
}

function requireSessionUserId() {
  if (!sessionUserId) throw new Error('Not signed in');
  return sessionUserId;
}

function requireStudentSessionUserId() {
  const id = requireSessionUserId();
  if (users.find((u) => u.id === id)?.is_admin) {
    throw new Error('Admin accounts cannot create or join student teams');
  }
  return id;
}

function requireAdminSessionUserId() {
  const id = requireSessionUserId();
  if (!users.find((u) => u.id === id)?.is_admin) throw new Error('Admin access required');
  return id;
}

// The database checks the caller's own role, never a browser-supplied user id.
export async function getAdminAccess() {
  if (USE_MOCKS) {
    await delay();
    requireAdminSessionUserId();
    return true;
  }
  const { error } = await supabase.rpc('require_admin');
  if (error) throw error;
  return true;
}

// --- Admin dashboard (#37) ---------------------------------------------
// Detail objects use team ids for /admin/teams/:id and keep project_id
// separately. No admin view writes to student profiles, requests or rosters.
function mockPendingRequests(predicate) {
  return joinRequests
    .filter((r) => r.status === 'pending' && predicate(r))
    .slice()
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.id.localeCompare(b.id));
}

function mockAdminTeam(team) {
  const p = buildProject(projects.find((project) => project.id === team.project_id), sessionUserId);
  return {
    id: team.id, project_id: p.id, title: p.title, description: p.description,
    creator_id: p.creator_id, creator_name: p.creator_name,
    team_size_target: p.team_size_target, status: p.status, formed_at: p.formed_at,
    member_count: p.member_count,
    members: p.members.map((m) => {
      const u = users.find((student) => student.id === m.user_id);
      return {
        user_id: m.user_id, name: m.name, email: u.email,
        role_id: m.role_id, role_name: m.role, availability_hours: u.availability_hours,
      };
    }),
    roles_needed: p.roles_needed,
    pending_requests: mockPendingRequests((r) => r.project_id === p.id)
      .filter((r) => !users.find((u) => u.id === r.user_id)?.is_admin)
      .map((r) => ({
        id: r.id, user_id: r.user_id,
        user_name: users.find((u) => u.id === r.user_id).name, created_at: r.created_at,
      })),
  };
}

function mockAdminStudent(student) {
  const membership = teamMembers.find((m) => m.user_id === student.id);
  const team = membership && teams.find((t) => t.id === membership.team_id);
  const project = team && projects.find((p) => p.id === team.project_id);
  return {
    id: student.id, name: student.name, email: student.email, bio: student.bio,
    availability_hours: student.availability_hours, github_url: student.github_url,
    skills: skillsForUser(student.id),
    membership: membership ? {
      team_id: team.id, project_id: project.id, project_title: project.title,
      role_id: membership.role_id, role_name: allRoles.find((r) => r.id === membership.role_id)?.name ?? null,
    } : null,
    pending_requests: mockPendingRequests((r) => r.user_id === student.id).map((r) => {
      const p = projects.find((project) => project.id === r.project_id);
      return {
        id: r.id, project_id: p.id, team_id: teams.find((t) => t.project_id === p.id)?.id ?? null,
        project_title: p.title, created_at: r.created_at,
      };
    }),
  };
}

export async function getAdminDashboard() {
  if (USE_MOCKS) {
    await delay();
    requireAdminSessionUserId();
    const teamList = teams.map(mockAdminTeam).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    const unplaced = users
      .filter((u) => !u.is_admin && !teamMembers.some((m) => m.user_id === u.id))
      .map(mockAdminStudent)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      teams: teamList, unplaced_students: unplaced,
      summary: {
        formed_teams: teamList.filter((t) => t.status === 'full').length,
        open_teams: teamList.filter((t) => t.status === 'open').length,
        unplaced_students: unplaced.length,
      },
    };
  }
  const { data, error } = await supabase.rpc('admin_dashboard');
  if (error) throw error;
  return data;
}

export async function getAdminTeam(teamId) {
  if (USE_MOCKS) {
    await delay();
    requireAdminSessionUserId();
    const team = teams.find((t) => t.id === teamId);
    if (!team) throw new Error('Team not found');
    return mockAdminTeam(team);
  }
  const { data, error } = await supabase.rpc('admin_team_details', { p_team_id: teamId });
  if (error) throw error;
  return data;
}

export async function getAdminStudent(studentId) {
  if (USE_MOCKS) {
    await delay();
    requireAdminSessionUserId();
    const student = users.find((u) => u.id === studentId && !u.is_admin);
    if (!student) throw new Error('Student not found');
    return mockAdminStudent(student);
  }
  const { data, error } = await supabase.rpc('admin_student_details', { p_student_id: studentId });
  if (error) throw error;
  return data;
}

async function getViewerId() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.user?.id ?? null;
}

function requireViewerId(viewerId) {
  if (!viewerId) throw new Error('Not signed in');
  return viewerId;
}

// --- Real-mode composition helpers -------------------------------------
//
// PostgREST/Supabase embed syntax: `alias:table!fk_column(...)`. The
// `!fk_column` hint is only needed where a table has more than one FK to
// the same target (e.g. projects -> users via creator_id) so Supabase
// knows which relationship to follow.

// An embedded child comes back as an ARRAY for a one-to-many relationship
// but as a single OBJECT for a one-to-one — and PostgREST decides which by
// looking at whether the child's foreign key column is unique.
// `teams.project_id` is `not null unique` (one team per project), so
// `projects -> teams` is one-to-one and embeds as an object, not a
// one-element array. Reading it as `row.teams[0]` silently yields undefined:
// every project then looks like it has an empty roster and a null team_id,
// which is why a creator appeared to be missing from their own project even
// though create_project() had seated them correctly.
//
// Normalized here rather than at each call site so the two readers can't
// drift, and so this keeps working if a future schema change flips the
// relationship back to one-to-many.
function embeddedOne(value) {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

const PROJECT_SELECT = `
  id, creator_id, title, description, team_size_target, status, created_at,
  creator:users!creator_id ( name ),
  project_roles_needed ( role_id, skill_id, quantity_needed, roles ( name ), skills ( name, category ) ),
  teams ( id, formed_at, team_members ( user_id, role_id, roles ( name ), users ( name, availability_hours ) ) )
`;

function pickViewerStatus(rows) {
  if (!rows || rows.length === 0) return null;
  const pending = rows.find((r) => r.status === 'pending');
  if (pending) return 'pending';
  return rows.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].status;
}

// One query for all of the viewer's own join_requests, reused across every
// project in a list instead of querying per project.
async function fetchViewerRequestMap(viewerId) {
  if (!viewerId) return {};
  const { data, error } = await supabase
    .from('join_requests')
    .select('project_id, status, created_at')
    .eq('user_id', viewerId);
  if (error) throw error;
  const byProject = {};
  for (const r of data) {
    (byProject[r.project_id] ||= []).push(r);
  }
  return byProject;
}

// Guests cannot read team_members at all, so their seat counts come from one
// batched aggregate for every project on the page (18_admin_access.sql).
// Signed-in viewers read the roster itself and need no extra call.
async function fetchGuestMemberCounts(viewerId, rows) {
  if (viewerId) return {};
  const ids = rows.filter((row) => embeddedOne(row.teams)).map((row) => row.id);
  if (ids.length === 0) return {};
  const { data, error } = await supabase.rpc('project_member_counts', { p_project_ids: ids });
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((r) => [r.project_id, r.member_count]));
}

// Shapes one `projects` row (as fetched via PROJECT_SELECT) into the same
// object buildProject() produces from the mocks.
function composeProject(row, viewerId, viewerRequestsByProject, guestMemberCounts) {
  // `skills` embeds as null when skill_id is null — a role listed without a
  // specific skill attached, which the schema allows on purpose.
  // A role whose seats have all been filled sits at quantity_needed = 0
  // (see supabase/15_release_filled_roles.sql). It is kept rather than
  // deleted so the creator does not lose the skill pinned to it, but it is
  // not an open role any more.
  const roles_needed = (row.project_roles_needed || [])
    .filter((r) => r.quantity_needed > 0)
    .map((r) => ({
    role_id: r.role_id,
    role_name: r.roles?.name ?? null,
    skill_id: r.skill_id ?? null,
    skill_name: r.skills?.name ?? null,
    category: r.skills?.category ?? null,
    quantity_needed: r.quantity_needed,
  }));

  const team = embeddedOne(row.teams);
  const rawMembers = team?.team_members ?? [];

  let members = [];
  let member_count = 0;
  let avg_availability_hours = null;

  if (viewerId) {
    // Any signed-in viewer can read the roster; RLS leaves out admin accounts.
    members = rawMembers.map((tm) => ({
      user_id: tm.user_id,
      name: tm.users.name,
      role_id: tm.role_id,
      role: tm.roles?.name ?? null,
    }));
    member_count = members.length;
    avg_availability_hours = members.length
      ? Math.round(rawMembers.reduce((sum, tm) => sum + (tm.users.availability_hours || 0), 0) / rawMembers.length)
      : 0;
  } else if (team) {
    // Guest: seat count only, no identities or availability.
    member_count = guestMemberCounts?.[row.id] ?? 0;
  }

  return {
    id: row.id,
    creator_id: row.creator_id,
    title: row.title,
    description: row.description,
    team_size_target: row.team_size_target,
    status: row.status,
    creator_name: row.creator?.name ?? null,
    team_id: team?.id ?? null,
    formed_at: team?.formed_at ?? null,
    members,
    roles_needed,
    member_count,
    avg_availability_hours,
    viewer_request_status: pickViewerStatus(viewerRequestsByProject?.[row.id]),
  };
}

// A role only accepts skills from its own categories (roles.skill_categories),
// so "Frontend Developer + pandas" is rejected rather than quietly stored.
// Mock-mode only: real mode gets the same check inside create_project() /
// update_project(), which is the authoritative one either way — doing it here
// too would mean fetching the whole taxonomy on every write just to re-check
// what the database is about to check anyway.
function assertRolesMatchSkills(roles_needed) {
  if (!USE_MOCKS) return;
  for (const r of roles_needed) {
    if (!r.skill_id) continue;
    const role = allRoles.find((x) => x.id === r.role_id);
    const skill = skills.find((x) => x.id === r.skill_id);
    if (!skill) throw new Error('That skill does not exist');
    if (!role?.skill_categories?.includes(skill.category)) {
      throw new Error('That skill does not fit the role you picked');
    }
  }
}

// --- Projects ----------------------------------------------------------

// Open projects by default (issue #31): a full team cannot take anyone, so
// listing it is a dead end for a seeker. Browse passes `{ onlyOpen: false }`
// explicitly because it offers the switch and has to say how many projects
// the switch is hiding — an empty screen with no explanation is worse than a
// full project you can't join.
//
// The filter runs on composed rows rather than in the query so that mock mode
// and real mode share one definition of "open" (lib/browseFilters.js). A
// `.neq('status', 'full')` in the SQL would be a second, slightly different
// rule that nothing tests.
export async function getProjects({ onlyOpen = true } = {}) {
  const keep = (list) => (onlyOpen ? list.filter(isOpenProject) : list);

  if (USE_MOCKS) {
    await delay();
    return keep(projects.map((p) => buildProject(p, sessionUserId)));
  }
  const viewerId = await getViewerId();
  const [{ data: rows, error }, requestMap] = await Promise.all([
    supabase.from('projects').select(PROJECT_SELECT).order('created_at', { ascending: false }),
    fetchViewerRequestMap(viewerId),
  ]);
  if (error) throw error;
  const guestCounts = await fetchGuestMemberCounts(viewerId, rows);
  return keep(rows.map((row) => composeProject(row, viewerId, requestMap, guestCounts)));
}

export async function getProject(id) {
  if (USE_MOCKS) {
    await delay();
    const p = projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    return buildProject(p, sessionUserId);
  }
  const viewerId = await getViewerId();
  const [{ data: row, error }, requestMap] = await Promise.all([
    supabase.from('projects').select(PROJECT_SELECT).eq('id', id).single(),
    fetchViewerRequestMap(viewerId),
  ]);
  if (error) throw new Error('Project not found');
  return composeProject(row, viewerId, requestMap, await fetchGuestMemberCounts(viewerId, [row]));
}

// `roles_needed` is an array of { role_id, skill_id, quantity_needed }, where
// skill_id may be null — a role can be listed without pinning a specific
// skill to it. `creator_role_id` is the creator's own role on the team
// they're forming; required, not optional, since team_members.role_id is
// NOT NULL. Both ids come from getRoles()/getSkills(), not free text — see
// supabase/04_roles_and_team_deletion.sql.
export async function createProject({
  title,
  description,
  team_size_target,
  creator_role_id,
  roles_needed,
}) {
  // Title length, description length, team size, duplicate roles and the
  // seat arithmetic all live in lib/validation.js, so the form and this
  // last check before sending cannot disagree. `create_project()` re-checks
  // every one of them server-side — see supabase/16_project_validation.sql,
  // which is the real boundary.
  //
  // The creator is seated by create_project itself, so memberCount is 1:
  // the roles listed here recruit for the *remaining* seats.
  const { values, errors, isValid } = validateProject(
    { title, description, team_size_target, own_role_id: creator_role_id, roles_needed },
    { memberCount: 1 }
  );
  if (!isValid) throw new ValidationError(errors);

  assertRolesMatchSkills(roles_needed);

  if (USE_MOCKS) {
    await delay();
    const id = requireStudentSessionUserId();
    // A student can only be on one team — same rule as createJoinRequest.
    const onAnyTeam = teamMembers.some((tm) => tm.user_id === id);
    if (onAnyTeam) throw new Error('You are already on a team and cannot create another project');

    const projectId = `p-${Date.now()}`;
    const project = {
      id: projectId,
      creator_id: id,
      // The validated, trimmed values — create_project() btrims server-side,
      // so mock mode has to store the same thing.
      title: values.title,
      description: values.description,
      team_size_target: values.team_size_target,
      status: 'open',
      created_at: new Date().toISOString(),
    };
    projects.push(project);

    const teamId = `t-${Date.now()}`;
    teams.push({ id: teamId, project_id: projectId, formed_at: null });
    teamMembers.push({ team_id: teamId, user_id: id, role_id: creator_role_id });

    for (const r of roles_needed) {
      projectRolesNeeded.push({
        project_id: projectId,
        role_id: r.role_id,
        skill_id: r.skill_id ?? null,
        quantity_needed: r.quantity_needed,
      });
    }

    // Creating a project seats you on a team, and a student is only ever on
    // one — so any request you still have out is now unactionable, exactly
    // as when one of them gets accepted. Decline them here for the same
    // reason respondToRequest cascades (see TODO-backend.md); leaving them
    // pending means the creator on the other end hits "already on a team"
    // when they try to accept.
    joinRequests
      .filter((jr) => jr.user_id === id && jr.status === 'pending')
      .forEach((jr) => {
        jr.status = 'declined';
      });

    return buildProject(project, id);
  }
  // create_project() runs the same checks as create_join_request (rejects a
  // caller already on any team) plus the project/team/roster/roles inserts,
  // all in one transaction — see TODO-backend.md and supabase/03_functions.sql.
  const { data, error } = await supabase.rpc('create_project', {
    p_title: values.title,
    p_description: values.description,
    p_team_size_target: values.team_size_target,
    p_creator_role_id: creator_role_id,
    p_roles_needed: roles_needed,
  });
  if (error) throw error;
  // The function returns a bare `projects` row. Mock mode returns the
  // fully composed project (members, roles_needed, counts), and those two
  // shapes have to match — mockData.js + this file are the contract. Read
  // it back rather than handing callers a different object per mode.
  return getProject(data.id);
}

// Edits a project the caller created: title, description, team_size_target,
// the caller's own role on the team, and the full roles_needed list, which
// is replaced wholesale rather than diffed (the form always submits the
// complete set, so a replace is both simpler and exactly what the user sees).
//
// Rules re-checked in update_project() server-side:
//   - only the project's creator may edit it;
//   - team_size_target stays within 2-4 AND can't drop below the people
//     already on the roster;
//   - the roles listed have to fit the seats nobody holds yet.
//
// Raising the target on a project that had filled reopens it, and lowering
// it onto the current roster closes it — projects.status and teams.formed_at
// both follow from the same comparison respond_to_join_request makes.
export async function updateProject(
  projectId,
  { title, description, team_size_target, own_role_id, roles_needed },
  { memberCount = 1 } = {}
) {
  // The same rules as createProject, from the same function — an edit must
  // not be able to save what a create would have refused.
  //
  // `memberCount` is how many people already hold a seat. The caller knows
  // it (EditProject has it from getProject) and the client cannot without
  // an extra round trip, so it is passed in. It only affects the two rules
  // that depend on the roster — the target can't drop below it, and the
  // open seats are counted from it — and update_project() re-checks both
  // server-side from the real roster, so a wrong value here cannot let a
  // bad edit through.
  const { values, errors, isValid } = validateProject(
    { title, description, team_size_target, own_role_id, roles_needed },
    { memberCount }
  );
  if (!isValid) throw new ValidationError(errors);

  assertRolesMatchSkills(roles_needed);

  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.creator_id !== id) throw new Error('Only the project creator can edit it');

    const team = teams.find((t) => t.project_id === projectId);
    const roster = teamMembers.filter((tm) => tm.team_id === team.id);

    if (team_size_target < roster.length) {
      throw new Error(
        `${roster.length} people are already on this team, so the target can't be ${team_size_target}`
      );
    }

    const openSeats = team_size_target - roster.length;
    const assigned = roles_needed.reduce((sum, r) => sum + (Number(r.quantity_needed) || 0), 0);
    if (assigned > openSeats) {
      throw new Error(
        `This team has ${openSeats} open seat${openSeats === 1 ? '' : 's'} left, ` +
          `but you listed ${assigned} people`
      );
    }

    Object.assign(project, {
      // The validated, trimmed values — update_project() btrims server-side.
      title: values.title,
      description: values.description,
      team_size_target: values.team_size_target,
      status: roster.length >= team_size_target ? 'full' : 'open',
    });
    team.formed_at = roster.length >= team_size_target ? team.formed_at || new Date().toISOString() : null;

    const mine = roster.find((tm) => tm.user_id === id);
    mine.role_id = own_role_id;

    // Roles whose seats are all filled sit at quantity_needed = 0 and are
    // hidden from the form (composeProject filters them out), so the
    // creator never saw them and cannot have meant to remove them. Keeping
    // them preserves the skill pinned to each one, so the seat can reopen
    // if that member leaves. Mirrors update_project() in
    // supabase/17_keep_filled_roles_on_edit.sql.
    const submitted = new Set(roles_needed.map((r) => r.role_id));
    for (let i = projectRolesNeeded.length - 1; i >= 0; i -= 1) {
      const row = projectRolesNeeded[i];
      if (row.project_id !== projectId) continue;
      if (row.quantity_needed === 0 && !submitted.has(row.role_id)) continue;
      projectRolesNeeded.splice(i, 1);
    }
    for (const r of roles_needed) {
      projectRolesNeeded.push({
        project_id: projectId,
        role_id: r.role_id,
        skill_id: r.skill_id ?? null,
        quantity_needed: r.quantity_needed,
      });
    }

    return buildProject(project, id);
  }

  const { error } = await supabase.rpc('update_project', {
    p_project_id: projectId,
    p_title: values.title,
    p_description: values.description,
    p_team_size_target: values.team_size_target,
    p_own_role_id: own_role_id,
    p_roles_needed: roles_needed,
  });
  if (error) throw error;
  return getProject(projectId);
}

// --- Roles ---------------------------------------------------------------

export async function getRoles() {
  if (USE_MOCKS) {
    await delay();
    return [...allRoles].sort((a, b) => a.sort_order - b.sort_order);
  }
  const { data, error } = await supabase
    .from('roles')
    .select('id, name, sort_order, skill_categories')
    .order('sort_order');
  if (error) throw error;
  return data;
}

// --- Skills --------------------------------------------------------------

export async function getSkills() {
  if (USE_MOCKS) {
    await delay();
    return skills;
  }
  const { data, error } = await supabase.from('skills').select('id, name, category').order('category');
  if (error) throw error;
  return data;
}

// Saves the skills a student confirmed after importing a resume. Nothing is
// written until they confirm, so this is the only write the import performs.
//
// Duplicates are ignored rather than rejected: a student who imports an
// updated resume should not hit an error on the skills they already had.
// The evidence behind each skill ({ skill_id, months, projects, quote }) goes
// to profile_evidence, overwriting what an earlier import stored.
export async function addResumeSkills(skillIds, evidence = []) {
  if (!skillIds?.length) return getCurrentUser();

  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    for (const skillId of skillIds) {
      const already = userSkills.some((row) => row.user_id === id && row.skill_id === skillId);
      if (!already) userSkills.push({ user_id: id, skill_id: skillId, source: 'resume' });
    }
    // Mirrors the real branch below, so an import in mock mode produces the
    // same evidence the matching engine would score in production.
    const confirmed = new Set(skillIds);
    for (const e of evidence.filter((row) => confirmed.has(row.skill_id))) {
      const existing = profileEvidence.find((row) => row.user_id === id && row.skill_id === e.skill_id);
      if (existing) Object.assign(existing, e);
      else profileEvidence.push({ user_id: id, ...e });
    }
    return getCurrentUser();
  }

  const viewerId = requireViewerId(await getViewerId());
  const rows = skillIds.map((skillId) => ({
    user_id: viewerId,
    skill_id: skillId,
    source: 'resume',
  }));
  // RLS (user_skills_manage_own) already limits this to the caller's own rows.
  const { error } = await supabase
    .from('user_skills')
    .upsert(rows, { onConflict: 'user_id,skill_id', ignoreDuplicates: true });
  if (error) throw error;

  // After user_skills, since each evidence row references its user_skills row.
  const confirmed = new Set(skillIds);
  const evidenceRows = evidence
    .filter((e) => confirmed.has(e.skill_id))
    .map(({ skill_id, months, projects, quote }) => ({
      user_id: viewerId,
      skill_id,
      months,
      projects,
      quote,
      updated_at: new Date().toISOString(),
    }));
  if (evidenceRows.length) {
    const { error: evidenceError } = await supabase
      .from('profile_evidence')
      .upsert(evidenceRows, { onConflict: 'user_id,skill_id' });
    if (evidenceError) throw evidenceError;
  }
  return getCurrentUser();
}

// Adds one skill the student picked by hand. Adding a skill they already have
// is a no-op, same as addResumeSkills.
export async function addSkill(skillId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const already = userSkills.some((row) => row.user_id === id && row.skill_id === skillId);
    if (!already) userSkills.push({ user_id: id, skill_id: skillId, source: 'manual' });
    return getCurrentUser();
  }

  const viewerId = requireViewerId(await getViewerId());
  // RLS (user_skills_manage_own) already limits this to the caller's own rows.
  const { error } = await supabase
    .from('user_skills')
    .upsert(
      { user_id: viewerId, skill_id: skillId, source: 'manual' },
      { onConflict: 'user_id,skill_id', ignoreDuplicates: true },
    );
  if (error) throw error;
  return getCurrentUser();
}

// Removes one skill from the caller's profile. Its profile_evidence row goes
// with it (on delete cascade in 07_profile_evidence.sql).
export async function removeSkill(skillId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const i = userSkills.findIndex((row) => row.user_id === id && row.skill_id === skillId);
    if (i !== -1) userSkills.splice(i, 1);
    return getCurrentUser();
  }

  const viewerId = requireViewerId(await getViewerId());
  // RLS (user_skills_manage_own) already limits this to the caller's own rows.
  const { error } = await supabase
    .from('user_skills')
    .delete()
    .eq('user_id', viewerId)
    .eq('skill_id', skillId);
  if (error) throw error;
  return getCurrentUser();
}

// --- Current user ------------------------------------------------------

// profile_evidence rides along with the profile. Its RLS policy is
// own-rows-only and this select is always `.eq('id', viewerId)`, so a student
// only ever gets their own months and projects — nobody else's resume lines
// come back. The matching engine reads them as `depth`; without them every
// skill scores as a bare tag and no student can reach a strong fit.
// profile_evidence is nested under user_skills, NOT under users.
//
// PostgREST can only embed across a real foreign key, and profile_evidence
// has exactly one: the composite (user_id, skill_id) -> user_skills. There
// is no FK to users, so asking for it beside user_skills returns PGRST200
// ("could not find a relationship") and the whole profile fails to load.
// Mock mode cannot catch that, because its shape is built by hand — see the
// test in client.test.js that reads 07_profile_evidence.sql and asserts this
// nesting, so the two cannot drift again.
export const USER_SELECT =
  'id, email, name, bio, availability_hours, github_url, is_admin, ' +
  'user_skills ( source, skills ( id, name, category ), profile_evidence ( months, projects ) )';

// PostgREST returns an embedded child as an object when it can tell the
// relationship is one-to-one (profile_evidence's PK is its whole FK) and as
// a one-element array otherwise. Which one depends on version and on how it
// reads the keys, so accept both rather than betting on it.
function embeddedEvidence(value) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return null;
  return { months: row.months ?? 0, projects: row.projects ?? 0 };
}

function shapeUserRow(data) {
  const { user_skills, ...profile } = data;
  const rows = user_skills || [];
  const evidence = {};
  for (const us of rows) {
    const found = embeddedEvidence(us.profile_evidence);
    if (found && us.skills?.id) evidence[us.skills.id] = found;
  }
  return {
    ...profile,
    skills: rows.map((us) => ({ ...us.skills, source: us.source })),
    evidence,
  };
}

export async function getCurrentUser() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const u = users.find((x) => x.id === id);
    return { ...u, skills: skillsForUser(id), evidence: evidenceForUser(id) };
  }
  const viewerId = requireViewerId(await getViewerId());
  const { data, error } = await supabase.from('users').select(USER_SELECT).eq('id', viewerId).single();
  if (error) throw error;
  return shapeUserRow(data);
}

// Validates and cleans the patch first (see lib/validation.js), so nothing
// invalid is ever sent — and a database CHECK rejection comes back as the
// same per-field ValidationError the form would have produced.
export async function updateCurrentUser(patch) {
  const { values, errors, isValid } = validateProfile(patch);
  if (!isValid) throw new ValidationError(errors);
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const u = users.find((x) => x.id === id);
    Object.assign(u, values);
    return { ...u, skills: skillsForUser(id) };
  }
  const viewerId = requireViewerId(await getViewerId());
  const { error } = await supabase.from('users').update(values).eq('id', viewerId);
  if (error) {
    const fieldErrors = fieldErrorsFromDbError(error);
    throw fieldErrors ? new ValidationError(fieldErrors) : error;
  }
  return getCurrentUser();
}

// --- Join requests -----------------------------------------------------

const REQUEST_SELECT = `
  id, project_id, user_id, status, created_at,
  requester:users!user_id ( name, availability_hours, user_skills ( skills ( name ) ) ),
  project:projects!project_id (
    title, creator_id, team_size_target,
    creator:users!creator_id ( name ),
    project_roles_needed ( role_id, skill_id, quantity_needed, roles ( name ), skills ( name, category ) ),
    teams ( team_members ( user_id ) )
  )
`;

export async function getRequests() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const myProjectIds = projects.filter((p) => p.creator_id === id).map((p) => p.id);

    const incoming = joinRequests
      .filter((r) => myProjectIds.includes(r.project_id) && r.status === 'pending')
      .map((r) => {
        const u = users.find((x) => x.id === r.user_id);
        const project = projects.find((p) => p.id === r.project_id);
        return {
          ...r,
          user_name: u.name,
          availability_hours: u.availability_hours,
          skills: skillsForUser(r.user_id).map((s) => s.name),
          project_title: project.title,
          roles_needed: buildProject(project).roles_needed,
        };
      });

    const outgoing = joinRequests
      .filter((r) => r.user_id === id)
      .map((r) => {
        const p = buildProject(projects.find((x) => x.id === r.project_id), id);
        return {
          ...r,
          project_title: p.title,
          creator_name: p.creator_name,
          member_count: p.member_count,
          team_size_target: p.team_size_target,
        };
      });

    return { incoming, outgoing };
  }

  // No explicit filter here on purpose — the join_requests RLS policy
  // (join_requests_select_own_or_incoming) already limits what comes back
  // to exactly "my outgoing requests, plus incoming ones on my projects."
  const viewerId = requireViewerId(await getViewerId());
  const { data: rows, error } = await supabase.from('join_requests').select(REQUEST_SELECT);
  if (error) throw error;

  const incoming = rows
    .filter((r) => r.project.creator_id === viewerId && r.status === 'pending')
    .map((r) => ({
      id: r.id,
      project_id: r.project_id,
      user_id: r.user_id,
      status: r.status,
      created_at: r.created_at,
      user_name: r.requester.name,
      availability_hours: r.requester.availability_hours,
      skills: (r.requester.user_skills || []).map((us) => us.skills.name),
      project_title: r.project.title,
      roles_needed: (r.project.project_roles_needed || []).map((pr) => ({
        role_id: pr.role_id,
        role_name: pr.roles?.name ?? null,
        skill_id: pr.skill_id ?? null,
        skill_name: pr.skills?.name ?? null,
        category: pr.skills?.category ?? null,
        quantity_needed: pr.quantity_needed,
      })),
    }));

  const outgoing = rows
    .filter((r) => r.user_id === viewerId)
    .map((r) => ({
      id: r.id,
      project_id: r.project_id,
      user_id: r.user_id,
      status: r.status,
      created_at: r.created_at,
      project_title: r.project.title,
      creator_name: r.project.creator.name,
      member_count: embeddedOne(r.project.teams)?.team_members?.length ?? 0,
      team_size_target: r.project.team_size_target,
    }));

  return { incoming, outgoing };
}

// How many requests to join the viewer's projects are waiting on them — the
// number on the Requests tab. Same rows as getRequests().incoming, without
// fetching everything about each one.
export async function getPendingRequestCount() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const myProjectIds = projects.filter((p) => p.creator_id === id).map((p) => p.id);
    return joinRequests.filter((r) => myProjectIds.includes(r.project_id) && r.status === 'pending').length;
  }

  // RLS returns the viewer's own requests plus incoming ones on their
  // projects, and nobody can request their own project — so a pending row
  // that isn't the viewer's is an incoming one.
  const viewerId = requireViewerId(await getViewerId());
  const { count, error } = await supabase
    .from('join_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .neq('user_id', viewerId);
  if (error) throw error;
  return count ?? 0;
}

export async function createJoinRequest(projectId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireStudentSessionUserId();
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.creator_id === id) throw new Error('You cannot request to join your own project');
    const team = teams.find((t) => t.project_id === projectId);
    const isMember = team && teamMembers.some((tm) => tm.team_id === team.id && tm.user_id === id);
    if (isMember) throw new Error("You're already on this team");
    // A student can only be on one team at a time.
    const onAnyTeam = teamMembers.some((tm) => tm.user_id === id);
    if (onAnyTeam) throw new Error('You are already on a team and cannot request to join another project');
    const existing = joinRequests.find(
      (r) => r.project_id === projectId && r.user_id === id && r.status === 'pending'
    );
    if (existing) throw new Error('You already have a pending request for this project');
    const row = {
      id: `jr-${Date.now()}`,
      project_id: projectId,
      user_id: id,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    joinRequests.push(row);
    // The creator hears about it straight away (23_join_request_notifications.sql).
    notifications.push({
      id: `n-${Date.now()}-${notifications.length}`,
      user_id: project.creator_id,
      kind: 'join_request',
      project_id: projectId,
      actor_id: id,
      by_admin: false,
      created_at: row.created_at,
      read_at: null,
    });
    return row;
  }
  // create_join_request() runs all four checks, the insert and the creator's
  // notification in one transaction server-side — see
  // supabase/23_join_request_notifications.sql.
  const { data, error } = await supabase.rpc('create_join_request', { p_project_id: projectId });
  if (error) throw error;
  return data;
}

// DEMO ONLY: join straight onto the team, no creator approval. Writes the
// same rows an accepted request would — see supabase/24_demo_instant_join.sql.
export async function joinProject(projectId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireStudentSessionUserId();
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found');
    if (project.creator_id === id) throw new Error('You cannot join your own project');
    if (teamMembers.some((tm) => tm.user_id === id)) {
      throw new Error('You are already on a team and cannot join another project');
    }
    const team = teams.find((t) => t.project_id === projectId);
    const count = teamMembers.filter((tm) => tm.team_id === team.id).length;
    if (count >= project.team_size_target) throw new Error('This team is already full');

    const sortOrder = (roleId) => allRoles.find((r) => r.id === roleId)?.sort_order ?? 0;
    const listed = projectRolesNeeded
      .filter((n) => n.project_id === projectId && n.role_id)
      .sort((a, b) => (b.quantity_needed > 0) - (a.quantity_needed > 0) || sortOrder(a.role_id) - sortOrder(b.role_id));
    const need = listed[0];
    const roleId = need?.role_id ?? [...allRoles].sort((a, b) => a.sort_order - b.sort_order)[0]?.id;
    if (!roleId) throw new Error('No roles are set up yet');

    const row = {
      id: `jr-${Date.now()}`,
      project_id: projectId,
      user_id: id,
      status: 'accepted',
      created_at: new Date().toISOString(),
    };
    joinRequests.push(row);
    teamMembers.push({ team_id: team.id, user_id: id, role_id: roleId });
    if (need && need.quantity_needed > 0) need.quantity_needed -= 1;
    if (count + 1 >= project.team_size_target) {
      project.status = 'full';
      team.formed_at = team.formed_at || new Date().toISOString();
    }
    joinRequests
      .filter((jr) => jr.user_id === id && jr.status === 'pending')
      .forEach((jr) => {
        jr.status = 'declined';
      });
    return row;
  }
  const { data, error } = await supabase.rpc('join_project', { p_project_id: projectId });
  if (error) throw error;
  return data;
}

// `roleId` is the creator's pick from the project's roles_needed — a
// roles.id, not a free-text string (see 04_roles_and_team_deletion.sql) —
// and only applies when accepting.
export async function respondToRequest(requestId, status, roleId) {
  if (USE_MOCKS) {
    await delay();
    const me = requireStudentSessionUserId();
    if (status === 'accepted' && !roleId) throw new Error('A role is required to accept a request');
    const r = joinRequests.find((x) => x.id === requestId);
    if (!r) throw new Error('Request not found');
    const project = projects.find((p) => p.id === r.project_id);
    const team = teams.find((t) => t.project_id === r.project_id);

    // Every check runs before anything is mutated, in the same order as
    // respond_to_join_request (21_join_request_responses.sql), which is one
    // transaction: a rejected accept must not leave the request marked
    // 'accepted' with nobody actually on the roster.
    if (project.creator_id !== me) throw new Error('Only the project creator can respond to this request');
    if (r.status !== 'pending') throw new Error('This request has already been responded to');
    if (status === 'accepted') {
      if (teamMembers.filter((tm) => tm.team_id === team.id).length >= project.team_size_target) {
        throw new Error('This team is already full');
      }
      if (users.find((u) => u.id === r.user_id)?.is_admin) {
        throw new Error('Admin accounts cannot create or join student teams');
      }
      // team_members.user_id is the primary key, so a stale request would
      // otherwise fail the insert with a raw constraint violation.
      if (teamMembers.some((tm) => tm.user_id === r.user_id)) {
        throw new Error('That student has already joined a team');
      }
    }

    r.status = status;

    // Accepting adds the person to the roster, and fills the project once
    // it reaches team_size_target. The backend does this in a transaction.
    if (status === 'accepted') {
      teamMembers.push({ team_id: team.id, user_id: r.user_id, role_id: roleId });
      const count = teamMembers.filter((tm) => tm.team_id === team.id).length;
      if (count >= project.team_size_target) {
        project.status = 'full';
        team.formed_at = new Date().toISOString();
      }

      // A student can only be on one team, so accepting this request
      // means every other pending request they have out is no longer
      // actionable. Decline them here, in the same transaction, rather
      // than leaving join_requests in a state createJoinRequest would now
      // refuse to create (see TODO-backend.md).
      joinRequests
        .filter((jr) => jr.user_id === r.user_id && jr.status === 'pending' && jr.id !== r.id)
        .forEach((jr) => {
          jr.status = 'declined';
        });
    }

    notifications.push({
      id: `n-${Date.now()}-${notifications.length}`,
      user_id: r.user_id,
      kind: status === 'accepted' ? 'request_accepted' : 'request_declined',
      project_id: project.id,
      actor_id: me,
      by_admin: false,
      created_at: new Date().toISOString(),
      read_at: null,
    });
    return r;
  }
  // respond_to_join_request() is the one-transaction accept/decline flow —
  // see supabase/21_join_request_responses.sql for the current version.
  const { data, error } = await supabase.rpc('respond_to_join_request', {
    p_request_id: requestId,
    p_status: status,
    p_role_id: roleId ?? null,
  });
  if (error) throw error;
  return data;
}

// --- Team --------------------------------------------------------------

export async function getMyTeam() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const membership = teamMembers.find((tm) => tm.user_id === id);
    if (!membership) return null;
    const team = teams.find((t) => t.id === membership.team_id);
    const project = buildProject(projects.find((p) => p.id === team.project_id), id);
    return {
      ...project,
      formation_deadline: appSettings.formation_deadline,
      members: project.members.map((m) => {
        const u = users.find((x) => x.id === m.user_id);
        return {
          ...m,
          availability_hours: u.availability_hours,
          skills: skillsForUser(m.user_id).map((s) => s.name),
        };
      }),
    };
  }

  const viewerId = requireViewerId(await getViewerId());

  const { data: membership, error: membershipErr } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', viewerId)
    .maybeSingle();
  if (membershipErr) throw membershipErr;
  if (!membership) return null;

  const { data: teamRow, error: teamErr } = await supabase
    .from('teams')
    .select('project_id')
    .eq('id', membership.team_id)
    .single();
  if (teamErr) throw teamErr;

  const [{ data: projectRow, error: projErr }, requestMap, leaveRules] = await Promise.all([
    supabase.from('projects').select(PROJECT_SELECT).eq('id', teamRow.project_id).single(),
    fetchViewerRequestMap(viewerId),
    fetchLeaveRules(),
  ]);
  if (projErr) throw projErr;
  const project = composeProject(projectRow, viewerId, requestMap);

  // GET /api/me/team enriches each teammate with availability_hours/skills,
  // unlike the plain project views — see TODO-backend.md.
  const { data: memberRows, error: membersErr } = await supabase
    .from('team_members')
    .select('user_id, role_id, roles ( name ), users ( name, availability_hours, user_skills ( skills ( name ) ) )')
    .eq('team_id', membership.team_id);
  if (membersErr) throw membersErr;

  return {
    ...project,
    ...leaveRules,
    members: memberRows.map((tm) => ({
      user_id: tm.user_id,
      name: tm.users.name,
      role_id: tm.role_id,
      role: tm.roles?.name ?? null,
      availability_hours: tm.users.availability_hours,
      skills: (tm.users.user_skills || []).map((us) => us.skills.name),
    })),
  };
}

// When rosters lock (supabase/20_leave_team_rules.sql). Read through
// formation_deadline() rather than a table, so #38 can move where the date
// lives without touching this. Forgiving of errors so a database that
// hasn't run 20_ yet still shows the team page — leave_team() is what
// actually enforces the deadline. Only students are ever on a team
// (18_admin_access.sql), so whoever reads this is subject to the lock.
async function fetchLeaveRules() {
  const { data: deadline } = await supabase.rpc('formation_deadline');
  return { formation_deadline: deadline ?? null };
}

// Deletes the team *and* the project it belongs to — a team exists only to
// hold one project's roster, so removing it alone would strand the project
// with no way to accept anyone. Cascades to team_members,
// project_roles_needed and join_requests.
//
// Two rules, both re-checked in delete_team() server-side since a
// client-side check is not a security boundary:
//   1. Only the project's creator may delete it.
//   2. The creator has to be the last member left. create_project seats the
//      creator on their own team, so "no members" can only mean "nobody but
//      the owner" — a team with literally zero members never exists.
export async function deleteTeam(teamId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const team = teams.find((t) => t.id === teamId);
    if (!team) throw new Error('Team not found');
    const project = projects.find((p) => p.id === team.project_id);
    if (project.creator_id !== id) throw new Error('Only the team owner can delete this team');

    const roster = teamMembers.filter((tm) => tm.team_id === team.id);
    if (roster.length > 1) {
      throw new Error('Remove everyone else from the team before deleting it');
    }

    // Mirrors the ON DELETE CASCADE chain hanging off projects.
    const drop = (arr, pred) => {
      for (let i = arr.length - 1; i >= 0; i -= 1) if (pred(arr[i])) arr.splice(i, 1);
    };
    drop(teamMembers, (tm) => tm.team_id === team.id);
    drop(teams, (t) => t.id === team.id);
    drop(projectRolesNeeded, (r) => r.project_id === project.id);
    drop(joinRequests, (r) => r.project_id === project.id);
    drop(projects, (p) => p.id === project.id);
    return;
  }

  const { error } = await supabase.rpc('delete_team', { p_team_id: teamId });
  if (error) throw error;
}

// --- Membership ----------------------------------------------------------

// The caller removes themselves from whatever team they're on. Immediate and
// unilateral — see the design note at the top of supabase/05_membership.sql
// for why this isn't gated on the owner approving it.
//
// A project's creator can't leave their own project (projects.creator_id
// points at them); for them the equivalent is deleteTeam(). After the team
// formation deadline a student can't leave (an admin can take them off —
// #39), and the creator is notified either way.
export async function leaveTeam() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const membership = teamMembers.find((tm) => tm.user_id === id);
    if (!membership) throw new Error('You are not on a team');
    const team = teams.find((t) => t.id === membership.team_id);
    const project = projects.find((p) => p.id === team.project_id);
    if (project.creator_id === id) {
      throw new Error('You created this project, so you cannot leave it — delete the team instead');
    }
    const deadline = appSettings.formation_deadline;
    if (deadline && new Date(deadline) <= new Date()) {
      throw new Error('The team formation deadline has passed — ask an admin if you need to leave');
    }

    teamMembers.splice(teamMembers.indexOf(membership), 1);
    syncProjectFillState(project, team);
    notifications.push({
      id: `n-${Date.now()}-${notifications.length}`,
      user_id: project.creator_id,
      kind: 'member_left',
      project_id: project.id,
      actor_id: id,
      by_admin: false,
      created_at: new Date().toISOString(),
      read_at: null,
    });
    return;
  }

  const { error } = await supabase.rpc('leave_team');
  if (error) throw error;
}

// The project's creator removes someone else from the roster, or an admin
// removes any student but the creator. Mirrors remove_member()
// (supabase/22_remove_member_rules.sql): after the team formation deadline
// only an admin can, and the removed student is notified. The creator is
// only notified when it was an admin.
export async function removeMember(userId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const isAdmin = Boolean(users.find((u) => u.id === id)?.is_admin);
    if (userId === id) throw new Error('You cannot remove yourself — delete the team instead');
    const membership = teamMembers.find((tm) => tm.user_id === userId);
    if (!membership) throw new Error('That student is not on a team');
    const team = teams.find((t) => t.id === membership.team_id);
    const project = projects.find((p) => p.id === team.project_id);
    if (project.creator_id !== id && !isAdmin) {
      throw new Error('Only the project creator can remove a member');
    }
    if (userId === project.creator_id) {
      throw new Error('The project creator cannot be removed — delete the team instead');
    }
    const deadline = appSettings.formation_deadline;
    if (!isAdmin && deadline && new Date(deadline) <= new Date()) {
      throw new Error('The team formation deadline has passed — ask an admin to remove them');
    }

    teamMembers.splice(teamMembers.indexOf(membership), 1);
    syncProjectFillState(project, team);
    const notify = (n) =>
      notifications.push({
        id: `n-${Date.now()}-${notifications.length}`,
        project_id: project.id,
        by_admin: isAdmin,
        created_at: new Date().toISOString(),
        read_at: null,
        ...n,
      });
    notify({ user_id: userId, kind: 'member_removed', actor_id: id });
    if (isAdmin) notify({ user_id: project.creator_id, kind: 'member_left', actor_id: userId });
    return;
  }

  const { error } = await supabase.rpc('remove_member', { p_user_id: userId });
  if (error) throw error;
}

// DEMO ONLY: the project's creator changes a teammate's (or their own) role.
// Gives back the old role's seat and takes one of the new role's — see
// supabase/25_demo_set_member_role.sql.
export async function setMemberRole(userId, roleId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    if (!roleId || !allRoles.some((r) => r.id === roleId)) throw new Error('Pick a role');
    const membership = teamMembers.find((tm) => tm.user_id === userId);
    if (!membership) throw new Error('That student is not on a team');
    const team = teams.find((t) => t.id === membership.team_id);
    const project = projects.find((p) => p.id === team.project_id);
    if (project.creator_id !== id) throw new Error('Only the project creator can change roles');
    if (membership.role_id === roleId) return membership;

    const need = (rid) =>
      projectRolesNeeded.find((n) => n.project_id === project.id && n.role_id === rid);
    const old = membership.role_id && need(membership.role_id);
    if (old) old.quantity_needed += 1;
    const next = need(roleId);
    if (next && next.quantity_needed > 0) next.quantity_needed -= 1;
    membership.role_id = roleId;
    return membership;
  }

  const { data, error } = await supabase.rpc('set_member_role', {
    p_user_id: userId,
    p_role_id: roleId,
  });
  if (error) throw error;
  return data;
}

// --- Notifications -------------------------------------------------------

// The viewer's unread notifications, newest first. Kinds: 'join_request'
// (someone asked to join a project the viewer created), 'member_left'
// (someone left, or an admin took them off, a project the viewer created),
// 'member_removed' (the viewer was taken off a team), 'request_accepted' and
// 'request_declined'. actor_name is whoever caused the notification — for
// 'join_request', who asked; for 'member_left', who left; for
// 'member_removed', who removed the viewer.
// project_title is included because a removed student is no longer on the
// project, so the app has nowhere else to look it up.
export async function getNotifications() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    return notifications
      .filter((n) => n.user_id === id && !n.read_at)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .map((n) => ({
        ...n,
        actor_name: users.find((u) => u.id === n.actor_id)?.name ?? 'Someone',
        project_title: projects.find((p) => p.id === n.project_id)?.title ?? 'a project',
      }));
  }

  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, project_id, actor_id, by_admin, created_at, read_at, actor:users!actor_id ( name ), project:projects ( title )')
    .is('read_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data.map(({ actor, project, ...n }) => ({
    ...n,
    actor_name: actor?.name ?? 'Someone',
    project_title: project?.title ?? 'a project',
  }));
}

export async function markNotificationsRead(ids) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const now = new Date().toISOString();
    for (const n of notifications) {
      if (n.user_id === id && ids.includes(n.id) && !n.read_at) n.read_at = now;
    }
    return;
  }

  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids });
  if (error) throw error;
}

// Mirrors sync_project_fill_state(): a roster change in either direction
// settles the same way, so freeing a seat reopens a project that had filled.
function syncProjectFillState(project, team) {
  const count = teamMembers.filter((tm) => tm.team_id === team.id).length;
  const full = count >= project.team_size_target;
  project.status = full ? 'full' : 'open';
  team.formed_at = full ? team.formed_at || new Date().toISOString() : null;
}
