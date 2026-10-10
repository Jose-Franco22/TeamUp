// Issue #18 — the real (Microsoft) sign-in page: errors Supabase sends back
// after a rejected sign-in are shown, and the button starts the Microsoft flow.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const signInWithMicrosoft = vi.fn();
const session = { status: 'guest' };
vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ ...session, signInWithMicrosoft }),
}));

// Login picks the mock or real form when the module loads, so switch to
// real mode first and import it fresh.
async function renderLogin(url = '/login', { from } = {}) {
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.resetModules();
  window.history.replaceState(null, '', url);
  const { default: Login } = await import('./Login');
  const entry = { pathname: '/login', state: from ? { from: { pathname: from } } : null };
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<PathProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

function PathProbe() {
  return <p>Now at {useLocation().pathname}</p>;
}

beforeEach(() => {
  signInWithMicrosoft.mockReset();
  session.status = 'guest';
});

describe('when a session already exists', () => {
  test('a signed-in student is sent on to Browse', async () => {
    session.status = 'authenticated';
    await renderLogin();
    expect(screen.getByText('Now at /browse')).toBeInTheDocument();
  });

  test('…or back to the page they were trying to open', async () => {
    session.status = 'authenticated';
    await renderLogin('/login', { from: '/team' });
    expect(screen.getByText('Now at /team')).toBeInTheDocument();
  });

  test('shows a loading state while the session is being checked', async () => {
    session.status = 'loading';
    await renderLogin();
    expect(screen.getByRole('status')).toHaveTextContent('Checking session');
    expect(screen.queryByRole('button', { name: 'Sign in with Microsoft' })).not.toBeInTheDocument();
  });
});

describe('Microsoft sign-in page', () => {
  test('shows the rejection message Supabase puts in the query string', async () => {
    await renderLogin(
      '/login?error=server_error&error_description=Only+%40utrgv.edu+accounts+may+sign+in+to+TeamUp'
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Only @utrgv.edu accounts may sign in to TeamUp');
  });

  test('shows the rejection message when it comes back in the URL hash', async () => {
    await renderLogin('/login#error=server_error&error_description=Only%20%40utrgv.edu%20accounts%20may%20sign%20in%20to%20TeamUp');
    expect(screen.getByRole('alert')).toHaveTextContent('Only @utrgv.edu accounts may sign in to TeamUp');
  });

  test('shows no error on a normal visit', async () => {
    await renderLogin('/login');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(/@utrgv\.edu Microsoft account/)).toBeInTheDocument();
  });

  test('the button starts the Microsoft sign-in and shows that it is redirecting', async () => {
    signInWithMicrosoft.mockReturnValue(new Promise(() => {})); // browser would navigate away
    await renderLogin();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(signInWithMicrosoft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Redirecting…' })).toBeDisabled();
  });

  test('if starting sign-in fails, the error is shown and the button works again', async () => {
    signInWithMicrosoft.mockRejectedValue(new Error('Could not reach Microsoft'));
    await renderLogin();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign in with Microsoft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach Microsoft');
    expect(screen.getByRole('button', { name: 'Sign in with Microsoft' })).toBeEnabled();
  });
});
