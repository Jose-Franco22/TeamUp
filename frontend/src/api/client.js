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
  buildProject,
  skillsForUser,
} from './mockData';
import { supabase } from '../lib/supabaseClient';

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

// Shapes one `projects` row (as fetched via PROJECT_SELECT) into the same
// object buildProject() produces from the mocks.
async function composeProject(row, viewerId, viewerRequestsByProject) {
  // `skills` embeds as null when skill_id is null — a role listed without a
  // specific skill attached, which the schema allows on purpose.
  const roles_needed = (row.project_roles_needed || []).map((r) => ({
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
    // Authenticated: full member list, per TODO-backend.md.
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
    // Guest: team_members RLS returns nothing, so get the count from the
    // one function that's allowed to see past that (see 03_functions.sql).
    const { data: count, error } = await supabase.rpc('project_member_count', { p_project_id: row.id });
    if (error) throw error;
    member_count = count ?? 0;
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

export async function getProjects() {
  if (USE_MOCKS) {
    await delay();
    return projects.map((p) => buildProject(p, sessionUserId));
  }
  const viewerId = await getViewerId();
  const [{ data: rows, error }, requestMap] = await Promise.all([
    supabase.from('projects').select(PROJECT_SELECT).order('created_at', { ascending: false }),
    fetchViewerRequestMap(viewerId),
  ]);
  if (error) throw error;
  return Promise.all(rows.map((row) => composeProject(row, viewerId, requestMap)));
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
  return composeProject(row, viewerId, requestMap);
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
  // A senior project team is 2 to 4 students. Checked here so both modes
  // reject it the same way; create_project() must re-check server-side.
  if (team_size_target < MIN_TEAM_SIZE || team_size_target > MAX_TEAM_SIZE) {
    throw new Error(`A team has to be between ${MIN_TEAM_SIZE} and ${MAX_TEAM_SIZE} people`);
  }

  if (!creator_role_id) throw new Error('A role is required to create a project');

  // (project_id, role_id) is the primary key — the same role twice would be
  // a constraint violation, so reject it here with a readable message. The
  // form prevents it too, but this is the shared check both modes run.
  const seen = new Set();
  for (const r of roles_needed) {
    if (!r.role_id) throw new Error('Every role you list needs a role selected');
    if (seen.has(r.role_id)) throw new Error('You listed the same role twice');
    seen.add(r.role_id);
  }
  assertRolesMatchSkills(roles_needed);

  // The creator is seated by createProject itself, so the roles listed here
  // are recruiting for the *remaining* seats — one fewer than the target.
  // Without this you could set a team of 3 and then ask for eight people.
  const openSeats = team_size_target - 1;
  const assigned = roles_needed.reduce((sum, r) => sum + (Number(r.quantity_needed) || 0), 0);
  if (assigned > openSeats) {
    throw new Error(
      `A team of ${team_size_target} has ${openSeats} open seat${openSeats === 1 ? '' : 's'} ` +
        `besides you, but you listed ${assigned} people`
    );
  }

  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    // A student can only be on one team — same rule as createJoinRequest.
    const onAnyTeam = teamMembers.some((tm) => tm.user_id === id);
    if (onAnyTeam) throw new Error('You are already on a team and cannot create another project');

    const projectId = `p-${Date.now()}`;
    const project = {
      id: projectId,
      creator_id: id,
      title,
      description,
      team_size_target,
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
    p_title: title,
    p_description: description,
    p_team_size_target: team_size_target,
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
export async function updateProject(projectId, { title, description, team_size_target, own_role_id, roles_needed }) {
  if (team_size_target < MIN_TEAM_SIZE || team_size_target > MAX_TEAM_SIZE) {
    throw new Error(`A team has to be between ${MIN_TEAM_SIZE} and ${MAX_TEAM_SIZE} people`);
  }
  if (!own_role_id) throw new Error('A role is required');

  const seen = new Set();
  for (const r of roles_needed) {
    if (!r.role_id) throw new Error('Every role you list needs a role selected');
    if (seen.has(r.role_id)) throw new Error('You listed the same role twice');
    seen.add(r.role_id);
  }
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
      title,
      description,
      team_size_target,
      status: roster.length >= team_size_target ? 'full' : 'open',
    });
    team.formed_at = roster.length >= team_size_target ? team.formed_at || new Date().toISOString() : null;

    const mine = roster.find((tm) => tm.user_id === id);
    mine.role_id = own_role_id;

    for (let i = projectRolesNeeded.length - 1; i >= 0; i -= 1) {
      if (projectRolesNeeded[i].project_id === projectId) projectRolesNeeded.splice(i, 1);
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
    p_title: title,
    p_description: description,
    p_team_size_target: team_size_target,
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

// --- Current user ------------------------------------------------------

const USER_SELECT = 'id, email, name, bio, availability_hours, github_url, user_skills ( source, skills ( id, name, category ) )';

function shapeUserRow(data) {
  const { user_skills, ...profile } = data;
  return { ...profile, skills: (user_skills || []).map((us) => ({ ...us.skills, source: us.source })) };
}

export async function getCurrentUser() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const u = users.find((x) => x.id === id);
    return { ...u, skills: skillsForUser(id) };
  }
  const viewerId = requireViewerId(await getViewerId());
  const { data, error } = await supabase.from('users').select(USER_SELECT).eq('id', viewerId).single();
  if (error) throw error;
  return shapeUserRow(data);
}

export async function updateCurrentUser(patch) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const u = users.find((x) => x.id === id);
    Object.assign(u, patch);
    return { ...u, skills: skillsForUser(id) };
  }
  const viewerId = requireViewerId(await getViewerId());
  const { error } = await supabase.from('users').update(patch).eq('id', viewerId);
  if (error) throw error;
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

export async function createJoinRequest(projectId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
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
    return row;
  }
  // create_join_request() runs all four checks and the insert in one
  // transaction server-side — see supabase/03_functions.sql.
  const { data, error } = await supabase.rpc('create_join_request', { p_project_id: projectId });
  if (error) throw error;
  return data;
}

// `roleId` is the creator's pick from the project's roles_needed — a
// roles.id, not a free-text string (see 04_roles_and_team_deletion.sql) —
// and only applies when accepting.
export async function respondToRequest(requestId, status, roleId) {
  if (USE_MOCKS) {
    await delay();
    const r = joinRequests.find((x) => x.id === requestId);
    if (!r) throw new Error('Request not found');

    // Every check runs before anything is mutated. respond_to_join_request
    // is one transaction server-side, so a rejected accept must not leave
    // the request marked 'accepted' with nobody actually on the roster.
    if (status === 'accepted') {
      if (!roleId) throw new Error('A role is required to accept a request');
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
      const team = teams.find((t) => t.project_id === r.project_id);
      teamMembers.push({ team_id: team.id, user_id: r.user_id, role_id: roleId });
      const project = projects.find((p) => p.id === r.project_id);
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
    return r;
  }
  // respond_to_join_request() is the one-transaction accept/decline flow —
  // see supabase/03_functions.sql for the full explanation.
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

  const [{ data: projectRow, error: projErr }, requestMap] = await Promise.all([
    supabase.from('projects').select(PROJECT_SELECT).eq('id', teamRow.project_id).single(),
    fetchViewerRequestMap(viewerId),
  ]);
  if (projErr) throw projErr;
  const project = await composeProject(projectRow, viewerId, requestMap);

  // GET /api/me/team enriches each teammate with availability_hours/skills,
  // unlike the plain project views — see TODO-backend.md.
  const { data: memberRows, error: membersErr } = await supabase
    .from('team_members')
    .select('user_id, role_id, roles ( name ), users ( name, availability_hours, user_skills ( skills ( name ) ) )')
    .eq('team_id', membership.team_id);
  if (membersErr) throw membersErr;

  return {
    ...project,
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
// points at them); for them the equivalent is deleteTeam().
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

    teamMembers.splice(teamMembers.indexOf(membership), 1);
    syncProjectFillState(project, team);
    return;
  }

  const { error } = await supabase.rpc('leave_team');
  if (error) throw error;
}

// The project's creator removes someone else from the roster.
export async function removeMember(userId) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    if (userId === id) throw new Error('You cannot remove yourself — delete the team instead');
    const membership = teamMembers.find((tm) => tm.user_id === userId);
    if (!membership) throw new Error('That student is not on a team');
    const team = teams.find((t) => t.id === membership.team_id);
    const project = projects.find((p) => p.id === team.project_id);
    if (project.creator_id !== id) throw new Error('Only the team owner can remove a member');

    teamMembers.splice(teamMembers.indexOf(membership), 1);
    syncProjectFillState(project, team);
    return;
  }

  const { error } = await supabase.rpc('remove_member', { p_user_id: userId });
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
