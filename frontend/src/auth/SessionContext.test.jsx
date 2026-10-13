// Issue #18 — SessionContext in real (Supabase) mode, with supabase-js
// replaced by a fake so no network or Microsoft call happens. Also covers
// the first-sign-in walkthrough's onboarded flag.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const fake = vi.hoisted(() => {
  const state = { session: null, profiles: {}, authListener: null, updates: [] };
  const supabase = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: state.session } })),
      onAuthStateChange: vi.fn((cb) => {
        state.authListener = cb;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOAuth: vi.fn(async () => ({ error: null })),
      signOut: vi.fn(async () => ({ error: null })),
    },
    // Just enough of the query builder for SessionContext:
    //   from('users').select(...).eq('id', x).single()
    //   await from('users').update({...}).eq('id', x)
    from: vi.fn((table) => {
      let id;
      let patch = null;
      const query = {
        select: vi.fn(() => query),
        update: (values) => {
          patch = values;
          return query;
        },
        eq: (_col, value) => {
          id = value;
          return query;
        },
        single: async () =>
          state.profiles[id]
            ? { data: state.profiles[id], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'No rows' } },
        then: (resolve) => {
          if (patch) {
            state.updates.push({ table, id, patch });
            if (state.profiles[id]) Object.assign(state.profiles[id], patch);
          }
          resolve({ error: null });
        },
      };
      return query;
    }),
  };
  return { state, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

const JANE = {
  id: 'auth-jane',
  email: 'jane.doe01@utrgv.edu',
  name: 'Jane Doe',
  bio: '',
  availability_hours: 10,
  github_url: '',
  onboarded_at: null,
};

async function renderSession() {
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.resetModules();
  const { SessionProvider, useSession } = await import('./SessionContext');
  let api;
  function Probe() {
    api = useSession();
    return (
      <p data-testid="status">
        {api.status}:{api.user?.email ?? 'none'}:{api.onboarded ? 'onboarded' : 'new'}
      </p>
    );
  }
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>
  );
  return { api: () => api };
}

const status = () => screen.getByTestId('status').textContent;

function signedInAs(profile) {
  fake.state.session = { user: { id: profile.id } };
  fake.state.profiles[profile.id] = { ...profile };
}

beforeEach(() => {
  fake.state.session = null;
  fake.state.profiles = {};
  fake.state.authListener = null;
  fake.state.updates = [];
});

describe('SessionContext (real mode)', () => {
  test('loads admin status from the database profile, not OAuth metadata', async () => {
    signedInAs({ ...JANE, is_admin: true });
    const { api } = await renderSession();
    await waitFor(() => expect(api().status).toBe('authenticated'));
    expect(api().user.is_admin).toBe(true);
    expect(fake.supabase.from.mock.results.some(({ value }) =>
      value.select.mock.calls.some(([columns]) => columns.includes('is_admin'))
    )).toBe(true);
  });

  test('OAuth metadata cannot turn a database student into an admin', async () => {
    signedInAs({ ...JANE, is_admin: false });
    fake.state.session.user.user_metadata = { is_admin: true };
    const { api } = await renderSession();
    await waitFor(() => expect(api().status).toBe('authenticated'));
    expect(api().user.is_admin).toBe(false);
  });

  test('no session means guest', async () => {
    await renderSession();
    await waitFor(() => expect(status()).toMatch(/^guest:none/));
  });

  test('a session with a provisioned profile is authenticated as that user', async () => {
    signedInAs(JANE);
    await renderSession();
    await waitFor(() => expect(status()).toMatch(/^authenticated:jane\.doe01@utrgv\.edu/));
  });

  test('a session with no profile row (e.g. a rejected non-UTRGV account) ends as guest', async () => {
    fake.state.session = { user: { id: 'auth-gmail-user' } };
    await renderSession();
    await waitFor(() => expect(status()).toMatch(/^guest:none/));
  });

  test('an auth change to no session (signed out elsewhere, token expired) ends as guest', async () => {
    signedInAs(JANE);
    await renderSession();
    await waitFor(() => expect(status()).toMatch(/^authenticated/));
    await act(async () => fake.state.authListener('SIGNED_OUT', null));
    expect(status()).toMatch(/^guest:none/);
  });

  test('signInWithMicrosoft uses the Azure provider and comes back to /login', async () => {
    // Back to /login, not /browse, so a rejected sign-in's error is still in
    // the URL for the Login page to show; Login sends a success on to /browse.
    const { api } = await renderSession();
    await waitFor(() => expect(status()).toMatch(/^guest/));
    await api().signInWithMicrosoft();
    expect(fake.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/login` },
    });
  });

  test('signOut signs out of Supabase and ends as guest', async () => {
    signedInAs(JANE);
    const { api } = await renderSession();
    await waitFor(() => expect(status()).toMatch(/^authenticated/));
    await act(() => api().signOut());
    expect(fake.supabase.auth.signOut).toHaveBeenCalled();
    expect(status()).toMatch(/^guest:none/);
  });

  test('the mock-only stub login refuses to run in real mode', async () => {
    const { api } = await renderSession();
    expect(() => api().signIn('u-jose')).toThrow(/mock-only/);
  });
});

describe('Onboarding flag (real mode)', () => {
  test('a student who has never finished the walkthrough is not onboarded', async () => {
    signedInAs(JANE);
    await renderSession();
    await waitFor(() => expect(status()).toBe('authenticated:jane.doe01@utrgv.edu:new'));
  });

  test('a student with onboarded_at set is onboarded', async () => {
    signedInAs({ ...JANE, onboarded_at: '2026-10-01T12:00:00Z' });
    await renderSession();
    await waitFor(() => expect(status()).toBe('authenticated:jane.doe01@utrgv.edu:onboarded'));
  });

  test('completeOnboarding flips the flag and saves onboarded_at on their own row', async () => {
    signedInAs(JANE);
    const { api } = await renderSession();
    await waitFor(() => expect(status()).toMatch(/:new$/));
    await act(() => api().completeOnboarding());
    expect(status()).toMatch(/:onboarded$/);
    expect(fake.state.updates).toEqual([
      { table: 'users', id: JANE.id, patch: { onboarded_at: expect.any(String) } },
    ]);
    expect(Number.isNaN(Date.parse(fake.state.updates[0].patch.onboarded_at))).toBe(false);
  });
});
