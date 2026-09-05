import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import Browse from './pages/Browse';
import Profile from './pages/Profile';
import Requests from './pages/Requests';
import Team from './pages/Team';
import Avatar from './components/Avatar';

const TABS = [
  { to: '/browse', label: 'Browse' },
  { to: '/profile', label: 'Your profile' },
  { to: '/requests', label: 'Requests' },
  { to: '/team', label: 'Your team' },
];

export default function App() {
  return (
    <>
      <header className="bar">
        <div className="mark">
          Team<span>Up</span>
        </div>
        <nav className="nav">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => (isActive ? 'on' : '')}>
              {t.label}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          Adan Barrera <Avatar name="Adan Barrera" />
        </div>
      </header>

      <main className="shell">
        <Routes>
          <Route path="/" element={<Navigate to="/browse" replace />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/requests" element={<Requests />} />
          <Route path="/team" element={<Team />} />
          <Route path="*" element={<p className="empty">Page not found.</p>} />
        </Routes>
      </main>
    </>
  );
}
