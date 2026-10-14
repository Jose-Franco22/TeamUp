// Issue #26 — getPendingRequestCount() against a fake Supabase, in REAL
// mode. Mock mode proves the badge works; this proves the query asks for
// the right rows: pending, not the viewer's own, and only a count.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state = { calls: [], result: { count: 0, error: null } };
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u-me' } } } })),
    },
    from: vi.fn((table) => {
      state.calls.push(['from', table]);
      const query = {
        select: (...args) => (state.calls.push(['select', ...args]), query),
        eq: (...args) => (state.calls.push(['eq', ...args]), query),
        neq: (...args) => (state.calls.push(['neq', ...args]), query),
        then: (resolve, reject) => Promise.resolve(state.result).then(resolve, reject),
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

beforeEach(() => {
  fake.state.calls = [];
  fake.state.result = { count: 0, error: null };
});

describe('getPendingRequestCount (real mode)', () => {
  test('counts pending join_requests that are not the viewer\'s own, without fetching rows', async () => {
    fake.state.result = { count: 3, error: null };
    const { getPendingRequestCount } = await realMode();

    expect(await getPendingRequestCount()).toBe(3);
    expect(fake.state.calls).toEqual([
      ['from', 'join_requests'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'status', 'pending'],
      ['neq', 'user_id', 'u-me'],
    ]);
  });

  test('a null count reads as zero', async () => {
    fake.state.result = { count: null, error: null };
    const { getPendingRequestCount } = await realMode();

    expect(await getPendingRequestCount()).toBe(0);
  });

  test('an error from the database is thrown', async () => {
    fake.state.result = { count: null, error: new Error('boom') };
    const { getPendingRequestCount } = await realMode();

    await expect(getPendingRequestCount()).rejects.toThrow('boom');
  });
});
