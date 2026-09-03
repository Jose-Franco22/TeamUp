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
  CURRENT_USER_ID,
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

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
    return projects.map(buildProject);
  }
  return request('/projects');
}

// GET /api/projects/:id
export async function getProject(id) {
  if (USE_MOCKS) {
    await delay();
    const p = projects.find((x) => x.id === id);
    if (!p) throw new Error('Project not found');
    return buildProject(p);
  }
  return request(`/projects/${id}`);
}

// --- Current user ------------------------------------------------------

// GET /api/me
export async function getCurrentUser() {
  if (USE_MOCKS) {
    await delay();
    const u = users.find((x) => x.id === CURRENT_USER_ID);
    return { ...u, skills: skillsForUser(CURRENT_USER_ID) };
  }
  return request('/me');
}

// PATCH /api/me
export async function updateCurrentUser(patch) {
  if (USE_MOCKS) {
    await delay();
    const u = users.find((x) => x.id === CURRENT_USER_ID);
    Object.assign(u, patch);
    return { ...u, skills: skillsForUser(CURRENT_USER_ID) };
  }
  return request('/me', { method: 'PATCH', body: JSON.stringify(patch) });
}

// --- Join requests -----------------------------------------------------

// GET /api/requests  → { incoming, outgoing }
export async function getRequests() {
  if (USE_MOCKS) {
    await delay();
    const myProjectIds = projects.filter((p) => p.creator_id === CURRENT_USER_ID).map((p) => p.id);

    const incoming = joinRequests
      .filter((r) => myProjectIds.includes(r.project_id) && r.status === 'pending')
      .map((r) => {
        const u = users.find((x) => x.id === r.user_id);
        return {
          ...r,
          user_name: u.name,
          availability_hours: u.availability_hours,
          skills: skillsForUser(r.user_id).map((s) => s.name),
          project_title: projects.find((p) => p.id === r.project_id).title,
        };
      });

    const outgoing = joinRequests
      .filter((r) => r.user_id === CURRENT_USER_ID)
      .map((r) => {
        const p = buildProject(projects.find((x) => x.id === r.project_id));
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
    const existing = joinRequests.find(
      (r) => r.project_id === projectId && r.user_id === CURRENT_USER_ID && r.status === 'pending'
    );
    if (existing) throw new Error('You already have a pending request for this project');
    const row = {
      id: `jr-${Date.now()}`,
      project_id: projectId,
      user_id: CURRENT_USER_ID,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    joinRequests.push(row);
    return row;
  }
  return request(`/projects/${projectId}/requests`, { method: 'POST' });
}

// PATCH /api/requests/:id   body: { status: 'accepted' | 'declined' }
export async function respondToRequest(requestId, status) {
  if (USE_MOCKS) {
    await delay();
    const r = joinRequests.find((x) => x.id === requestId);
    if (!r) throw new Error('Request not found');
    r.status = status;

    // Accepting adds the person to the roster, and fills the project once
    // it reaches team_size_target. The backend does this in a transaction.
    if (status === 'accepted') {
      const team = teams.find((t) => t.project_id === r.project_id);
      teamMembers.push({ team_id: team.id, user_id: r.user_id, role: null });
      const project = projects.find((p) => p.id === r.project_id);
      const count = teamMembers.filter((tm) => tm.team_id === team.id).length;
      if (count >= project.team_size_target) {
        project.status = 'full';
        team.formed_at = new Date().toISOString();
      }
    }
    return r;
  }
  return request(`/requests/${requestId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// --- Team --------------------------------------------------------------

// GET /api/me/team
export async function getMyTeam() {
  if (USE_MOCKS) {
    await delay();
    const membership = teamMembers.find((tm) => tm.user_id === CURRENT_USER_ID);
    if (!membership) return null;
    const team = teams.find((t) => t.id === membership.team_id);
    const project = buildProject(projects.find((p) => p.id === team.project_id));
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
