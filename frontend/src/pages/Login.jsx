import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../auth/SessionContext';
import { users } from '../api/mockData';

// Dev-only stand-in for a real sign-in form. Picks any seeded user so both
// sides of a request (project creator vs. applicant) are easy to test.
// This whole file gets replaced by a Supabase Auth form later — nothing
// else in the app depends on how sign-in itself is implemented.
export default function Login() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [selected, setSelected] = useState(users[0].id);

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
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} — {u.email}
                </option>
              ))}
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
