import Avatar from './Avatar';

// Current roster plus placeholder seats up to team_size_target.
export default function MemberStrip({ members, targetSize }) {
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
