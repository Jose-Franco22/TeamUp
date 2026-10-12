// Filtering, ranking and empty-state copy for the Browse page (issue #31).
//
// These are pure functions on purpose. They were predicates inlined in
// Browse.jsx, which meant the only way to test "does the keyword search match
// a description" was to render a page, mock the API and type into a box. Out
// here they are ordinary functions with ordinary tests, and the component test
// is left to prove the wiring.
//
// Everything is client-side. A class-sized cohort is a few dozen projects, so
// filtering in the browser costs nothing and — more usefully — the same code
// runs in mock mode and in real mode, which is the only way a mock-mode test
// says anything about production.

import { scoreFit } from './matching/fit';

// A project is open if it says so and has a seat left. Both halves matter:
// `status` is maintained by sync_project_fill_state() server-side, and the
// seat count is the arithmetic that status is derived from. Checking both
// means a row whose status hasn't caught up yet is still treated correctly.
export function isOpenProject(project) {
  if (!project) return false;
  if (project.status === 'full') return false;
  const target = Number(project.team_size_target);
  const count = Number(project.member_count);
  if (!Number.isFinite(target) || !Number.isFinite(count)) return true;
  return count < target;
}

// Title or description, case-insensitive. An empty or whitespace-only query
// matches everything rather than nothing — a blank search box is not a filter.
export function matchesKeyword(project, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = `${project?.title ?? ''} ${project?.description ?? ''}`.toLowerCase();
  return haystack.includes(needle);
}

// Does this project list a role wanting one of the student's exact skills?
//
// This is NOT what "Only show matches" asks — see filterRanked below. It is
// the narrower question RolesNeeded uses to highlight the specific chips a
// student already has, where "React, and you have React" is the only honest
// thing to light up.
export function needsOneOfMySkills(project, mySkillIds = []) {
  if (!mySkillIds.length) return false;
  return (project?.roles_needed || []).some((r) => r.skill_id && mySkillIds.includes(r.skill_id));
}

// Role filter. No role selected matches everything.
export function needsRole(project, roleId) {
  if (!roleId) return true;
  return (project?.roles_needed || []).some((r) => r.role_id === roleId);
}

/**
 * Apply every active filter. Order is irrelevant — they all have to pass —
 * so this is written as one predicate per criterion for readability.
 */
export function filterProjects(
  projects = [],
  { query = '', roleId = '', onlyOpen = true } = {}
) {
  return projects.filter((p) => {
    if (onlyOpen && !isOpenProject(p)) return false;
    if (!needsRole(p, roleId)) return false;
    if (!matchesKeyword(p, query)) return false;
    return true;
  });
}

/**
 * "Only show matches", applied after ranking.
 *
 * It filters on the score, not on an exact skill overlap, because the two
 * disagree: scoreFit() also credits a same-category skill, so filtering on
 * exact matches made a card reading "Partial fit — you could cover UI/UX
 * Designer through React" vanish the moment a student asked to see their
 * matches. One of the two had to move, and the score is the one the list is
 * ordered by and the card explains itself with.
 *
 * A match is therefore "the engine can name a role you'd fill", which is the
 * question the switch is really asking.
 */
export function filterRanked(ranked = [], { onlyMatches = false } = {}) {
  if (!onlyMatches) return ranked;
  return ranked.filter((entry) => (entry.fit?.points ?? 0) > 0);
}

/**
 * Order projects by how well the student fits them, best first.
 *
 * Returns a new array of { project, fit } — the score is kept beside the
 * project rather than mutated onto it, so a caller can show the reasons
 * without the ranking having quietly rewritten the API's data.
 *
 * Without a student (a guest, or a profile that failed to load) the original
 * order is preserved and every fit is null. Browse must still work for
 * someone who isn't signed in.
 */
export function rankProjects(projects = [], { student = null, skillById = {} } = {}) {
  const scored = projects.map((project) => ({
    project,
    fit: student ? scoreFit({ project, student, skillById }) : null,
  }));

  if (!student) return scored;

  // Ties break on title then id so the list never reshuffles between renders.
  return scored.sort(
    (a, b) =>
      (b.fit?.points ?? 0) - (a.fit?.points ?? 0) ||
      String(a.project.title ?? '').localeCompare(String(b.project.title ?? '')) ||
      String(a.project.id ?? '').localeCompare(String(b.project.id ?? ''))
  );
}

/**
 * What to say when the list comes back empty, and it is never just "nothing
 * found". Four different situations lead here and they need four different
 * next steps; collapsing them into one message is how an app ends up telling
 * a student to "clear the filters" when they have not set any.
 */
export function describeEmpty({ total = 0, openCount = 0, filters = {} } = {}) {
  const { query = '', roleId = '', onlyOpen = true, onlyMatches = false, mySkillIds = [] } = filters;

  if (total === 0) {
    return {
      title: 'No projects have been posted yet.',
      hint: 'Be the first — post a project and list the roles you need.',
      canClear: false,
    };
  }

  if (onlyMatches && mySkillIds.length === 0) {
    return {
      title: 'No skills on your profile yet.',
      hint: 'Add skills or import your resume, then come back to see which projects need them.',
      canClear: true,
    };
  }

  if (onlyMatches) {
    return {
      title: "None of these projects match what you've listed.",
      hint: 'Clear the filter to see everything, or add more skills to your profile.',
      canClear: true,
    };
  }

  if (onlyOpen && openCount === 0) {
    return {
      title: 'Every project is full right now.',
      hint: 'Turn off "Open projects only" to see them anyway, or post your own.',
      canClear: true,
    };
  }

  if (query.trim() || roleId || onlyMatches) {
    return {
      title: 'No projects match these filters.',
      hint: 'Clear the filters, search for something broader, or add more skills to your profile.',
      canClear: true,
    };
  }

  return {
    title: 'No projects to show.',
    hint: 'Check back later, or post a project of your own.',
    canClear: false,
  };
}
