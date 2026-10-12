// Issue #31 — the Browse filters, ranking and empty-state copy.
//
// Each of the issue's four logic criteria is a test here, plus the inputs the
// API really produces: a role with no skill pinned to it, a project whose
// status says open but whose seats are gone, a student with no skills, a
// guest with no profile at all.
import { describe, expect, test } from 'vitest';
import {
  describeEmpty,
  filterProjects,
  filterRanked,
  isOpenProject,
  matchesKeyword,
  needsOneOfMySkills,
  needsRole,
  rankProjects,
} from './browseFilters';

const role = (role_id, role_name, skill) => ({
  role_id,
  role_name,
  skill_id: skill?.id ?? null,
  skill_name: skill?.name ?? null,
  category: skill?.category ?? null,
  quantity_needed: 1,
});

const REACT = { id: 's-react', name: 'React', category: 'Frontend' };
const PG = { id: 's-pg', name: 'PostgreSQL', category: 'Backend' };
const PYTHON = { id: 's-python', name: 'Python', category: 'Data' };

const parking = {
  id: 'p-parking',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy estimated from existing camera feeds.',
  team_size_target: 4,
  member_count: 1,
  status: 'open',
  avg_availability_hours: 12,
  roles_needed: [role('r-frontend', 'Frontend Developer', REACT)],
};

const degree = {
  id: 'p-degree',
  title: 'Degree plan builder',
  description: 'Constraint solver over prerequisites and offering patterns.',
  team_size_target: 3,
  member_count: 1,
  status: 'open',
  avg_availability_hours: 10,
  roles_needed: [role('r-backend', 'Backend Developer', PG), role('r-data', 'Data / ML', PYTHON)],
};

const scam = {
  id: 'p-scam',
  title: 'Scam text detector',
  description: 'Classifier over reported SMS messages.',
  team_size_target: 2,
  member_count: 2,
  status: 'full',
  avg_availability_hours: 16,
  roles_needed: [role('r-pm', 'Project Manager', null)],
};

const ALL = [parking, degree, scam];

// --- isOpenProject -------------------------------------------------------

describe('isOpenProject', () => {
  test('open with a seat left is open', () => {
    expect(isOpenProject(parking)).toBe(true);
  });

  test('status full is closed', () => {
    expect(isOpenProject(scam)).toBe(false);
  });

  test('seats gone is closed even if the status row has not caught up', () => {
    expect(isOpenProject({ ...parking, status: 'open', member_count: 4 })).toBe(false);
  });

  test('missing counts are treated as open rather than silently hidden', () => {
    expect(isOpenProject({ status: 'open' })).toBe(true);
  });

  test('nothing is not open', () => {
    expect(isOpenProject(undefined)).toBe(false);
    expect(isOpenProject(null)).toBe(false);
  });
});

// --- matchesKeyword ------------------------------------------------------

describe('matchesKeyword', () => {
  test('matches the title, case-insensitively', () => {
    expect(matchesKeyword(parking, 'PARKING')).toBe(true);
    expect(matchesKeyword(parking, 'parking')).toBe(true);
  });

  test('matches the description too', () => {
    expect(matchesKeyword(parking, 'camera feeds')).toBe(true);
  });

  test('a word in neither does not match', () => {
    expect(matchesKeyword(parking, 'blockchain')).toBe(false);
  });

  test.each(['', '   ', undefined, null])('a blank query (%j) is not a filter', (q) => {
    expect(matchesKeyword(parking, q)).toBe(true);
  });

  test('surrounding whitespace is ignored', () => {
    expect(matchesKeyword(parking, '  parking  ')).toBe(true);
  });

  test('a project with no description is searchable by title alone', () => {
    expect(matchesKeyword({ title: 'Robot arm' }, 'robot')).toBe(true);
    expect(matchesKeyword({ title: 'Robot arm' }, 'arm sensor')).toBe(false);
  });
});

// --- needsOneOfMySkills --------------------------------------------------

describe('needsOneOfMySkills', () => {
  test('true when a listed role wants a skill I have', () => {
    expect(needsOneOfMySkills(parking, ['s-react'])).toBe(true);
  });

  test('false when none of them overlap', () => {
    expect(needsOneOfMySkills(parking, ['s-python'])).toBe(false);
  });

  test('a student with no skills matches nothing, rather than everything', () => {
    expect(needsOneOfMySkills(parking, [])).toBe(false);
    expect(needsOneOfMySkills(parking)).toBe(false);
  });

  test('a role with no skill pinned to it is not a skill match', () => {
    expect(needsOneOfMySkills(scam, ['s-react'])).toBe(false);
  });
});

