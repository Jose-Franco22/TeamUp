// Issue #31 / fit check — the jury's maths.
//
// These tests are the contract the rest of the engine is built on, so they
// cover three things and not just the happy one:
//   * the scoring rules the write-up has to defend (weights, bands, order)
//   * the "nothing to score" cases, which must come back as a status rather
//     than as a zero that reads like a judgement
//   * the shapes the API can actually hand us — null skill ids, missing
//     evidence, a project with no members and therefore no average hours
import { describe, expect, test } from 'vitest';
import {
  ADJACENT_CATEGORY_FIT,
  BAND_THRESHOLDS,
  HOURS_SPREAD_FLOOR,
  NEUTRAL_HOURS_FIT,
  WEIGHTS,
  bandFor,
  confidence,
  hoursCloseness,
  ownedSkills,
  roleFit,
  scoreFit,
} from './fit';

// --- fixtures ------------------------------------------------------------
// Shaped exactly like getCurrentUser() and getProjects() return, because a
// test against a shape the API never produces proves nothing.

const REACT = { id: 's-react', name: 'React', category: 'Frontend' };
const JS = { id: 's-js', name: 'JavaScript', category: 'Frontend' };
const FIGMA = { id: 's-figma', name: 'Figma', category: 'Frontend' };
const PG = { id: 's-pg', name: 'PostgreSQL', category: 'Backend' };
const PYTHON = { id: 's-python', name: 'Python', category: 'Data' };

const role = (role_id, role_name, skill, quantity_needed = 1) => ({
  role_id,
  role_name,
  skill_id: skill?.id ?? null,
  skill_name: skill?.name ?? null,
  category: skill?.category ?? null,
  quantity_needed,
});

const FRONTEND_ROLE = role('r-frontend', 'Frontend Developer', REACT);
const BACKEND_ROLE = role('r-backend', 'Backend Developer', PG);
const DATA_ROLE = role('r-data', 'Data / ML', PYTHON);
const PM_ROLE = role('r-pm', 'Project Manager', null);

function project({ roles = [FRONTEND_ROLE], avg = 12, ...rest } = {}) {
  return {
    id: 'p-test',
    title: 'Campus parking tracker',
    description: 'Live lot occupancy from camera feeds.',
    team_size_target: 4,
    member_count: 1,
    status: 'open',
    avg_availability_hours: avg,
    roles_needed: roles,
    members: [],
    ...rest,
  };
}

function student({ skills = [REACT], hours = 12, evidence = {} } = {}) {
  return {
    availability_hours: hours,
    skills: skills.map((s) => ({ ...s, source: 'manual' })),
    evidence,
  };
}

// --- confidence ----------------------------------------------------------

describe('confidence', () => {
  test('a bare skill tag is worth half', () => {
    expect(confidence({ months: 0, projects: 0 })).toBe(0.5);
  });

  test('months and projects raise it, and it never passes 1', () => {
    expect(confidence({ months: 6, projects: 0 })).toBeGreaterThan(0.5);
    expect(confidence({ months: 24, projects: 9, source: 'resume' })).toBe(1);
  });

  test('a resume-matched skill is worth slightly more than a ticked box', () => {
    expect(confidence({ source: 'resume' })).toBeGreaterThan(confidence({ source: 'manual' }));
  });

  test('no entry at all is zero, not a crash', () => {
    expect(confidence(undefined)).toBe(0);
    expect(confidence(null)).toBe(0);
  });
});

// --- hoursCloseness ------------------------------------------------------

