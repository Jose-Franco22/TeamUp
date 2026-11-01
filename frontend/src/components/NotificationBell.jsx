import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getNotificationFeed,
  markAllNotificationsRead,
  markNotificationsRead,
  subscribeToNotifications,
  NOTIFICATION_FEED_SIZE,
} from '../api/client';

// The page each kind opens. Worked out here rather than stored, as
// supabase/20_leave_team_rules.sql describes. A student taken off a team, or
// turned down, has no team page to go to, so they're sent to Browse.
const LINKS = {
  join_request: '/requests',
  member_left: '/team',
  member_removed: '/browse',
  request_accepted: '/team',
  request_declined: '/browse',
};

export function notificationLink(n) {
  return LINKS[n.kind] ?? '/browse';
}

export function notificationText(n) {
  const project = `“${n.project_title}”`;
  switch (n.kind) {
    case 'join_request':
      return `${n.actor_name} asked to join ${project}`;
    case 'member_left':
      return n.by_admin ? `An admin took ${n.actor_name} off ${project}` : `${n.actor_name} left ${project}`;
    case 'member_removed':
      return `${n.by_admin ? 'An admin' : n.actor_name} removed you from ${project}`;
    case 'request_accepted':
      return `You were accepted onto ${project}`;
    case 'request_declined':
      return `Your request to join ${project} was declined`;
    default:
      return `Something changed on ${project}`;
  }
}

// The header bell (issue #20): an unread count, and a dropdown of the latest
// notifications. New ones arrive over Realtime without a reload; the list is
// also re-read on every page change, since other parts of the app (the
// Requests and Team pages) mark notifications read on their own.
export default function NotificationBell() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  // Ids already on the list or already counted. Realtime can deliver the same
  // row twice (on reconnect, say), and the count must only go up once.
  const seen = useRef(new Set());

  useEffect(() => {
    let live = true;
    // An extra on top of whatever page is open, so a failed read just keeps
    // the last list rather than showing an error.
    getNotificationFeed()
      .then((feed) => {
        if (!live) return;
        seen.current = new Set(feed.items.map((n) => n.id));
        setItems(feed.items);
        setUnread(feed.unread);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  useEffect(
    () =>
      subscribeToNotifications((n) => {
        if (seen.current.has(n.id)) return;
        seen.current.add(n.id);
        setItems((list) => [n, ...list].slice(0, NOTIFICATION_FEED_SIZE));
        if (!n.read_at) setUnread((count) => count + 1);
      }),
    []
  );

  // Close on Escape or a click anywhere outside the bell and its list.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => root.current && !root.current.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  function markReadLocally(ids) {
    const now = new Date().toISOString();
    setItems((list) => list.map((n) => (ids.includes(n.id) && !n.read_at ? { ...n, read_at: now } : n)));
  }

  function handleOpen(n) {
    setOpen(false);
    if (!n.read_at) {
      markReadLocally([n.id]);
      setUnread((count) => Math.max(0, count - 1));
      // If this fails it's just unread again on the next page change.
      markNotificationsRead([n.id]).catch(() => {});
    }
    navigate(notificationLink(n));
  }

  function handleMarkAll() {
    markReadLocally(items.map((n) => n.id));
    setUnread(0);
    markAllNotificationsRead().catch(() => {});
  }

  return (
    <div className="bell" ref={root}>
      <button
        type="button"
        className="bell-toggle"
        aria-label={unread ? `Notifications (${unread} unread)` : 'Notifications'}
        aria-expanded={open}
        aria-controls="bell-list"
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="count-badge bell-badge" data-testid="bell-badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div id="bell-list" className="bell-panel" role="region" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            <button type="button" className="btn quiet" onClick={handleMarkAll} disabled={unread === 0}>
              Mark all as read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="bell-empty">Nothing yet.</p>
          ) : (
            <ul className="bell-items">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" className={n.read_at ? 'bell-item' : 'bell-item unread'} onClick={() => handleOpen(n)}>
                    <span>{notificationText(n)}</span>
                    <time dateTime={n.created_at}>{new Date(n.created_at).toLocaleDateString()}</time>
                    {!n.read_at && <span className="sr-only"> (unread)</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
