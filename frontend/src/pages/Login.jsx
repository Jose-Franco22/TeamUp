import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '../auth/SessionContext';
import { teamMembers, users } from '../api/mockData';
import { Loading } from '../components/States';

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false';

// Supabase redirects OAuth failures (e.g. the provisioning trigger
// rejecting a non-@utrgv.edu account) back to redirectTo with error info
// either in the query string or the URL hash, depending on flow.
function readOAuthError() {
  const params = new URLSearchParams(
    (window.location.hash || '').replace(/^#/, '') || window.location.search
  );
  const description = params.get('error_description');
  return description ? description.replace(/\+/g, ' ') : null;
}

function MicrosoftLogin() {
  const { signInWithMicrosoft } = useSession();
  const [error, setError] = useState(readOAuthError);
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setError(null);
    setPending(true);
    try {
      await signInWithMicrosoft();
      // Browser navigates away to Microsoft; nothing else to do here.
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <section className="card auth-card">
      <h2>Sign in to get started</h2>
      <p className="desc">
        TeamUp is only open to UTRGV students — sign in with your @utrgv.edu Microsoft account.
      </p>
      {error && <p className="inline-error">{error}</p>}
      <div className="foot">
        <button type="button" className="btn" onClick={handleClick} disabled={pending}>
          {pending ? 'Redirecting…' : 'Sign in with Microsoft'}
        </button>
      </div>
    </section>
  );
}

// Dev-only stand-in for the real sign-in form above. Picks any seeded user
// so both sides of a request (project creator vs. applicant) are easy to
// test without a real Microsoft account.
//
// Each option says whether that account is already on a team, because a
// student is only ever on one: signing in as someone already seated gets
// you a disabled "Already on a team" button on every project, which reads
// as a broken app rather than as the rule working. Computed at render, so
// it reflects teams created during this session too.
function MockLogin() {
  const { signIn } = useSession();
  const [selected, setSelected] = useState(users[0].id);

  const onATeam = (id) => teamMembers.some((tm) => tm.user_id === id);
  const free = users.filter((u) => !onATeam(u.id));
  const seated = users.filter((u) => onATeam(u.id));

  function handleSubmit(e) {
    e.preventDefault();
    // Login re-renders as signed in and redirects from there.
    signIn(selected);
  }

  return (
    <section className="card auth-card">
      <h2>Sign in to get started</h2>
      <p className="desc">
        Stub login for development — pick a mock account. This gets replaced by real sign-in
        before launch.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="user">Account</label>
          <select id="user" value={selected} onChange={(e) => setSelected(e.target.value)}>
            <optgroup label="Not on a team — can request to join">
              {free.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </optgroup>
            <optgroup label="Already on a team">
              {seated.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
            </optgroup>
          </select>
        </div>

        <div className="foot">
          <button type="submit" className="btn">
            Continue
          </button>
        </div>
      </form>
    </section>
  );
}

// The only page a guest can reach — every other route redirects here — so it
// also has to explain what TeamUp is.
export default function Login() {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') return <Loading label="Checking session" />;
  if (status === 'authenticated') {
    return <Navigate to={location.state?.from?.pathname || '/browse'} replace />;
  }

  return (
    <>
      <div className="login">
        <section className="hero">
          <h1>Find a senior project team by skill, not by who you already know.</h1>
          <p>
            CSCI 4390 teams usually form through whoever's already in your group chat — not
            whoever actually has the skills the project needs. TeamUp lists what every project is
            building, what roles are still open, and lets you request to join the ones that match
            what you can bring.
          </p>
        </section>
        {USE_MOCKS ? <MockLogin /> : <MicrosoftLogin />}
      </div>

      <section>
        <h2 className="section">About</h2>
        <div className="card about">
          {/* TODO: replace with real copy — the actual story (how the four
              of us ended up forming this team through CSCI 4390 group
              chats and existing friend groups, which is exactly the
              coordination problem TeamUp is meant to fix) should go here
              instead of this placeholder. Do this before showing the site
              to Erik or anyone else. */}
          <p>
            TeamUp is a senior project for CSCI 4390 at UTRGV, built by Adan Barrera, Nicolas
            Guerra, Jose Franco Garza, and Alexis Covarrubias, advised by Erik Enriquez. We built
            it because forming a project team usually comes down to who you already know, not who
            actually fits the project — and we wanted a way to match on skills instead.
          </p>
          <div className="about-people">
            <div>
              <b>Team</b>
              <span>Adan Barrera · Nicolas Guerra · Jose Franco Garza · Alexis Covarrubias</span>
            </div>
            <div>
              <b>Adviser</b>
              <span>Erik Enriquez</span>
            </div>
            <div>
              <b>Course</b>
              <span>CSCI 4390, UTRGV</span>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