describe('hoursCloseness', () => {
  test('identical hours are a perfect match', () => {
    expect(hoursCloseness(12, 12)).toBe(1);
  });

  test('bottoms out at the spread floor and does not go negative', () => {
    expect(hoursCloseness(0, HOURS_SPREAD_FLOOR)).toBe(0);
    expect(hoursCloseness(0, HOURS_SPREAD_FLOOR * 3)).toBe(0);
  });

  test.each([
    ['the student has not set hours', null, 12],
    ['the project has no members yet, so the average is 0', 12, 0],
    ['the average is missing', 12, null],
    ['neither side is known', null, null],
    ['the value is not a number', 'soon', 12],
  ])('%s is neutral, not a penalty', (_label, mine, theirs) => {
    expect(hoursCloseness(mine, theirs)).toBe(NEUTRAL_HOURS_FIT);
  });

  // 0 is a legal value for availability_hours (the column allows 0..40), so it
  // has to mean "none this week" and not "didn't say". Scored against 16 hours
  // rather than 10 because 10 lands exactly on the neutral value by
  // coincidence and would pass either way.
  test('a student who listed 0 hours is scored, not treated as unknown', () => {
    expect(hoursCloseness(0, 16)).toBeCloseTo(0.2);
    expect(hoursCloseness(0, 16)).toBeLessThan(NEUTRAL_HOURS_FIT);
  });
});

// --- ownedSkills ---------------------------------------------------------

describe('ownedSkills', () => {
  test('folds evidence in and defaults what is missing to zero', () => {
    const owned = ownedSkills(student({ skills: [REACT, PG], evidence: { 's-react': { months: 9, projects: 2 } } }));
    expect(owned['s-react']).toMatchObject({ months: 9, projects: 2 });
    expect(owned['s-pg']).toMatchObject({ months: 0, projects: 0 });
  });

  test('coerces strings and survives junk in the evidence table', () => {
    const owned = ownedSkills(
      student({
        skills: [REACT, PG],
        evidence: { 's-react': { months: '9', projects: '2' }, 's-pg': { months: null, projects: 'many' } },
      })
    );
    expect(owned['s-react']).toMatchObject({ months: 9, projects: 2 });
    expect(owned['s-pg']).toMatchObject({ months: 0, projects: 0 });
  });

  test('skips entries with no id instead of keying on undefined', () => {
    const owned = ownedSkills({ skills: [REACT, null, { name: 'Nameless' }, undefined] });
    expect(Object.keys(owned)).toEqual(['s-react']);
  });

  test('no student and no skills are both empty, not a throw', () => {
    expect(ownedSkills(undefined)).toEqual({});
    expect(ownedSkills({})).toEqual({});
    expect(ownedSkills({ skills: [] })).toEqual({});
  });
});

// --- roleFit -------------------------------------------------------------

describe('roleFit', () => {
  const owned = ownedSkills(student({ skills: [REACT] }));

  test('a skill the student has scores its confidence', () => {
    expect(roleFit(FRONTEND_ROLE, owned)).toMatchObject({ fit: 0.5, basis: 'has-skill' });
  });

  test('a same-category skill is worth a fraction of the real one', () => {
    const designRole = role('r-design', 'UI/UX Designer', FIGMA);
    const { fit, basis, via } = roleFit(designRole, owned);
    expect(basis).toBe('same-category');
    expect(via).toBe('s-react');
    expect(fit).toBeCloseTo(ADJACENT_CATEGORY_FIT * 0.5);
    expect(fit).toBeLessThan(roleFit(FRONTEND_ROLE, owned).fit);
  });

  test('a different category is no fit at all', () => {
    expect(roleFit(DATA_ROLE, owned)).toMatchObject({ fit: 0, basis: 'none' });
  });

  test('a role with no skill pinned to it cannot be matched by skill', () => {
    expect(roleFit(PM_ROLE, owned)).toMatchObject({ fit: 0, basis: 'no-skill-listed' });
  });

  test('picks the best-evidenced adjacent skill, and ties break on id', () => {
    const twoFrontend = ownedSkills(
      student({ skills: [REACT, JS], evidence: { 's-js': { months: 24, projects: 3 } } })
    );
    expect(roleFit(role('r-design', 'UI/UX Designer', FIGMA), twoFrontend).via).toBe('s-js');

    const tied = ownedSkills(student({ skills: [REACT, JS] }));
    expect(roleFit(role('r-design', 'UI/UX Designer', FIGMA), tied).via).toBe('s-js');
  });

  test('falls back to skillById when the role carries no category', () => {
    const bare = { role_id: 'r-design', role_name: 'UI/UX Designer', skill_id: 's-figma' };
    expect(roleFit(bare, owned)).toMatchObject({ fit: 0, basis: 'none' });
    expect(roleFit(bare, owned, { 's-figma': FIGMA })).toMatchObject({ basis: 'same-category' });
  });

  test('a missing role is not a crash', () => {
    expect(roleFit(undefined, owned)).toMatchObject({ fit: 0 });
    expect(roleFit(null, owned)).toMatchObject({ fit: 0 });
  });
});

