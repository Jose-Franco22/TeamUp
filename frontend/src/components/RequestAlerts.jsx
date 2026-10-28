import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getNotifications, getPendingRequestCount, markNotificationsRead } from '../api/client';

// Fired by the Requests page after accepting or declining, so the tab's
// count drops without waiting for the next page change.
export const REQUESTS_CHANGED = 'teamup:requests-changed';

// What a project creator needs to hear about join requests (issue #26): how
// many are waiting (the Requests tab badge) and the unread 'join_request'
// notifications, each naming who asked. Refreshed on every page change and
// whenever the tab regains focus. Opening /requests counts as reading them.
export function useRequestAlerts(enabled) {
  const { pathname } = useLocation();
  const [pending, setPending] = useState(0);
  const [notices, setNotices] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener(REQUESTS_CHANGED, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(REQUESTS_CHANGED, refresh);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setPending(0);
      setNotices([]);
      return undefined;
    }
    let live = true;
    // Both are extras on top of whatever page is open, so a failure just
    // leaves the last values in place rather than showing an error.
    getPendingRequestCount()
      .then((n) => live && setPending(n))
      .catch(() => {});
    getNotifications()
      .then((all) => {
        if (!live) return;
        const mine = all.filter((n) => n.kind === 'join_request');
        if (pathname === '/requests' && mine.length > 0) {
          markNotificationsRead(mine.map((n) => n.id)).catch(() => {});
          setNotices([]);
        } else {
          setNotices(mine);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, pathname, tick]);

  function dismiss() {
    const ids = notices.map((n) => n.id);
    setNotices([]);
    // If this fails the notices just come back on the next page change.
    markNotificationsRead(ids).catch(() => {});
  }

  return { pending, notices, dismiss };
}

// The number on a tab. Renders nothing when nothing is waiting. Screen
// readers hear the tab as "Requests (2 pending)", or with `label`, e.g.
// "Announcements (2 new)".
export function PendingBadge({ count, label = 'pending' }) {
  if (!count) return null;
  return (
    <>
      <span className="count-badge" aria-hidden="true">
        {count}
      </span>
      <span className="sr-only"> ({count} {label})</span>
    </>
  );
}

export function RequestNotices({ notices, onDismiss }) {
  if (notices.length === 0) return null;
  return (
    <section className="card request-notices" aria-label="New join requests">
      <ul className="notices">
        {notices.map((n) => (
          <li key={n.id}>
            {n.actor_name} asked to join “{n.project_title}”.{' '}
            <Link to="/requests">Review on your Requests page</Link>
          </li>
        ))}
      </ul>
      <div className="foot">
        <button className="btn quiet" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}
