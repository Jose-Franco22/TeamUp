// Mock data for local development.
//
// Every object here uses the exact column names from the database schema
// (snake_case, as Postgres returns them). When the backend is ready, the
// only thing that changes is the fetch in client.js — no component has to
// be touched, because the shapes already match.

// --- ROLES -------------------------------------------------------------
// roles: id, name, sort_order
//
// A role is what a person *does* on the team; a skill is a technology they
// know. project_roles_needed points at both (the skill is optional), and
// team_members.role_id points at one of these — see
// supabase/04_roles_and_team_deletion.sql, which replaced the free-text
// team_members.role column this file used to mirror.
// skill_categories is which skills.category values make sense for a role —
// what stops "Frontend Developer + pandas". See the note in
// supabase/04_roles_and_team_deletion.sql.
export const roles = [
  { id: 'r-pm', name: 'Project Manager', sort_order: 10, skill_categories: ['Tools'] },
  { id: 'r-frontend', name: 'Frontend Developer', sort_order: 20, skill_categories: ['Frontend'] },
  { id: 'r-backend', name: 'Backend Developer', sort_order: 30, skill_categories: ['Backend'] },
  { id: 'r-fullstack', name: 'Full-stack Developer', sort_order: 40, skill_categories: ['Frontend', 'Backend'] },
  { id: 'r-design', name: 'UI/UX Designer', sort_order: 50, skill_categories: ['Frontend'] },
  { id: 'r-data', name: 'Data / ML', sort_order: 60, skill_categories: ['Data'] },
  { id: 'r-qa', name: 'QA & Testing', sort_order: 70, skill_categories: ['Tools'] },
  { id: 'r-devops', name: 'DevOps', sort_order: 80, skill_categories: ['Backend', 'Tools'] },
  { id: 'r-writer', name: 'Technical Writer', sort_order: 90, skill_categories: ['Tools'] },
];

const roleById = Object.fromEntries(roles.map((r) => [r.id, r]));

// --- SKILLS ------------------------------------------------------------
// skills: id, name, category
export const skills = [
  { id: 's-react', name: 'React', category: 'Frontend' },
  { id: 's-js', name: 'JavaScript', category: 'Frontend' },
  { id: 's-figma', name: 'Figma', category: 'Frontend' },
  { id: 's-node', name: 'Node.js', category: 'Backend' },
  { id: 's-pg', name: 'PostgreSQL', category: 'Backend' },
  { id: 's-express', name: 'Express', category: 'Backend' },
  { id: 's-python', name: 'Python', category: 'Data' },
  { id: 's-pandas', name: 'pandas', category: 'Data' },
  { id: 's-opencv', name: 'OpenCV', category: 'Data' },
  { id: 's-sklearn', name: 'scikit-learn', category: 'Data' },
  { id: 's-jest', name: 'Jest', category: 'Tools' },
  { id: 's-git', name: 'Git', category: 'Tools' },
];

const skillById = Object.fromEntries(skills.map((s) => [s.id, s]));

