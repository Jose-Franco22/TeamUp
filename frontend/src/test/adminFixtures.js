export const OPEN_TEAM = {
  id: 'team-open', project_id: 'project-open', title: 'Campus parking tracker',
  description: 'Track campus parking availability.', creator_id: 'owner', creator_name: 'Nicolas Guerra',
  team_size_target: 4, member_count: 1, status: 'open', formed_at: null,
  members: [{ user_id: 'owner', name: 'Nicolas Guerra', role_id: 'backend', role_name: 'Backend Developer', availability_hours: 14 }],
  roles_needed: [{ role_id: 'frontend', role_name: 'Frontend Developer', skill_id: null, quantity_needed: 2 }],
  pending_requests: [{ id: 'request', user_id: 'adan', user_name: 'Adan Barrera' }],
};

export const FULL_TEAM = {
  id: 'team-full', project_id: 'project-full', title: 'Lab equipment sign-out', description: 'Manage shared hardware.',
  creator_id: 'omar', creator_name: 'Omar Molina', team_size_target: 2, member_count: 2, status: 'full',
  formed_at: '2026-10-12T14:00:00Z', roles_needed: [], pending_requests: [],
  members: [
    { user_id: 'omar', name: 'Omar Molina', role_id: 'backend', role_name: 'Backend Developer', availability_hours: 12 },
    { user_id: 'priya', name: 'Priya Vale', role_id: 'design', role_name: 'UI/UX Designer', availability_hours: 10 },
  ],
};

export const UNPLACED_STUDENT = {
  id: 'adan', name: 'Adan Barrera', email: 'abarrera01@utrgv.edu', bio: 'I enjoy building interfaces.',
  availability_hours: 12, github_url: 'https://github.com/adanbarrera', membership: null,
  skills: [{ id: 'react', name: 'React', category: 'Frontend', source: 'manual' }],
  pending_requests: [{ id: 'request', project_id: 'project-open', team_id: 'team-open', project_title: 'Campus parking tracker' }],
};

export const QUIET_STUDENT = {
  id: 'rita', name: 'Rita Cano', email: 'rcano01@utrgv.edu', bio: '', availability_hours: 6,
  github_url: '', membership: null, skills: [], pending_requests: [],
};

export const DASHBOARD = {
  summary: { formed_teams: 1, open_teams: 1, unplaced_students: 2 },
  teams: [OPEN_TEAM, FULL_TEAM], unplaced_students: [UNPLACED_STUDENT, QUIET_STUDENT],
};

export const EMPTY_DASHBOARD = {
  summary: { formed_teams: 0, open_teams: 0, unplaced_students: 0 }, teams: [], unplaced_students: [],
};
