import { Link } from 'react-router-dom';
import Avatar from './Avatar';

// Current roster plus placeholder seats up to team_size_target. Roster
// identities are available to teammates and admins; everyone else gets
// aggregate seat counts. memberCount stays accurate when members is empty
// because RLS hid the identities (16_admin_access.sql).
export default function MemberStrip({
  members,
  targetSize,
  memberCount = members.length,
  isAuthenticated = true,
}) {
  if (!isAuthenticated) {
    return (
      <div className="members guest">
        <span className="seat-count">
          {memberCount} of {targetSize} seats filled
        </span>
        <Link className="guest-note" to="/login">
          Sign in to find a team
        </Link>
      </div>
    );
  }

  const empty = Math.max(0, targetSize - memberCount);

  return (
    <div className="members">
      {memberCount > members.length && (
        <span className="seat-count">{memberCount} of {targetSize} seats filled</span>
      )}
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
