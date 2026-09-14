import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { users } from '../api/mockData';
import { setSessionUserId } from '../api/client';
import { supabase } from '../lib/supabaseClient';

// Session state lives here; client.js and page components never touch
// supabase-js or the mock user list directly.

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';
const STORAGE_KEY = 'teamup.mockSessionUserId';

const SessionContext = createContext(null);

async function loadProfile(authUserId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, bio, availability_hours, github_url')
    .eq('id', authUserId)
    .single();
  if (error) return null;
  return data;
}

export function SessionProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (USE_MOCKS) {
      const storedId = localStorage.getItem(STORAGE_KEY);
      const stored = storedId && users.find((u) => u.id === storedId);
      if (stored) {
        setSessionUserId(stored.id);
        setUser(stored);
        setStatus('authenticated');
      } else {
        setSessionUserId(null);
        setStatus('guest');
      }
      return;
    }

    let active = true;

    async function applySession(session) {
      if (!session?.user) {
        if (active) {
          setUser(null);
          setStatus('guest');
        }
        return;
      }
      const profile = await loadProfile(session.user.id);
      if (!active) return;
      if (!profile) {
        // A session exists but the users row isn't there yet — e.g. the
        // provisioning trigger hasn't run, or rejected a non-UTRGV
        // account. Treat as signed out rather than showing a broken UI.
        setUser(null);
        setStatus('guest');
        return;
      }
      setUser(profile);
      setStatus('authenticated');
    }

    supabase.auth.getSession().then(({ data: { session } }) => applySession(session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => applySession(session));

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  // Mock-only: pick any seeded account, used by the dev stub login form.
  function signIn(userId) {
    if (!USE_MOCKS) throw new Error('signIn(userId) is mock-only — use signInWithMicrosoft() instead');
    const u = users.find((x) => x.id === userId);
    if (!u) throw new Error('Unknown user');
    localStorage.setItem(STORAGE_KEY, u.id);
    setSessionUserId(u.id);
    setUser(u);
    setStatus('authenticated');
  }

  // Real sign-in: redirects to Microsoft, then back into the app. The
  // Supabase Azure provider + supabase/01_auth_provisioning.sql together
  // enforce @utrgv.edu-only accounts.
  async function signInWithMicrosoft() {
    if (USE_MOCKS) throw new Error('signInWithMicrosoft() requires VITE_USE_MOCKS=false');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/browse` },
    });
    if (error) throw error;
  }

  async function signOut() {
    if (USE_MOCKS) {
      localStorage.removeItem(STORAGE_KEY);
      setSessionUserId(null);
    } else {
      await supabase.auth.signOut();
    }
    setUser(null);
    setStatus('guest');
  }

  const value = useMemo(
    () => ({ status, user, signIn, signInWithMicrosoft, signOut }),
    [status, user]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
