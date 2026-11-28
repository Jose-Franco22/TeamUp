import { useCallback, useEffect, useRef, useState } from 'react';

// Runs an async loader on mount and exposes loading/error/data plus a
// reload function. Every page uses this so loading and error handling
// behave the same way everywhere instead of being reinvented per screen.
//
// Only the newest run may set state. reload() after a save starts a second
// load while the first may still be in flight; without the counter, a slow
// first answer arriving after the fresh one would put the stale data back.
export default function useAsync(loader, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);

  const run = useCallback(() => {
    const ticket = ++latest.current;
    const current = () => ticket === latest.current;
    setLoading(true);
    setError(null);

    loader()
      .then((result) => {
        if (current()) setData(result);
      })
      .catch((err) => {
        if (current()) setError(err);
      })
      .finally(() => {
        if (current()) setLoading(false);
      });

    // Unmounting, or deps changing, retires this run too.
    return () => {
      if (current()) latest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(run, [run]);

  return { data, error, loading, reload: run, setData };
}
