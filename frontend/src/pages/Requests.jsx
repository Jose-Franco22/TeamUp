import { useState } from 'react';
import { getRequests, respondToRequest } from '../api/client';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import Avatar from '../components/Avatar';
import StatusPill from '../components/StatusPill';

export default function Requests() {
  const { data, loading, error, reload } = useAsync(getRequests, []);
  const [busy, setBusy] = useState({});

  async function respond(id, status) {
    setBusy((b) => ({ ...b, [id]: status }));
    try {
      await respondToRequest(id, status);
      reload();
    } catch (err) {
      setBusy((b) => ({ ...b, [id]: err.message }));
    }
  }

  if (loading) return <Loading label="Loading requests" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const { incoming = [], outgoing = [] } = data || {};

  return (
    <>
      <div className="head">
        <div>
          <h1>Requests</h1>
          <p>People asking to join your project, and requests you have sent</p>
        </div>
      </div>

      <h2 className="section">Incoming</h2>
      {incoming.length === 0 ? (
        <Empty title="No one has asked to join your projects yet.">
          <p>Requests appear here as soon as someone sends one.</p>
        </Empty>
      ) : (
        <div className="rows">
          <div className="row hd">
            <div />
            <div>Student</div>
            <div>Availability</div>
            <div>Decision</div>
          </div>
          {incoming.map((r) => (
            <div className="row" key={r.id}>
              <Avatar name={r.user_name} size={34} />
              <div>
                <div className="nm">{r.user_name}</div>
                <div className="sub">{r.skills.join(', ') || 'No skills listed'}</div>
              </div>
              <div className="sub">{r.availability_hours} hrs/wk</div>
              <div className="acts">
                <button
                  className="btn"
                  disabled={!!busy[r.id]}
                  onClick={() => respond(r.id, 'accepted')}
                >
                  Accept
                </button>
                <button
                  className="btn quiet"
                  disabled={!!busy[r.id]}
                  onClick={() => respond(r.id, 'declined')}
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 className="section">Sent by you</h2>
      {outgoing.length === 0 ? (
        <Empty title="You have not asked to join anything yet.">
          <p>Browse open projects to send your first request.</p>
        </Empty>
      ) : (
        <div className="rows">
          <div className="row hd">
            <div />
            <div>Project</div>
            <div>Sent</div>
            <div>Status</div>
          </div>
          {outgoing.map((r) => (
            <div className="row" key={r.id}>
              <Avatar name={r.project_title} size={34} />
              <div>
                <div className="nm">{r.project_title}</div>
                <div className="sub">
                  {r.creator_name} · {r.member_count} of {r.team_size_target} filled
                </div>
              </div>
              <div className="sub">{formatWhen(r.created_at)}</div>
              <div>
                <StatusPill status={r.status} />
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="note">
        A project stops accepting requests once its roster reaches the target team size.
      </p>
    </>
  );
}

function formatWhen(iso) {
  if (!iso) return '';
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}