// --- USERS -------------------------------------------------------------
// users: id, email, name, bio, availability_hours, github_url
export const users = [
  {
    id: 'u-adan',
    email: 'abarrera01@utrgv.edu',
    name: 'Adan Barrera',
    bio: "Senior CS major. I like building interfaces and I've done two React projects. Looking for a team working on something with a real user, not just a demo.",
    availability_hours: 12,
    github_url: 'https://github.com/adanbarrera',
  },
  {
    id: 'u-nicolas',
    email: 'nguerra01@utrgv.edu',
    name: 'Nicolas Guerra',
    bio: 'Backend and databases. Interested in anything with a real data pipeline behind it.',
    availability_hours: 14,
    github_url: 'https://github.com/nguerra',
  },
  {
    id: 'u-jose',
    email: 'jgarza01@utrgv.edu',
    name: 'Jose Franco Garza',
    bio: 'Data and computer vision. Comfortable with Python tooling.',
    availability_hours: 12,
    github_url: 'https://github.com/Jose-Franco22',
  },
  {
    id: 'u-alexis',
    email: 'acovarrubias01@utrgv.edu',
    name: 'Alexis Covarrubias',
    bio: 'Algorithms and optimization. Want to work on something with a hard core problem.',
    availability_hours: 10,
    github_url: 'https://github.com/acovarrubias',
  },
  { id: 'u-maria', email: 'mreyna01@utrgv.edu', name: 'Maria Reyna', bio: '', availability_hours: 16, github_url: '' },
  { id: 'u-luis', email: 'ltrevino01@utrgv.edu', name: 'Luis Trevino', bio: '', availability_hours: 15, github_url: '' },
  { id: 'u-dana', email: 'dkim01@utrgv.edu', name: 'Dana Kim', bio: '', availability_hours: 14, github_url: '' },
  { id: 'u-priya', email: 'pvale01@utrgv.edu', name: 'Priya Vale', bio: '', availability_hours: 10, github_url: '' },
  { id: 'u-omar', email: 'omolina01@utrgv.edu', name: 'Omar Molina', bio: '', availability_hours: 12, github_url: '' },
  { id: 'u-rita', email: 'rcano01@utrgv.edu', name: 'Rita Cano', bio: '', availability_hours: 6, github_url: '' },
  // Unteamed students. Eight of the ten accounts above are already seated
  // on a fixture team, which is correct data but made the app look broken
  // in mock mode: create a project, sign in as anyone else, and the button
  // reads "Already on a team." These exist so there's a pool of people who
  // can actually send a request. Keep several of them free — see the
  // invariant on teamMembers below.
  { id: 'u-sofia', email: 'sgarza02@utrgv.edu', name: 'Sofia Garza', bio: 'Frontend, a lot of CSS. Want a project people outside class will use.', availability_hours: 14, github_url: '' },
  { id: 'u-marcus', email: 'mhall01@utrgv.edu', name: 'Marcus Hall', bio: 'Backend and APIs. Happy to own deployment too.', availability_hours: 11, github_url: '' },
  { id: 'u-ana', email: 'avillarreal01@utrgv.edu', name: 'Ana Villarreal', bio: 'Data and notebooks. Looking for something with messy real data.', availability_hours: 9, github_url: '' },
  { id: 'u-derek', email: 'dcho01@utrgv.edu', name: 'Derek Cho', bio: 'I like testing and keeping a project organized.', availability_hours: 8, github_url: '' },
];

const userById = Object.fromEntries(users.map((u) => [u.id, u]));

// --- USER_SKILLS -------------------------------------------------------
// user_skills: user_id, skill_id, source ('manual' | 'resume')
// Joined with skills so the client gets name and category in one response.
export const userSkills = [
  { user_id: 'u-adan', skill_id: 's-react', source: 'manual' },
  { user_id: 'u-adan', skill_id: 's-js', source: 'manual' },
  { user_id: 'u-adan', skill_id: 's-figma', source: 'resume' },
  { user_id: 'u-adan', skill_id: 's-node', source: 'manual' },
  { user_id: 'u-adan', skill_id: 's-pg', source: 'resume' },
  { user_id: 'u-adan', skill_id: 's-git', source: 'manual' },
  { user_id: 'u-adan', skill_id: 's-jest', source: 'manual' },

  { user_id: 'u-nicolas', skill_id: 's-node', source: 'manual' },
  { user_id: 'u-nicolas', skill_id: 's-pg', source: 'manual' },
  { user_id: 'u-nicolas', skill_id: 's-express', source: 'manual' },

  { user_id: 'u-jose', skill_id: 's-python', source: 'manual' },
  { user_id: 'u-jose', skill_id: 's-pandas', source: 'manual' },
  { user_id: 'u-jose', skill_id: 's-opencv', source: 'manual' },

  { user_id: 'u-alexis', skill_id: 's-python', source: 'manual' },
  { user_id: 'u-alexis', skill_id: 's-sklearn', source: 'manual' },

  { user_id: 'u-maria', skill_id: 's-python', source: 'manual' },
  { user_id: 'u-maria', skill_id: 's-sklearn', source: 'manual' },
  { user_id: 'u-luis', skill_id: 's-node', source: 'manual' },
  { user_id: 'u-dana', skill_id: 's-pandas', source: 'manual' },
  { user_id: 'u-priya', skill_id: 's-figma', source: 'manual' },
  { user_id: 'u-omar', skill_id: 's-node', source: 'manual' },
  { user_id: 'u-rita', skill_id: 's-python', source: 'manual' },
  { user_id: 'u-sofia', skill_id: 's-react', source: 'manual' },
  { user_id: 'u-sofia', skill_id: 's-js', source: 'manual' },
  { user_id: 'u-sofia', skill_id: 's-figma', source: 'resume' },
  { user_id: 'u-marcus', skill_id: 's-node', source: 'manual' },
  { user_id: 'u-marcus', skill_id: 's-express', source: 'manual' },
  { user_id: 'u-marcus', skill_id: 's-pg', source: 'manual' },
  { user_id: 'u-ana', skill_id: 's-python', source: 'manual' },
  { user_id: 'u-ana', skill_id: 's-pandas', source: 'manual' },
  { user_id: 'u-ana', skill_id: 's-sklearn', source: 'resume' },
  { user_id: 'u-derek', skill_id: 's-jest', source: 'manual' },
  { user_id: 'u-derek', skill_id: 's-git', source: 'manual' },
];

