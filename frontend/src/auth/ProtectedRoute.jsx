import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from './SessionContext';
import { Loading } from '../components/States';

// Wraps routes that require a signed-in user. Guests are bounced to
// /login with the page they wanted stashed in location state, so Login
// can send them back after signing in.
export default function ProtectedRoute() {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') return <Loading label="Checking session" />;
  if (status === 'guest') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}
