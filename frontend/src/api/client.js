// API client.
//
// Every component calls these functions and nothing else. While
// VITE_USE_MOCKS is true they resolve from mockData; flip the env var and
// they talk to Supabase directly (see supabase/*.sql at the repo root for
// the RLS policies and functions this relies on) — no Express server in
// between. Components are unaffected either way, which is the point.

import {
  projects,
  joinRequests,
  teams,
  teamMembers,
  users,
  buildProject,
  skillsForUser,
} from './mockData';
import { supabase } from '../lib/supabaseClient';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';

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

const PROJECT_SELECT = `
  id, creator_id, title, description, team_size_target, status, created_at,
  creator:users!creator_id ( name ),
  project_roles_needed ( skill_id, quantity_needed, skills ( name, category ) ),
  teams ( id, formed_at, team_members ( user_id, role, users ( name, availability_hours ) ) )
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
  const roles_needed = (row.project_roles_needed || []).map((r) => ({
    skill_id: r.skill_id,
    skill_name: r.skills.name,
    category: r.skills.category,
    quantity_needed: r.quantity_needed,
  }));

  const team = row.teams?.[0] ?? null;
  const rawMembers = team?.team_members ?? [];

  let members = [];
  let member_count = 0;
  let avg_availability_hours = null;

  if (viewerId) {
    // Authenticated: full member list, per TODO-backend.md.
    members = rawMembers.map((tm) => ({ user_id: tm.user_id, name: tm.users.name, role: tm.role }));
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
    project_roles_needed ( skill_id, quantity_needed, skills ( name, category ) ),
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
        skill_id: pr.skill_id,
        skill_name: pr.skills.name,
        category: pr.skills.category,
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
      member_count: r.project.teams?.[0]?.team_members?.length ?? 0,
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

// `role` is the creator's pick from the project's roles_needed (free-text,
// matches team_members.role) and only applies when accepting.
export async function respondToRequest(requestId, status, role) {
  if (USE_MOCKS) {
    await delay();
    const r = joinRequests.find((x) => x.id === requestId);
    if (!r) throw new Error('Request not found');
    r.status = status;

    // Accepting adds the person to the roster, and fills the project once
    // it reaches team_size_target. The backend does this in a transaction.
    if (status === 'accepted') {
      const team = teams.find((t) => t.project_id === r.project_id);
      teamMembers.push({ team_id: team.id, user_id: r.user_id, role: role || null });
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
    p_role: role ?? null,
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
    .select('user_id, role, users ( name, availability_hours, user_skills ( skills ( name ) ) )')
    .eq('team_id', membership.team_id);
  if (membersErr) throw membersErr;

  return {
    ...project,
    members: memberRows.map((tm) => ({
      user_id: tm.user_id,
      name: tm.users.name,
      role: tm.role,
      availability_hours: tm.users.availability_hours,
      skills: (tm.users.user_skills || []).map((us) => us.skills.name),
    })),
  };
}
