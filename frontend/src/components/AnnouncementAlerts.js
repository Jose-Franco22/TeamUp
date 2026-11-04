import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getUnseenAnnouncementCount } from '../api/client';
import { ANNOUNCEMENTS_SEEN } from '../pages/Announcements';

// The number on the Announcements tab: announcements and milestones new or
// changed since the student last opened /announcements
// (supabase/29_announcements.sql). Refreshed on every page change and when
// the window regains focus; zero while the page itself is open, since
// opening it is what reads them.
export function useUnseenAnnouncements(enabled) {
  const { pathname } = useLocation();
  const [count, setCount] = useState(0);
  const [tick, setTick] = useState(0);
  const onPage = pathname === '/announcements';

  useEffect(() => {
    if (!enabled) return undefined;
    const refresh = () => setTick((t) => t + 1);
    window.addEventListener('focus', refresh);
    window.addEventListener(ANNOUNCEMENTS_SEEN, refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener(ANNOUNCEMENTS_SEEN, refresh);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || onPage) {
      setCount(0);
      return undefined;
    }
    let live = true;
    // An extra on top of whatever page is open: a failure keeps the last value.
    getUnseenAnnouncementCount()
      .then((n) => live && setCount(n))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, onPage, pathname, tick]);

  return count;
}
