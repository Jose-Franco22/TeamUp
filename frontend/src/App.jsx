import { Link, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Login from './pages/Login';
import Browse from './pages/Browse';
import CreateProject from './pages/CreateProject';
import EditProject from './pages/EditProject';
import Profile from './pages/Profile';
import Requests from './pages/Requests';
import Team from './pages/Team';
import Avatar from './components/Avatar';
import ThemeToggle from './components/ThemeToggle';
import Walkthrough from './components/Walkthrough';
import { useSession } from './auth/SessionContext';
import ProtectedRoute from './auth/ProtectedRoute';

// Everything but /login needs a signed-in user, so guests get no tabs.
const TABS = [
  { to: '/browse', label: 'Browse' },
  { to: '/projects/new', label: 'Create a project' },
  { to: '/profile', label: 'Your profile' },
  { to: '/requests', label: 'Requests' },
  { to: '/team', label: 'Your team' },
];

export default function App() {
  const { status, user, onboarded, signOut } = useSession();
  const tabs = status === 'authenticated' ? TABS : [];

  return (
    <>
      <header className="bar">
        <Link className="mark" to="/browse">
          Team<span>Up</span>
        </Link>
        <nav className="nav">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <ThemeToggle />
          {status === 'authenticated' && (
            <>
              {user.name} <Avatar name={user.name} />
              <button className="btn quiet" onClick={signOut}>
                Sign out
              </button>
            </>
          )}
        </div>
      </header>

      <main className="shell">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to="/browse" replace />} />
            <Route path="/browse" element={<Browse />} />
            <Route path="/projects/new" element={<CreateProject />} />
            <Route path="/projects/:id/edit" element={<EditProject />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/team" element={<Team />} />
            <Route path="*" element={<p className="empty">Page not found.</p>} />
          </Route>
        </Routes>
      </main>

      {status === 'authenticated' && !onboarded && <Walkthrough />}
    </>
  );
}
