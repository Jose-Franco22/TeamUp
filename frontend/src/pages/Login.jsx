import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/SessionContext';
import { teamMembers, users } from '../api/mockData';

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
    <div className="auth-wrap">
      <section className="card auth-card">
        <h1>Sign in</h1>
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
    </div>
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
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState(users[0].id);

  const onATeam = (id) => teamMembers.some((tm) => tm.user_id === id);
  const free = users.filter((u) => !onATeam(u.id));
  const seated = users.filter((u) => onATeam(u.id));

  function handleSubmit(e) {
    e.preventDefault();
    signIn(selected);
    const from = location.state?.from?.pathname || '/browse';
    navigate(from, { replace: true });
  }

  return (
    <div className="auth-wrap">
      <section className="card auth-card">
        <h1>Sign in</h1>
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
    </div>
  );
}

export default function Login() {
  return USE_MOCKS ? <MockLogin /> : <MicrosoftLogin />;
}
