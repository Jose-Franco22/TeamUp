// API client.
//
// Every component calls these functions and nothing else. While
// VITE_USE_MOCKS is true they resolve from mockData; flip the env var and
// they hit the real Express API. Components are unaffected either way,
// which is the point — the frontend can be built and tested before the
// backend exists.
//
// Endpoint paths below are the contract the backend needs to implement.

import {
  projects,
  joinRequests,
  teams,
  teamMembers,
  users,
  buildProject,
  skillsForUser,
} from './mockData';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';
const BASE = import.meta.env.VITE_API_BASE || '/api';

// Small delay so loading states are visible during development.
const delay = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// The signed-in user id, set by SessionContext whenever the session
// changes. Stands in for a real session lookup — mock branches below read
// this instead of a hardcoded user, so swapping in Supabase later only
// means changing what SessionContext calls, not any function here.
let sessionUserId = null;
export function setSessionUserId(id) {
  sessionUserId = id;
}

function requireSessionUserId() {
  if (!sessionUserId) throw new Error('Not signed in');
  return sessionUserId;
}

// Attaches auth to real (non-mock) requests. SessionContext supplies this;
// today it's a stub header, later it becomes the Supabase JWT getter — the
// request() call site below never has to change.
let authHeaderProvider = () => ({});
export function setAuthHeaderProvider(fn) {
  authHeaderProvider = fn;
}

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...authHeaderProvider() },
    ...options,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${res.statusText}${body ? ` — ${body}` : ''}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

// --- Projects ----------------------------------------------------------

// GET /api/projects
export async function getProjects() {
  if (USE_MOCKS) {
    await delay();
    return projects.map((p) => buildProject(p, sessionUserId));
  }
  return request('/projects');
}

// GET /api/projects/:id
export async function getProject(id) {
  if (USE_MOCKS) {
    await delay();
    const p = projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    return buildProject(p, sessionUserId);
  }
  return request(`/projects/${id}`);
}

// --- Current user ------------------------------------------------------

// GET /api/me
export async function getCurrentUser() {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const u = users.find((x) => x.id === id);
    return { ...u, skills: skillsForUser(id) };
  }
  return request('/me');
}

// PATCH /api/me
export async function updateCurrentUser(patch) {
  if (USE_MOCKS) {
    await delay();
    const id = requireSessionUserId();
    const u = users.find((x) => x.id === id);
    Object.assign(u, patch);
    return { ...u, skills: skillsForUser(id) };
  }
  return request('/me', { method: 'PATCH', body: JSON.stringify(patch) });
}

// --- Join requests -----------------------------------------------------

// GET /api/requests  → { incoming, outgoing }
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
  return request('/requests');
}

// POST /api/projects/:id/requests
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
  return request(`/projects/${projectId}/requests`, { method: 'POST' });
}

// PATCH /api/requests/:id   body: { status: 'accepted' | 'declined', role? }
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
  return request(`/requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status, role }),
  });
}

// --- Team --------------------------------------------------------------

// GET /api/me/team
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
  return request('/me/team');
}
