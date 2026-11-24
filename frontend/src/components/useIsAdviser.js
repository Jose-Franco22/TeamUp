import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { isAdviser } from '../api/client';

// Whether the signed-in user advises at least one team, for the header's
// Advising tab (#56). Asked again on every page change, so accepting an
// invitation on Requests or stepping down shows up on the next click rather
// than the next sign-in. A failure reads as "no": the tab is a shortcut, and
// /advising itself still works.
export default function useIsAdviser(enabled, userId) {
  const { pathname } = useLocation();
  const [advises, setAdvises] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAdvises(false);
      return undefined;
    }
    let cancelled = false;
    isAdviser()
      .then((yes) => !cancelled && setAdvises(Boolean(yes)))
      .catch(() => !cancelled && setAdvises(false));
    return () => {
      cancelled = true;
    };
  }, [enabled, userId, pathname]);

  return advises;
}
