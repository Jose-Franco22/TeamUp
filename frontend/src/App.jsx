import { Link, NavLink, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Browse from './pages/Browse';
import Profile from './pages/Profile';
import Requests from './pages/Requests';
import Team from './pages/Team';
import Avatar from './components/Avatar';
import { useSession } from './auth/SessionContext';
import ProtectedRoute from './auth/ProtectedRoute';

const PUBLIC_TABS = [{ to: '/browse', label: 'Browse' }];
const MEMBER_TABS = [
  { to: '/profile', label: 'Your profile' },
  { to: '/requests', label: 'Requests' },
  { to: '/team', label: 'Your team' },
];

export default function App() {
  const { status, user, signOut } = useSession();
  const tabs = status === 'authenticated' ? [...PUBLIC_TABS, ...MEMBER_TABS] : PUBLIC_TABS;

  return (
    <>
      <header className="bar">
        <Link className="mark" to="/">
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
          {status === 'authenticated' && (
            <>
              {user.name} <Avatar name={user.name} />
              <button className="btn quiet" onClick={signOut}>
                Sign out
              </button>
            </>
          )}
          {status === 'guest' && (
            <Link className="btn ghost" to="/login">
              Sign in
            </Link>
          )}
        </div>
      </header>

      <main className="shell">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/browse" element={<Browse />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/profile" element={<Profile />} />
            <Route path="/requests" element={<Requests />} />
            <Route path="/team" element={<Team />} />
          </Route>
          <Route path="*" element={<p className="empty">Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