// --- bands ---------------------------------------------------------------

describe('bands', () => {
  test.each([
    [0, 'long-shot'],
    [39, 'long-shot'],
    [40, 'partial'],
    [69, 'partial'],
    [70, 'strong'],
    [100, 'strong'],
  ])('%i points is a %s', (points, band) => {
    expect(bandFor(points)).toBe(band);
  });

  test('the thresholds are the ones the issue quotes', () => {
    expect(BAND_THRESHOLDS).toEqual({ strong: 70, partial: 40 });
  });
});

// --- scoreFit: nothing to score ------------------------------------------

describe('scoreFit with nothing to score', () => {
  test('a student with no skills gets a status and a next step, not a zero', () => {
    const result = scoreFit({ project: project(), student: student({ skills: [] }) });
    expect(result.status).toBe('no-skills');
    expect(result.band).toBeNull();
    expect(result.reasons[0]).toMatch(/import your resume/i);
  });

  test('a project with no roles listed is not scored', () => {
    const result = scoreFit({ project: project({ roles: [] }), student: student() });
    expect(result.status).toBe('no-open-roles');
    expect(result.reasons[0]).toMatch(/no open roles/i);
  });

  test('a project whose only open role pins no skill says so by name', () => {
    const result = scoreFit({ project: project({ roles: [PM_ROLE] }), student: student() });
    expect(result.status).toBe('no-open-roles');
    expect(result.reasons[0]).toContain('Project Manager');
  });

  test('called with nothing at all it returns a result instead of throwing', () => {
    expect(() => scoreFit()).not.toThrow();
    expect(scoreFit().status).toBe('no-skills');
    expect(scoreFit({ student: student() }).status).toBe('no-open-roles');
  });
});

// --- scoreFit: the scoring rules -----------------------------------------

