// Everything the engine scores, in one shape.
//
// Real data comes from the team's fixtures in frontend/src/api/mockData.js,
// which use the same column names as the Supabase tables. Two things the
// schema has nowhere to store yet come from fixtures/ and are temporary:
// resume evidence (months of use, project counts) and a cohort large enough
// to search over. When those tables exist, only this file changes.

import { readFileSync } from 'node:fs';
import {
  skills,
  users,
  userSkills,
  projects,
  projectRolesNeeded,
  teams,
  teamMembers,
} from '../../frontend/src/api/mockData.js';

const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

export function loadWorld({ includeCohort = true } = {}) {
  const skillById = Object.fromEntries(skills.map((s) => [s.id, s]));
  const { evidence } = readFixture('test-evidence.json');
  const cohort = includeCohort
    ? readFixture('test-cohort.json')
    : { users: [], user_skills: [], evidence: {} };

  const allUsers = [...users, ...cohort.users];
  const allUserSkills = [...userSkills, ...cohort.user_skills];
  const allEvidence = { ...evidence, ...cohort.evidence };
  const takenUserIds = new Set(teamMembers.map((m) => m.user_id));

  const skillsByUser = {};
  for (const row of allUserSkills) {
    const backing = allEvidence[row.user_id]?.[row.skill_id] ?? { months: 0, projects: 0 };
    (skillsByUser[row.user_id] ??= {})[row.skill_id] = { source: row.source, ...backing };
  }

  const students = allUsers.map((user) => ({
    id: user.id,
    name: user.name,
    availability_hours: user.availability_hours ?? 0,
    skills: skillsByUser[user.id] ?? {},
    onTeam: takenUserIds.has(user.id),
    synthetic: user.id.startsWith('syn-'),
  }));
  const studentById = Object.fromEntries(students.map((s) => [s.id, s]));

  const teamByProject = Object.fromEntries(teams.map((t) => [t.project_id, t]));
  const projectViews = projects.map((project) => {
    const team = teamByProject[project.id];
    const members = teamMembers
      .filter((m) => team && m.team_id === team.id)
      .map((m) => ({ ...studentById[m.user_id], role: m.role }));
    const roles = projectRolesNeeded
      .filter((r) => r.project_id === project.id)
      .map((r) => ({
        skill_id: r.skill_id,
        skill_name: skillById[r.skill_id].name,
        quantity_needed: r.quantity_needed,
      }));
    return {
      ...project,
      members,
      roles,
      seatsOpen: Math.max(0, project.team_size_target - members.length),
    };
  });

  return {
    skills,
    skillById,
    students,
    studentById,
    projects: projectViews,
    projectById: Object.fromEntries(projectViews.map((p) => [p.id, p])),
  };
}

// Who may be recommended: not already on a team, and not the creator, who is
// on the roster already. Mirrors the checks in create_join_request().
export function eligibleCandidates(world, project) {
  return world.students.filter((s) => !s.onTeam && s.id !== project.creator_id);
}

// One slot per person a role still needs.
//
// Assumption: project_roles_needed lists what is still open. The schema can't
// prove that yet, because team_members.role is free text and can't be matched
// back to a skill_id (see "Known issue" in TODO-backend.md). Fixing that is a
// prerequisite for this being exact.
export function openSlots(project) {
  const slots = [];
  for (const role of project.roles) {
    for (let i = 0; i < role.quantity_needed; i++) {
      slots.push({ skill_id: role.skill_id, skill_name: role.skill_name });
    }
  }
  return slots;
}
