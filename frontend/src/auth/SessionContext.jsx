import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { users } from '../api/mockData';
import { setAuthHeaderProvider, setSessionUserId } from '../api/client';

// Stand-in for Supabase Auth. Session state lives here; client.js never
// imports a hardcoded user again. When Supabase Auth drops in:
//   - the localStorage read/write below becomes supabase.auth.getSession()
//     plus an onAuthStateChange subscription
//   - signIn(userId) becomes supabase.auth.signInWithPassword(...)
//   - the authHeaderProvider becomes `Bearer ${session.access_token}`
// None of that touches client.js call sites or page components.

const STORAGE_KEY = 'teamup.mockSessionUserId';

const SessionContext = createContext(null);

export function SessionProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  useEffect(() => {
    const storedId = localStorage.getItem(STORAGE_KEY);
    const stored = storedId && users.find((u) => u.id === storedId);
    if (stored) {
      setSessionUserId(stored.id);
      setAuthHeaderProvider(() => ({ Authorization: `Bearer stub-${stored.id}` }));
      setUser(stored);
      setStatus('authenticated');
    } else {
      setSessionUserId(null);
      setAuthHeaderProvider(() => ({}));
      setStatus('guest');
    }
  }, []);

  function signIn(userId) {
    const u = users.find((x) => x.id === userId);
    if (!u) throw new Error('Unknown user');
    localStorage.setItem(STORAGE_KEY, u.id);
    setSessionUserId(u.id);
    setAuthHeaderProvider(() => ({ Authorization: `Bearer stub-${u.id}` }));
    setUser(u);
    setStatus('authenticated');
  }

  function signOut() {
    localStorage.removeItem(STORAGE_KEY);
    setSessionUserId(null);
    setAuthHeaderProvider(() => ({}));
    setUser(null);
    setStatus('guest');
  }

  const value = useMemo(() => ({ status, user, signIn, signOut }), [status, user]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
