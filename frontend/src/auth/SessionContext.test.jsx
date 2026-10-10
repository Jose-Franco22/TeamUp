// Issue #18 — SessionContext in real (Supabase) mode, with supabase-js
// replaced by a fake so no network or Microsoft call happens.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const fake = vi.hoisted(() => {
  const state = { session: null, profiles: {}, authListener: null };
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
    from: vi.fn(() => {
      let id;
      const query = {
        select: () => query,
        eq: (_col, value) => {
          id = value;
          return query;
        },
        single: async () =>
          state.profiles[id]
            ? { data: state.profiles[id], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'No rows' } },
      };
      return query;
    }),
  };
  return { state, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

const JANE = { id: 'auth-jane', email: 'jane.doe01@utrgv.edu', name: 'Jane Doe', bio: '', availability_hours: 10, github_url: '' };

async function renderSession() {
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.resetModules();
  const { SessionProvider, useSession } = await import('./SessionContext');
  let api;
  function Probe() {
    api = useSession();
    return <p data-testid="status">{api.status}:{api.user?.email ?? 'none'}</p>;
  }
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>
  );
  return { api: () => api };
}

const status = () => screen.getByTestId('status').textContent;

beforeEach(() => {
  fake.state.session = null;
  fake.state.profiles = {};
  fake.state.authListener = null;
});

describe('SessionContext (real mode)', () => {
  test('no session means guest', async () => {
    await renderSession();
    await waitFor(() => expect(status()).toBe('guest:none'));
  });

  test('a session with a provisioned profile is authenticated as that user', async () => {
    fake.state.session = { user: { id: JANE.id } };
    fake.state.profiles[JANE.id] = JANE;
    await renderSession();
    await waitFor(() => expect(status()).toBe('authenticated:jane.doe01@utrgv.edu'));
  });

  test('a session with no profile row (e.g. a rejected non-UTRGV account) ends as guest', async () => {
    fake.state.session = { user: { id: 'auth-gmail-user' } };
    await renderSession();
    await waitFor(() => expect(status()).toBe('guest:none'));
  });

  test('an auth change to no session (signed out elsewhere, token expired) ends as guest', async () => {
    fake.state.session = { user: { id: JANE.id } };
    fake.state.profiles[JANE.id] = JANE;
    await renderSession();
    await waitFor(() => expect(status()).toMatch(/^authenticated/));
    await act(async () => fake.state.authListener('SIGNED_OUT', null));
    expect(status()).toBe('guest:none');
  });

  test('signInWithMicrosoft uses the Azure provider and comes back to /browse', async () => {
    const { api } = await renderSession();
    await waitFor(() => expect(status()).toBe('guest:none'));
    await api().signInWithMicrosoft();
    expect(fake.supabase.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/browse` },
    });
  });

  test('signOut signs out of Supabase and ends as guest', async () => {
    fake.state.session = { user: { id: JANE.id } };
    fake.state.profiles[JANE.id] = JANE;
    const { api } = await renderSession();
    await waitFor(() => expect(status()).toMatch(/^authenticated/));
    await act(() => api().signOut());
    expect(fake.supabase.auth.signOut).toHaveBeenCalled();
    expect(status()).toBe('guest:none');
  });

  test('the mock-only stub login refuses to run in real mode', async () => {
    const { api } = await renderSession();
    expect(() => api().signIn('u-jose')).toThrow(/mock-only/);
  });
});

// The app's own sign-out button, end to end in mock mode.
describe('Sign out button', () => {
  test('signing out from a protected page lands on the landing page', async () => {
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    vi.resetModules();
    localStorage.setItem('teamup.mockSessionUserId', 'u-jose');
    const { MemoryRouter } = await import('react-router-dom');
    const { SessionProvider } = await import('./SessionContext');
    const { ThemeProvider } = await import('../theme/ThemeContext');
    const { default: App } = await import('../App');
    render(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/profile']}>
          <SessionProvider>
            <App />
          </SessionProvider>
        </MemoryRouter>
      </ThemeProvider>
    );
    await screen.findByRole('heading', { name: 'Your profile' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: /Find a senior project team/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);
    expect(localStorage.getItem('teamup.mockSessionUserId')).toBeNull();
  });
});
