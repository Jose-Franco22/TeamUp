import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { users } from '../api/mockData';
import { setSessionUserId } from '../api/client';
import { supabase } from '../lib/supabaseClient';

// Session state lives here; client.js and page components never touch
// supabase-js or the mock user list directly.

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';
const STORAGE_KEY = 'teamup.mockSessionUserId';
const MOCK_ONBOARDED_KEY = 'teamup.mockOnboarded';

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

// Read separately from loadProfile so a database that hasn't run
// supabase/11_onboarding.sql yet still signs people in — they just see the
// walkthrough again.
async function loadOnboarded(authUserId) {
  const { data, error } = await supabase
    .from('users')
    .select('onboarded_at')
    .eq('id', authUserId)
    .single();
  return !error && Boolean(data?.onboarded_at);
}

function mockOnboardedIds() {
  try {
    return JSON.parse(localStorage.getItem(MOCK_ONBOARDED_KEY)) || [];
  } catch {
    return [];
  }
}

export function SessionProvider({ children }) {
  const [status, setStatus] = useState('loading');
  const [user, setUser] = useState(null);
  // Whether this user has been through the first-sign-in walkthrough.
  const [onboarded, setOnboarded] = useState(true);

  useEffect(() => {
    if (USE_MOCKS) {
      const storedId = localStorage.getItem(STORAGE_KEY);
      const stored = storedId && users.find((u) => u.id === storedId);
      if (stored) {
        setSessionUserId(stored.id);
        setUser(stored);
        setOnboarded(mockOnboardedIds().includes(stored.id));
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
      const [profile, done] = await Promise.all([
        loadProfile(session.user.id),
        loadOnboarded(session.user.id),
      ]);
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
      setOnboarded(done);
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
    setOnboarded(mockOnboardedIds().includes(u.id));
    setStatus('authenticated');
  }

  // Real sign-in: redirects to Microsoft, then back into the app. The
  // Supabase Azure provider + supabase/01_auth_provisioning.sql together
  // enforce @utrgv.edu-only accounts. Lands on /login so an OAuth error is
  // still in the URL for Login to show; a successful sign-in is sent on to
  // /browse from there.
  async function signInWithMicrosoft() {
    if (USE_MOCKS) throw new Error('signInWithMicrosoft() requires VITE_USE_MOCKS=false');
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'azure',
      options: { redirectTo: `${window.location.origin}/login` },
    });
    if (error) throw error;
  }

  // Marks the walkthrough done. The local flag flips first so the dialog
  // closes immediately; if the write fails the tour just shows again on the
  // next visit, which is better than trapping the student in it now.
  async function completeOnboarding() {
    setOnboarded(true);
    if (USE_MOCKS) {
      const ids = mockOnboardedIds();
      if (!ids.includes(user.id)) localStorage.setItem(MOCK_ONBOARDED_KEY, JSON.stringify([...ids, user.id]));
      return;
    }
    await supabase.from('users').update({ onboarded_at: new Date().toISOString() }).eq('id', user.id);
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
    () => ({ status, user, onboarded, signIn, signInWithMicrosoft, signOut, completeOnboarding }),
    [status, user, onboarded]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within a SessionProvider');
  return ctx;
}