// --- needsRole -----------------------------------------------------------

describe('needsRole', () => {
  test('keeps only projects needing that role', () => {
    expect(needsRole(parking, 'r-frontend')).toBe(true);
    expect(needsRole(parking, 'r-backend')).toBe(false);
    expect(needsRole(degree, 'r-backend')).toBe(true);
  });

  test('no role selected matches everything', () => {
    expect(needsRole(parking, '')).toBe(true);
    expect(needsRole(parking, undefined)).toBe(true);
  });

  test('a role with no skill attached is still a role you can filter by', () => {
    expect(needsRole(scam, 'r-pm')).toBe(true);
  });
});

// --- filterProjects ------------------------------------------------------

describe('filterProjects', () => {
  test('open-only is the default, so a full project is left out', () => {
    expect(filterProjects(ALL).map((p) => p.id)).toEqual(['p-parking', 'p-degree']);
  });

  test('turning open-only off brings the full project back', () => {
    expect(filterProjects(ALL, { onlyOpen: false })).toHaveLength(3);
  });

  test('keyword and role stack with each other', () => {
    expect(filterProjects(ALL, { query: 'solver', roleId: 'r-backend' }).map((p) => p.id)).toEqual([
      'p-degree',
    ]);
    expect(filterProjects(ALL, { query: 'solver', roleId: 'r-frontend' })).toEqual([]);
  });

  test('filters that exclude everything give an empty list, not everything', () => {
    expect(filterProjects(ALL, { query: 'nothing matches this' })).toEqual([]);
  });

  test('no projects in means no projects out', () => {
    expect(filterProjects([], { query: 'parking' })).toEqual([]);
    expect(filterProjects(undefined)).toEqual([]);
  });

  test('does not mutate the list it was given', () => {
    const input = [...ALL];
    filterProjects(input, { onlyOpen: true });
    expect(input).toEqual(ALL);
  });
});

// --- rankProjects --------------------------------------------------------

describe('rankProjects', () => {
  const reactStudent = {
    availability_hours: 12,
    skills: [{ ...REACT, source: 'manual' }],
  };

  test('orders by fit, best first, and keeps the score beside the project', () => {
    const ranked = rankProjects([degree, parking], { student: reactStudent });
    expect(ranked.map((r) => r.project.id)).toEqual(['p-parking', 'p-degree']);
    expect(ranked[0].fit.points).toBeGreaterThan(ranked[1].fit.points);
    expect(ranked[0].fit.reasons[0]).toContain('React');
  });

  test('a guest gets the original order and no scores', () => {
    const ranked = rankProjects(ALL, { student: null });
    expect(ranked.map((r) => r.project.id)).toEqual(['p-parking', 'p-degree', 'p-scam']);
    expect(ranked.every((r) => r.fit === null)).toBe(true);
  });

  test('ties break on title then id, so the list never reshuffles', () => {
    const a = { ...parking, id: 'p-b', title: 'Same name', roles_needed: [] };
    const b = { ...parking, id: 'p-a', title: 'Same name', roles_needed: [] };
    expect(rankProjects([a, b], { student: reactStudent }).map((r) => r.project.id)).toEqual([
      'p-a',
      'p-b',
    ]);
    expect(rankProjects([b, a], { student: reactStudent }).map((r) => r.project.id)).toEqual([
      'p-a',
      'p-b',
    ]);
  });

  test('the ranking does not mutate the projects it scored', () => {
    const before = JSON.stringify(ALL);
    rankProjects(ALL, { student: reactStudent });
    expect(JSON.stringify(ALL)).toBe(before);
  });

  test('called with nothing it returns an empty list', () => {
    expect(rankProjects()).toEqual([]);
  });
});

// --- filterRanked --------------------------------------------------------
//
// "Only show matches" filters on the score rather than on an exact skill
// overlap. The two disagree, and filtering on exact matches made a card
// reading "Partial fit, you could cover this through React" disappear the
// moment a student asked to see their matches.