export function skillsForUser(userId) {
  return userSkills
    .filter((us) => us.user_id === userId)
    .map((us) => ({ ...skillById[us.skill_id], source: us.source }));
}

// --- PROJECTS ----------------------------------------------------------
// projects: id, creator_id, title, description, team_size_target, status
export const projects = [
  {
    id: 'p-parking',
    creator_id: 'u-nicolas',
    title: 'Campus parking tracker',
    description:
      'Live lot occupancy estimated from existing camera feeds, with a map of where spaces are opening up.',
    team_size_target: 4,
    status: 'open',
  },
  {
    id: 'p-degree',
    creator_id: 'u-alexis',
    title: 'Degree plan builder',
    description:
      'Constraint solver that generates a valid path to graduation from prerequisites and offering patterns.',
    team_size_target: 3,
    status: 'open',
  },
  {
    id: 'p-scam',
    creator_id: 'u-maria',
    title: 'Scam text detector',
    description:
      'Classifier for fraudulent SMS with an explanation of which signals fired, aimed at first-time job seekers.',
    team_size_target: 4,
    status: 'open',
  },
  {
    id: 'p-lab',
    creator_id: 'u-omar',
    title: 'Lab equipment sign-out',
    description:
      'Reservation system for shared hardware with conflict detection and a checkout history.',
    // Started at a target of 4; Rita and Adan were removed from the roster
    // below because a student can only be on one team, and both had
    // pending requests elsewhere. Target dropped to match the 2 remaining
    // members rather than backfilling with invented people.
    team_size_target: 2,
    status: 'full',
  },
];

// --- PROJECT_ROLES_NEEDED ---------------------------------------------
// project_roles_needed: project_id, role_id, skill_id, quantity_needed
//
// Keyed on (project_id, role_id): a project asks for N of a *role*, and may
// optionally tag it with the key skill it wants for that role. skill_id is
// nullable — a Project Manager has no entry in the skills taxonomy.
//
// Also returned as `roles_needed` (see buildProject() below) on each entry
// of GET /api/requests's `incoming` array — the project creator picks a
// role from that list when accepting an applicant, so the client needs it
// without a second fetch. See client.js's getRequests()/respondToRequest().
export const projectRolesNeeded = [
  { project_id: 'p-parking', role_id: 'r-frontend', skill_id: 's-react', quantity_needed: 2 },
  { project_id: 'p-parking', role_id: 'r-design', skill_id: 's-figma', quantity_needed: 1 },
  { project_id: 'p-degree', role_id: 'r-frontend', skill_id: 's-react', quantity_needed: 1 },
  { project_id: 'p-degree', role_id: 'r-backend', skill_id: 's-pg', quantity_needed: 1 },
  { project_id: 'p-scam', role_id: 'r-qa', skill_id: 's-jest', quantity_needed: 1 },
  // A role with no skill attached — skill_id is nullable, which is what
  // makes "we need a project manager" expressible at all.
  { project_id: 'p-scam', role_id: 'r-pm', skill_id: null, quantity_needed: 1 },
];

// --- TEAMS / TEAM_MEMBERS ---------------------------------------------
// teams: id, project_id, formed_at
// team_members: team_id, user_id, role_id
//
// Invariant: a user can hold at most one team_members row — a student is
// on one senior project team at a time. createJoinRequest() in client.js
// enforces this (rejects a request from anyone already on a team), and
// respondToRequest() declines a user's other pending requests when one of
// them is accepted. The fixtures below must never contradict this: no
// user_id here should also appear on a 'pending' row in joinRequests.
export const teams = [
  { id: 't-parking', project_id: 'p-parking', formed_at: null },
  { id: 't-degree', project_id: 'p-degree', formed_at: null },
  { id: 't-scam', project_id: 'p-scam', formed_at: null },
  { id: 't-lab', project_id: 'p-lab', formed_at: '2026-10-14T16:00:00Z' },
];

