// Issue #18 — protected pages redirect guests to /login.
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import ProtectedRoute from './ProtectedRoute';
import { useSession } from './SessionContext';

vi.mock('./SessionContext', () => ({ useSession: vi.fn() }));

function LoginProbe() {
  const location = useLocation();
  return <p>Login page (from {location.state?.from?.pathname ?? 'nowhere'})</p>;
}

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/team" element={<p>Team page</p>} />
        </Route>
        <Route path="/login" element={<LoginProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  test('a guest is redirected to /login, remembering where they were going', () => {
    useSession.mockReturnValue({ status: 'guest' });
    renderAt('/team');
    expect(screen.getByText('Login page (from /team)')).toBeInTheDocument();
    expect(screen.queryByText('Team page')).not.toBeInTheDocument();
  });

  test('a signed-in user sees the page', () => {
    useSession.mockReturnValue({ status: 'authenticated', user: { id: 'u-jose' } });
    renderAt('/team');
    expect(screen.getByText('Team page')).toBeInTheDocument();
  });

  test('shows a loading state while the session is being checked, and nothing protected', () => {
    useSession.mockReturnValue({ status: 'loading' });
    renderAt('/team');
    expect(screen.getByRole('status')).toHaveTextContent('Checking session');
    expect(screen.queryByText('Team page')).not.toBeInTheDocument();
    expect(screen.queryByText(/Login page/)).not.toBeInTheDocument();
  });
});
