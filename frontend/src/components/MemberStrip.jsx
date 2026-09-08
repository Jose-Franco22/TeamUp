import { Link } from 'react-router-dom';
import Avatar from './Avatar';

// Current roster plus placeholder seats up to team_size_target. Guests only
// get the seat count — member identities require signing in. This is a UX
// nicety, not a security boundary: the real API must not send member names
// to unauthenticated requests in the first place (see TODO-backend.md).
export default function MemberStrip({ members, targetSize, isAuthenticated = true }) {
  if (!isAuthenticated) {
    return (
      <div className="members guest">
        <span className="seat-count">
          {members.length} of {targetSize} seats filled
        </span>
        <Link className="guest-note" to="/login">
          Sign in to see who's on this team
        </Link>
      </div>
    );
  }

  const empty = Math.max(0, targetSize - members.length);

  return (
    <div className="members">
      {members.map((m) => (
        <div className="mem" key={m.user_id}>
          <Avatar name={m.name} size={34} />
          <p>
            {m.name}
            <small>{m.role || 'Role not set'}</small>
          </p>
        </div>
      ))}
      {Array.from({ length: empty }).map((_, i) => (
        <div className="mem" key={`empty-${i}`}>
          <span className="avatar empty" aria-hidden="true">+</span>
          <p className="dim">
            Open seat
            <small>Unfilled</small>
          </p>
        </div>
      ))}
    </div>
  );
}