export const teamMembers = [
  { team_id: 't-parking', user_id: 'u-nicolas', role_id: 'r-backend' },
  { team_id: 't-parking', user_id: 'u-jose', role_id: 'r-data' },
  { team_id: 't-degree', user_id: 'u-alexis', role_id: 'r-fullstack' },
  { team_id: 't-scam', user_id: 'u-maria', role_id: 'r-data' },
  { team_id: 't-scam', user_id: 'u-luis', role_id: 'r-backend' },
  { team_id: 't-scam', user_id: 'u-dana', role_id: 'r-data' },
  { team_id: 't-lab', user_id: 'u-omar', role_id: 'r-backend' },
  { team_id: 't-lab', user_id: 'u-priya', role_id: 'r-design' },
];

// --- JOIN_REQUESTS -----------------------------------------------------
// join_requests: id, project_id, user_id, status
//
// Adan and Rita are deliberately unteamed here (see the invariant above) so
// their pending requests below are valid states, not conflicts. Sofia,
// Marcus, Ana and Derek are unteamed too and have no requests out at all --
// they are the accounts to sign in as when testing 'request to join'.
export const joinRequests = [
  { id: 'jr-1', project_id: 'p-parking', user_id: 'u-adan', status: 'pending', created_at: '2026-09-01T14:00:00Z' },
  { id: 'jr-2', project_id: 'p-parking', user_id: 'u-rita', status: 'pending', created_at: '2026-08-31T09:00:00Z' },
  { id: 'jr-3', project_id: 'p-degree', user_id: 'u-adan', status: 'pending', created_at: '2026-08-30T11:00:00Z' },
  { id: 'jr-4', project_id: 'p-lab', user_id: 'u-adan', status: 'declined', created_at: '2026-08-26T11:00:00Z' },
];

// --- Composition helpers ----------------------------------------------
// These stand in for the joins the backend will do. Keeping them here
// documents exactly what each endpoint is expected to return.

// The viewer's own join_requests status for a project — null (never
// requested), 'pending', 'accepted', or 'declined'. A pending request
// wins over an older declined one so the UI can disable "Request to
// join" while a request is outstanding. This is part of the API
// contract: GET /api/projects and GET /api/projects/:id must return
// viewer_request_status computed from the *authenticated* caller's own
// requests (null for an unauthenticated caller) — never from a
// client-supplied user id.
function viewerRequestStatus(projectId, viewerId) {
  if (!viewerId) return null;
  const requests = joinRequests.filter((r) => r.project_id === projectId && r.user_id === viewerId);
  if (requests.length === 0) return null;
  const pending = requests.find((r) => r.status === 'pending');
  if (pending) return 'pending';
  return requests.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0].status;
}

export function buildProject(project, viewerId = null) {
  const team = teams.find((t) => t.project_id === project.id);
  const members = team
    ? teamMembers
        .filter((tm) => tm.team_id === team.id)
        .map((tm) => ({
          user_id: tm.user_id,
          name: userById[tm.user_id].name,
          role_id: tm.role_id,
          role: roleById[tm.role_id]?.name ?? null,
        }))
    : [];

  // skill_id is nullable, so skill_name/category come back null for a role
  // listed without a specific skill attached to it.
  const roles_needed = projectRolesNeeded
    .filter((r) => r.project_id === project.id)
    .map((r) => ({
      role_id: r.role_id,
      role_name: roleById[r.role_id].name,
      skill_id: r.skill_id ?? null,
      skill_name: r.skill_id ? skillById[r.skill_id].name : null,
      category: r.skill_id ? skillById[r.skill_id].category : null,
      quantity_needed: r.quantity_needed,
    }));

  const avgHours = members.length
    ? Math.round(members.reduce((sum, m) => sum + userById[m.user_id].availability_hours, 0) / members.length)
    : 0;

  return {
    ...project,
    creator_name: userById[project.creator_id].name,
    team_id: team ? team.id : null,
    formed_at: team ? team.formed_at : null,
    members,
    roles_needed,
    member_count: members.length,
    avg_availability_hours: avgHours,
    viewer_request_status: viewerRequestStatus(project.id, viewerId),
  };
}
