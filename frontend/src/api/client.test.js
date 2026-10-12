// Issue #31 — getProjects' open-only behaviour, and an end-to-end pass over
// the real fixtures: client.js → mockData → browseFilters → the scorer.
//
// The unit tests beside each module use fixtures shaped by hand. This file
// deliberately uses the shipped mock data instead, because the gap between
// "the shape I assumed" and "the shape the app produces" is where this kind
// of code actually breaks — a role with no skill pinned to it, a project
// whose team is already full, a student with three skills and no evidence.
import { describe, expect, test } from 'vitest';
import { getProjects, getCurrentUser, setSessionUserId } from './client';
import { filterProjects, isOpenProject, rankProjects } from '../lib/browseFilters';
import { scoreFit } from '../lib/matching/fit';

describe('getProjects', () => {
  test('returns only open projects by default', async () => {
    const open = await getProjects();
    expect(open.length).toBeGreaterThan(0);
    expect(open.every(isOpenProject)).toBe(true);
    expect(open.map((p) => p.id)).not.toContain('p-lab'); // the full one
  });

  test('onlyOpen: false returns the full ones too', async () => {
    const [open, all] = await Promise.all([getProjects(), getProjects({ onlyOpen: false })]);
    expect(all.length).toBeGreaterThan(open.length);
    expect(all.map((p) => p.id)).toContain('p-lab');
  });

  test('every project carries the fields the matching engine reads', async () => {
    for (const p of await getProjects({ onlyOpen: false })) {
      expect(p).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        team_size_target: expect.any(Number),
        member_count: expect.any(Number),
        roles_needed: expect.any(Array),
      });
      for (const r of p.roles_needed) {
        expect(r).toHaveProperty('role_id');
        expect(r).toHaveProperty('skill_id'); // may be null, on purpose
        expect(r).toHaveProperty('category');
      }
    }
  });

  test('at least one fixture role has no skill pinned to it', async () => {
    // Guards the fixtures as much as the code: if this stops being true, the
    // null-skill branches in the scorer are no longer exercised by real data.
    const all = await getProjects({ onlyOpen: false });
    expect(all.some((p) => p.roles_needed.some((r) => r.skill_id === null))).toBe(true);
  });
});

describe('profile evidence', () => {
  test('getCurrentUser returns the months and projects behind each skill', async () => {
    setSessionUserId('u-sofia');
    const me = await getCurrentUser();
    expect(me.evidence).toBeTruthy();
    expect(me.evidence['s-react']).toEqual({ months: 14, projects: 3 });
  });

  test('a student with no evidence gets an empty map, not undefined', async () => {
    setSessionUserId('u-rita');
    const me = await getCurrentUser();
    expect(me.evidence).toEqual({});
  });

  // Without this, depth is 0 for everyone and 65 is the best score anybody
  // can reach — so the strong band is unreachable for the whole cohort.
  test('the evidence is what lifts a well-backed skill into the strong band', async () => {
    setSessionUserId('u-sofia');
    const [all, me] = await Promise.all([getProjects({ onlyOpen: false }), getCurrentUser()]);
    const parking = all.find((p) => p.id === 'p-parking');

    const withEvidence = scoreFit({ project: parking, student: me });
    const without = scoreFit({ project: parking, student: { ...me, evidence: {} } });

    expect(withEvidence.points).toBeGreaterThan(without.points);
    expect(withEvidence.band).toBe('strong');
  });
});

describe('roles that have been filled', () => {
  test('a role at quantity_needed 0 is not advertised', async () => {
    const all = await getProjects({ onlyOpen: false });
    const scam = all.find((p) => p.id === 'p-scam');
    expect(scam.roles_needed.map((r) => r.role_id)).not.toContain('r-devops');
  });

  // The student has the exact skill the filled role wanted. They must not be
  // credited for it: that seat is taken. (They still score against the QA
  // role, which is open and in the same category — that part is correct.)
  test('and nobody is credited for the skill it wanted', async () => {
    const all = await getProjects({ onlyOpen: false });
    const scam = all.find((p) => p.id === 'p-scam');
    const gitStudent = {
      availability_hours: 12,
      skills: [{ id: 's-git', name: 'Git', category: 'Tools', source: 'manual' }],
    };

    const fit = scoreFit({ project: scam, student: gitStudent });
    const everyRoleScored = [...fit.covered, ...fit.uncovered].map((r) => r.role_id);
    expect(everyRoleScored).not.toContain('r-devops');
    expect(fit.primary?.role_id).not.toBe('r-devops');
    expect(fit.primary?.basis).toBe('same-category'); // the open QA role, not the filled one
  });
});

describe('browse, end to end over the real fixtures', () => {
  test('a student is ranked above the projects that do not need them', async () => {
    setSessionUserId('u-sofia'); // React, JavaScript, Figma
    const [all, me] = await Promise.all([getProjects({ onlyOpen: false }), getCurrentUser()]);

    const ranked = rankProjects(filterProjects(all, { onlyOpen: true }), { student: me });

    expect(ranked.length).toBeGreaterThan(1);
    const points = ranked.map((r) => r.fit.points);
    expect(points).toEqual([...points].sort((a, b) => b - a));
    expect(ranked[0].fit.points).toBeGreaterThan(0);
    expect(ranked[0].fit.reasons[0]).toMatch(/you cover|you could cover/i);
  });

  test('the parking project scores on the skills it actually asks for', async () => {
    setSessionUserId('u-sofia'); // React, JavaScript, Figma (Figma from a resume)
    const [all, me] = await Promise.all([getProjects({ onlyOpen: false }), getCurrentUser()]);
    const parking = all.find((p) => p.id === 'p-parking');

    const fit = scoreFit({ project: parking, student: me });
    expect(fit.status).toBe('ok');
    expect(fit.points).toBeGreaterThan(0);
    // She covers both open roles directly, so the primary is whichever has
    // the stronger evidence behind it — not whichever the fixtures happened
    // to list first.
    expect(fit.primary.basis).toBe('has-skill');
    expect(fit.covered.map((r) => r.skill_name).sort()).toEqual(['Figma', 'React']);
    expect(fit.parts.extraCoverage).toBe(1);
  });

  test('a student with no skills gets a prompt from every project, not a zero', async () => {
    setSessionUserId('u-sofia');
    const all = await getProjects({ onlyOpen: false });
    for (const project of all) {
      const fit = scoreFit({ project, student: { availability_hours: 10, skills: [] } });
      expect(fit.status).toBe('no-skills');
      expect(fit.band).toBeNull();
    }
  });

  // Every student against every project: the cheapest way to find out that
  // one combination of fixtures throws, divides by zero, or produces a score
  // outside the range the UI is built for.
  test('scoring every project against every mock student never throws', async () => {
    const all = await getProjects({ onlyOpen: false });
    const { users, skillsForUser } = await import('./mockData');

    for (const u of users) {
      const me = { availability_hours: u.availability_hours, skills: skillsForUser(u.id) };
      for (const project of all) {
        const fit = scoreFit({ project, student: me });
        expect(['ok', 'no-skills', 'no-open-roles']).toContain(fit.status);
        expect(fit.points).toBeGreaterThanOrEqual(0);
        expect(fit.points).toBeLessThanOrEqual(100);
        expect(Array.isArray(fit.reasons)).toBe(true);
        expect(fit.reasons.length).toBeGreaterThan(0);
      }
    }
  });
});