describe('filterRanked', () => {
  const reactStudent = { availability_hours: 12, skills: [{ ...REACT, source: 'manual' }] };
  const ranked = () => rankProjects([parking, degree], { student: reactStudent });

  test('off, it changes nothing', () => {
    expect(filterRanked(ranked(), { onlyMatches: false }).map((r) => r.project.id)).toEqual([
      'p-parking',
      'p-degree',
    ]);
  });

  test('on, it drops the projects scoring zero', () => {
    expect(filterRanked(ranked(), { onlyMatches: true }).map((r) => r.project.id)).toEqual([
      'p-parking',
    ]);
  });

  test('a project matched only through a related skill is kept, because it is ranked', () => {
    // Figma is Frontend, like React: scoreFit credits it, so the card says
    // "Partial fit" — and the filter has to agree with the card.
    const design = {
      ...parking,
      id: 'p-design',
      title: 'Design system',
      roles_needed: [role('r-design', 'UI/UX Designer', { id: 's-figma', name: 'Figma', category: 'Frontend' })],
    };
    const [entry] = filterRanked(rankProjects([design], { student: reactStudent }), {
      onlyMatches: true,
    });
    expect(entry).toBeTruthy();
    expect(entry.fit.points).toBeGreaterThan(0);
    expect(entry.fit.primary.basis).toBe('same-category');
    // ...and the narrower exact-skill question would have excluded it.
    expect(needsOneOfMySkills(design, ['s-react'])).toBe(false);
  });

  test('a guest has no scores, so nothing is filtered away', () => {
    const guestRanked = rankProjects([parking, degree], { student: null });
    expect(filterRanked(guestRanked, { onlyMatches: true })).toEqual([]);
  });

  test('called with nothing it returns an empty list', () => {
    expect(filterRanked()).toEqual([]);
  });
});

// --- describeEmpty -------------------------------------------------------
//
// Four situations, four different next steps. Collapsing them is how an app
// ends up telling a student to clear filters they never set.

describe('describeEmpty', () => {
  test('nothing posted yet invites them to post', () => {
    const { title, hint, canClear } = describeEmpty({ total: 0, openCount: 0 });
    expect(title).toMatch(/no projects have been posted/i);
    expect(hint).toMatch(/post a project/i);
    expect(canClear).toBe(false);
  });

  test('matches-only with an empty profile points at skills, not at filters', () => {
    const { title, hint } = describeEmpty({
      total: 3,
      openCount: 2,
      filters: { onlyMatches: true, mySkillIds: [] },
    });
    expect(title).toMatch(/no skills on your profile/i);
    expect(hint).toMatch(/import your resume/i);
  });

  test('every project full says so and offers to show them', () => {
    const { title, hint } = describeEmpty({
      total: 3,
      openCount: 0,
      filters: { onlyOpen: true },
    });
    expect(title).toMatch(/every project is full/i);
    expect(hint).toMatch(/Open projects only/);
  });

  test('matches-only with skills says nothing matched, not that filters are wrong', () => {
    const { title, hint } = describeEmpty({
      total: 3,
      openCount: 3,
      filters: { onlyMatches: true, mySkillIds: ['s-react'] },
    });
    expect(title).toMatch(/none of these projects match/i);
    expect(hint).toMatch(/clear the filter/i);
  });

  test('a search that found nothing offers to clear or widen', () => {
    const { title, hint, canClear } = describeEmpty({
      total: 3,
      openCount: 3,
      filters: { query: 'blockchain' },
    });
    expect(title).toMatch(/no projects match these filters/i);
    expect(hint).toMatch(/clear the filters/i);
    expect(canClear).toBe(true);
  });

  test('a role filter that found nothing is treated the same way', () => {
    expect(describeEmpty({ total: 3, openCount: 3, filters: { roleId: 'r-writer' } }).title).toMatch(
      /no projects match these filters/i
    );
  });

  test('empty with no filters set does not blame the filters', () => {
    const { title, canClear } = describeEmpty({
      total: 3,
      openCount: 3,
      filters: { onlyOpen: false },
    });
    expect(title).toMatch(/no projects to show/i);
    expect(canClear).toBe(false);
  });

  test('called with nothing it still returns something sayable', () => {
    const { title, hint } = describeEmpty();
    expect(title).toBeTruthy();
    expect(hint).toBeTruthy();
  });
});
