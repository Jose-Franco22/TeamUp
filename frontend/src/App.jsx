import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Login from './pages/Login';
import Browse from './pages/Browse';
import CreateProject from './pages/CreateProject';
import EditProject from './pages/EditProject';
import Profile from './pages/Profile';
import Requests from './pages/Requests';
import Team from './pages/Team';
import Admin from './pages/Admin';
import AdminTeam from './pages/AdminTeam';
import AdminStudent from './pages/AdminStudent';
import AdminMilestones from './pages/AdminMilestones';
import Announcements from './pages/Announcements';
import Avatar from './components/Avatar';
import ThemeToggle from './components/ThemeToggle';
import Walkthrough from './components/Walkthrough';
import { PendingBadge, RequestNotices, useRequestAlerts } from './components/RequestAlerts';
import { MilestoneBanner } from './components/Milestones';
import { useUnseenAnnouncements } from './components/AnnouncementAlerts';
import { useSession } from './auth/SessionContext';
import ProtectedRoute from './auth/ProtectedRoute';

// Everything but /login needs a signed-in user, so guests get no tabs.
const TABS = [
  { to: '/browse', label: 'Browse' },
  { to: '/projects/new', label: 'Create a project' },
  { to: '/profile', label: 'Your profile' },
  { to: '/requests', label: 'Requests' },
  { to: '/team', label: 'Your team' },
  { to: '/announcements', label: 'Announcements' },
];

export default function App() {
  const { status, user, onboarded, signOut } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const signedIn = status === 'authenticated';
  const isAdmin = user?.is_admin === true;
  const tabs = !signedIn ? [] : isAdmin
    ? [
        { to: '/admin', label: 'Admin' },
        { to: '/admin/milestones', label: 'Milestones' },
        { to: '/announcements', label: 'Announcements' },
        { to: '/profile', label: 'Your profile' },
      ]
    : TABS;
  // Admins are never on a team, so they never own a project to hear about.
  const requestAlerts = useRequestAlerts(signedIn && !isAdmin);
  // Admins post the announcements, so only students get the "new" count.
  const unseenAnnouncements = useUnseenAnnouncements(signedIn && !isAdmin);

  // Every page but /login needs a session, so signing out goes straight to
  // the sign-in page. Navigating first means ProtectedRoute never records
  // the page being left, so the next person to sign in on this browser
  // isn't sent back to the previous student's profile.
  // On a phone the tabs and account controls live in a slide-out menu
  // (issue #46). Moving to another page, Escape, or a tap outside closes it.
  useEffect(() => setMenuOpen(false), [pathname, signedIn]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setMenuOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  async function handleSignOut() {
    navigate('/login', { replace: true });
    await signOut();
  }

  return (
    <>
      <header className={signedIn ? 'bar has-menu' : 'bar'}>
        <Link className="mark" to={isAdmin ? '/admin' : '/browse'}>
          Team<span>Up</span>
        </Link>
        {signedIn && (
          <button
            type="button"
            className="menu-toggle"
            aria-controls="site-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        )}
        {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
        <div id="site-menu" className={menuOpen ? 'menu open' : 'menu'}>
          <nav className="nav">
            {tabs.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                className={({ isActive }) =>
                  // /admin covers the team and student pages under it, but
                  // not the Milestones tab, which has its own highlight.
                  isActive && !(t.to === '/admin' && pathname.startsWith('/admin/milestones')) ? 'on' : ''
                }
              >
                {t.label}
                {t.to === '/requests' && <PendingBadge count={requestAlerts.pending} />}
                {t.to === '/announcements' && <PendingBadge count={unseenAnnouncements} label="new" />}
              </NavLink>
            ))}
          </nav>
          <div className="me">
            <ThemeToggle />
            {signedIn && (
              <>
                <span className="who">{user.name}</span> <Avatar name={user.name} />
                <button className="btn quiet" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="shell">
        {/* The Announcements page lists every deadline itself. */}
        {signedIn && !isAdmin && pathname !== '/announcements' && <MilestoneBanner />}
        <RequestNotices notices={requestAlerts.notices} onDismiss={requestAlerts.dismiss} />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Navigate to={isAdmin ? '/admin' : '/browse'} replace />} />
            <Route element={<ProtectedRoute studentOnly />}>
              <Route path="/browse" element={<Browse />} />
              <Route path="/projects/new" element={<CreateProject />} />
              <Route path="/projects/:id/edit" element={<EditProject />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/team" element={<Team />} />
            </Route>
            <Route element={<ProtectedRoute adminOnly />}>
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/milestones" element={<AdminMilestones />} />
              <Route path="/admin/teams/:teamId" element={<AdminTeam />} />
              <Route path="/admin/students/:studentId" element={<AdminStudent />} />
              <Route path="/admin/*" element={<p className="empty">Page not found.</p>} />
            </Route>
            <Route path="/profile" element={<Profile />} />
            <Route path="/announcements" element={<Announcements />} />
            <Route path="*" element={<p className="empty">Page not found.</p>} />
          </Route>
        </Routes>
      </main>

      {signedIn && !isAdmin && !onboarded && <Walkthrough />}
    </>
  );
}