describe('scoreFit', () => {
  test('no matching role scores a flat zero', () => {
    const result = scoreFit({
      project: project({ roles: [DATA_ROLE, BACKEND_ROLE] }),
      student: student({ skills: [REACT] }),
    });
    expect(result.status).toBe('ok');
    expect(result.points).toBe(0);
    expect(result.band).toBe('long-shot');
    expect(result.primary).toBeNull();
    // Availability and scarcity must not float a non-match up to a
    // double-digit score — there is nothing to fit, so the number is 0.
    expect(result.parts).toEqual({
      primaryFit: 0,
      scarcity: 0,
      depth: 0,
      hoursFit: 0,
      extraCoverage: 0,
    });
    expect(result.reasons[0]).toMatch(/none of the roles still open/i);
    expect(result.reasons.join(' ')).toContain('Python');
  });

  test('covering the only open role beats covering one of three', () => {
    const me = student({ skills: [REACT] });
    const only = scoreFit({ project: project({ roles: [FRONTEND_ROLE] }), student: me });
    const oneOfThree = scoreFit({
      project: project({ roles: [FRONTEND_ROLE, BACKEND_ROLE, DATA_ROLE] }),
      student: me,
    });
    expect(only.points).toBeGreaterThan(oneOfThree.points);
    // Scaled by the strength of the student's claim on the role (0.5 for a
    // bare tag), so the bonus is never paid out before the fit is.
    expect(only.parts.scarcity).toBe(0.5);
    expect(oneOfThree.parts.scarcity).toBeCloseTo(0.5 / 3);
  });

  // The defect this scaling exists to fix: a single-role project used to hand
  // out a flat 25 points for scarcity and extraCoverage regardless of how
  // well the student fitted, so a merely related skill (48) outranked an
  // exact match on a busier project (43).
  test('an exact match outranks a merely related one, whatever shape the project is', () => {
    const relatedOnOneRole = scoreFit({
      project: project({ roles: [FRONTEND_ROLE] }),
      student: student({ skills: [{ id: 's-vue', name: 'Vue', category: 'Frontend' }] }),
    });
    const exactOnThreeRoles = scoreFit({
      project: project({ roles: [FRONTEND_ROLE, BACKEND_ROLE, DATA_ROLE] }),
      student: student({ skills: [REACT] }),
    });
    expect(relatedOnOneRole.primary.basis).toBe('same-category');
    expect(exactOnThreeRoles.primary.basis).toBe('has-skill');
    expect(exactOnThreeRoles.points).toBeGreaterThan(relatedOnOneRole.points);
  });

  test('the project-shape parts are never worth more than the claim behind them', () => {
    const related = scoreFit({
      project: project({ roles: [FRONTEND_ROLE] }),
      student: student({ skills: [{ id: 's-vue', name: 'Vue', category: 'Frontend' }] }),
    });
    expect(related.parts.scarcity).toBeLessThanOrEqual(related.parts.primaryFit);
    expect(related.parts.extraCoverage).toBeLessThanOrEqual(related.parts.primaryFit);
  });

  test('more months and more projects behind a skill raise the score', () => {
    const p = project({ roles: [FRONTEND_ROLE] });
    const bare = scoreFit({ project: p, student: student({ skills: [REACT] }) });
    const some = scoreFit({
      project: p,
      student: student({ skills: [REACT], evidence: { 's-react': { months: 9, projects: 1 } } }),
    });
    const lots = scoreFit({
      project: p,
      student: student({ skills: [REACT], evidence: { 's-react': { months: 24, projects: 4 } } }),
    });
    expect(some.points).toBeGreaterThan(bare.points);
    expect(lots.points).toBeGreaterThan(some.points);
    expect(lots.parts.depth).toBe(1);
  });

  test('a large gap between my hours and the team average lowers the score', () => {
    const p = project({ roles: [FRONTEND_ROLE], avg: 12 });
    const close = scoreFit({ project: p, student: student({ hours: 12 }) });
    const far = scoreFit({ project: p, student: student({ hours: 34 }) });
    expect(far.points).toBeLessThan(close.points);
    expect(far.parts.hoursFit).toBe(0);
    expect(far.reasons.join(' ')).toMatch(/averages 12 hrs\/week and you listed 34/);
  });

  test('a project with no seated members does not punish anyone on hours', () => {
    const result = scoreFit({
      project: project({ roles: [FRONTEND_ROLE], avg: 0, member_count: 0 }),
      student: student({ hours: 40 }),
    });
    expect(result.parts.hoursFit).toBe(NEUTRAL_HOURS_FIT);
    expect(result.reasons.join(' ')).not.toMatch(/hrs\/week/);
  });

  test('a perfect match on the only open role can reach 100', () => {
    const result = scoreFit({
      project: project({ roles: [FRONTEND_ROLE], avg: 12 }),
      student: {
        availability_hours: 12,
        skills: [{ ...REACT, source: 'resume' }],
        evidence: { 's-react': { months: 24, projects: 5 } },
      },
    });
    expect(result.points).toBe(100);
    expect(result.band).toBe('strong');
  });

  test('points stay inside 0..100 and the parts inside 0..1', () => {
    const result = scoreFit({
      project: project({ roles: [FRONTEND_ROLE, BACKEND_ROLE, DATA_ROLE, PM_ROLE] }),
      student: student({ skills: [REACT, PG, PYTHON], evidence: { 's-react': { months: 999, projects: 999 } } }),
    });
    expect(result.points).toBeGreaterThanOrEqual(0);
    expect(result.points).toBeLessThanOrEqual(100);
    for (const [name, value] of Object.entries(result.parts)) {
      expect(value, name).toBeGreaterThanOrEqual(0);
      expect(value, name).toBeLessThanOrEqual(1);
    }
  });

  test('covering more of the open roles raises extraCoverage', () => {
    const roles = [FRONTEND_ROLE, BACKEND_ROLE, DATA_ROLE];
    const one = scoreFit({ project: project({ roles }), student: student({ skills: [REACT] }) });
    const all = scoreFit({
      project: project({ roles }),
      student: student({ skills: [REACT, PG, PYTHON] }),
    });
    expect(one.parts.extraCoverage).toBe(0);
    // Full coverage of the other roles, scaled by the 0.5 claim behind them.
    expect(all.parts.extraCoverage).toBe(0.5);
    expect(all.points).toBeGreaterThan(one.points);
  });

  // Before profile_evidence was loaded into getCurrentUser(), depth was 0 for
  // everyone and the best reachable score was 65 — so the strong band was
  // unreachable for every student in the cohort.
  test('a well-evidenced skill reaches the strong band', () => {
    const p = project({ roles: [FRONTEND_ROLE], avg: 12 });
    const bare = scoreFit({ project: p, student: student({ skills: [REACT] }) });
    const evidenced = scoreFit({
      project: p,
      student: student({ skills: [REACT], evidence: { 's-react': { months: 14, projects: 3 } } }),
    });
    expect(bare.band).not.toBe('strong');
    expect(evidenced.band).toBe('strong');
    expect(evidenced.points).toBeGreaterThanOrEqual(BAND_THRESHOLDS.strong);
  });

  test('the weights sum to 1, so a part can never be scaled out of range', () => {
    const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1);
  });

  test('every reason names a role or a skill — no bare numbers', () => {
    const result = scoreFit({
      project: project({ roles: [FRONTEND_ROLE, BACKEND_ROLE, PM_ROLE] }),
      student: student({ skills: [REACT], evidence: { 's-react': { months: 9, projects: 2 } } }),
    });
    expect(result.reasons.length).toBeGreaterThan(1);
    expect(result.reasons[0]).toContain('Frontend Developer');
    expect(result.reasons[0]).toContain('React');
    expect(result.reasons.join(' ')).toContain('PostgreSQL');
    expect(result.reasons.join(' ')).toContain('Project Manager');
  });

  test('the primary role is reported with the skill that earned it', () => {
    const result = scoreFit({
      project: project({ roles: [FRONTEND_ROLE, BACKEND_ROLE] }),
      student: student({ skills: [REACT] }),
    });
    expect(result.primary).toMatchObject({
      role_id: 'r-frontend',
      skill_name: 'React',
      basis: 'has-skill',
    });
    expect(result.covered.map((r) => r.role_id)).toEqual(['r-frontend']);
    expect(result.uncovered.map((r) => r.role_id)).toEqual(['r-backend']);
  });

  test('the same inputs always give the same score, whatever order they arrive in', () => {
    const roles = [FRONTEND_ROLE, BACKEND_ROLE, DATA_ROLE];
    const first = scoreFit({
      project: project({ roles }),
      student: student({ skills: [REACT, PG], evidence: { 's-react': { months: 9 }, 's-pg': { months: 3 } } }),
    });
    const second = scoreFit({
      project: project({ roles: [...roles].reverse() }),
      student: student({ skills: [PG, REACT], evidence: { 's-pg': { months: 3 }, 's-react': { months: 9 } } }),
    });
    expect(second.points).toBe(first.points);
    expect(second.primary.role_id).toBe(first.primary.role_id);
    expect(second.parts).toEqual(first.parts);
  });

  test('scoring does not mutate the project or the student it was given', () => {
    const p = project({ roles: [FRONTEND_ROLE] });
    const me = student({ skills: [REACT] });
    const beforeProject = JSON.stringify(p);
    const beforeStudent = JSON.stringify(me);
    scoreFit({ project: p, student: me });
    expect(JSON.stringify(p)).toBe(beforeProject);
    expect(JSON.stringify(me)).toBe(beforeStudent);
  });
});
