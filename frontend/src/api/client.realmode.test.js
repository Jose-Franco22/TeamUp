// Issue #31 — getCurrentUser() against a fake Supabase, in REAL mode.
//
// Why this file exists: the first version of the evidence loading asked
// PostgREST for `users?select=..., profile_evidence ( ... )`. That has no
// foreign key behind it — profile_evidence's only FK is the composite
// (user_id, skill_id) -> user_skills — so the real database answers PGRST200
// and the profile page fails to load for everyone. Every test and the
// browser check ran in mock mode, where the shape is assembled by hand, so
// nothing caught it.
//
// Mock mode proves the components work. It cannot prove the queries do.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state = { row: null, error: null, selects: [] };
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u-me' } } } })),
    },
    from: vi.fn(() => {
      const query = {
        select: (columns) => {
          state.selects.push(columns);
          return query;
        },
        eq: () => query,
        order: () => query,
        single: async () => ({ data: state.row, error: state.error }),
      };
      return query;
    }),
  };
  return { state, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

// USE_MOCKS is read once when the module loads, so the env has to be set
// before the import rather than in a beforeEach.
async function realMode() {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  return import('./client');
}

const REACT = { id: 's-react', name: 'React', category: 'Frontend' };
const PG = { id: 's-pg', name: 'PostgreSQL', category: 'Backend' };

const userRow = (user_skills) => ({
  id: 'u-me',
  email: 'me01@utrgv.edu',
  name: 'Me',
  bio: '',
  availability_hours: 12,
  github_url: '',
  user_skills,
});

beforeEach(() => {
  fake.state.row = null;
  fake.state.error = null;
  fake.state.selects = [];
  vi.clearAllMocks();
});

describe('the shape of the profile query', () => {
  test('asks for profile_evidence nested inside user_skills, where the FK is', async () => {
    const { USER_SELECT } = await realMode();
    expect(USER_SELECT).toContain(
      'user_skills ( source, skills ( id, name, category ), profile_evidence ( months, projects ) )'
    );
  });

  test('never asks for profile_evidence beside user_skills, which has no relationship', async () => {
    const { USER_SELECT } = await realMode();

    // Depth, not a regex: the nested form is comma-preceded too, so only
    // counting parentheses can tell "inside user_skills" from "beside it".
    // Depth 0 is the columns of `users` itself, which is where the broken
    // version put it.
    const depthsOf = (select, name) => {
      const found = [];
      let depth = 0;
      for (let i = 0; i < select.length; i++) {
        const char = select[i];
        if (char === '(') depth++;
        else if (char === ')') depth--;
        else if (select.startsWith(name, i)) found.push(depth);
      }
      return found;
    };

    expect(depthsOf(USER_SELECT, 'user_skills')).toEqual([0]);
    expect(depthsOf(USER_SELECT, 'profile_evidence')).toEqual([1]);
  });

  // The reason the nesting is required, asserted against the schema itself
  // so this cannot quietly stop being true.
  test('profile_evidence really has no foreign key to users', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const sql = readFileSync(resolve(process.cwd(), '../supabase/07_profile_evidence.sql'), 'utf8');

    expect(sql).toContain('references public.user_skills (user_id, skill_id)');
    expect(sql).not.toMatch(/references\s+public\.users/);
  });

  test('the query actually sent is the one we declared', async () => {
    const client = await realMode();
    fake.state.row = userRow([]);
    await client.getCurrentUser();
    expect(fake.state.selects[0]).toBe(client.USER_SELECT);
  });
});

describe('getCurrentUser in real mode', () => {
  test('returns the skills and their evidence, keyed by skill id', async () => {
    const client = await realMode();
    fake.state.row = userRow([
      { source: 'resume', skills: REACT, profile_evidence: { months: 14, projects: 3 } },
      { source: 'manual', skills: PG, profile_evidence: null },
    ]);

    const me = await client.getCurrentUser();
    expect(me.skills).toEqual([
      { ...REACT, source: 'resume' },
      { ...PG, source: 'manual' },
    ]);
    expect(me.evidence).toEqual({ 's-react': { months: 14, projects: 3 } });
  });

  // PostgREST returns an embedded child as a bare object when it can tell
  // the relationship is one-to-one, and as a one-element array otherwise.
  // Which one we get depends on the version, so both have to work.
  test('accepts the evidence as a one-element array too', async () => {
    const client = await realMode();
    fake.state.row = userRow([
      { source: 'resume', skills: REACT, profile_evidence: [{ months: 9, projects: 2 }] },
    ]);
    expect((await client.getCurrentUser()).evidence).toEqual({
      's-react': { months: 9, projects: 2 },
    });
  });

  test.each([
    ['null', null],
    ['an empty array', []],
    ['missing entirely', undefined],
  ])('a skill with no evidence (%s) is simply absent from the map', async (_label, value) => {
    const client = await realMode();
    fake.state.row = userRow([{ source: 'manual', skills: REACT, profile_evidence: value }]);
    const me = await client.getCurrentUser();
    expect(me.evidence).toEqual({});
    expect(me.skills).toHaveLength(1);
  });

  test('a null months or projects reads as zero rather than breaking the scorer', async () => {
    const client = await realMode();
    fake.state.row = userRow([
      { source: 'resume', skills: REACT, profile_evidence: { months: null, projects: null } },
    ]);
    expect((await client.getCurrentUser()).evidence).toEqual({
      's-react': { months: 0, projects: 0 },
    });
  });

  test('a profile with no skills at all gives an empty map, not undefined', async () => {
    const client = await realMode();
    fake.state.row = userRow([]);
    const me = await client.getCurrentUser();
    expect(me.skills).toEqual([]);
    expect(me.evidence).toEqual({});
  });

  test('the shape matches what the matching engine expects', async () => {
    const client = await realMode();
    const { scoreFit } = await import('../lib/matching/fit');
    fake.state.row = userRow([
      { source: 'resume', skills: REACT, profile_evidence: { months: 14, projects: 3 } },
    ]);

    const me = await client.getCurrentUser();
    const fit = scoreFit({
      project: {
        team_size_target: 4,
        member_count: 1,
        avg_availability_hours: 12,
        roles_needed: [
          {
            role_id: 'r-fe',
            role_name: 'Frontend Developer',
            skill_id: 's-react',
            skill_name: 'React',
            category: 'Frontend',
            quantity_needed: 1,
          },
        ],
      },
      student: me,
    });
    // The whole point of loading evidence: the strong band becomes reachable.
    expect(fit.parts.depth).toBeGreaterThan(0);
    expect(fit.band).toBe('strong');
  });

  test('an error from the database is thrown, not swallowed into an empty profile', async () => {
    const client = await realMode();
    fake.state.error = { code: 'PGRST200', message: 'could not find a relationship' };
    await expect(client.getCurrentUser()).rejects.toMatchObject({ code: 'PGRST200' });
  });
});
