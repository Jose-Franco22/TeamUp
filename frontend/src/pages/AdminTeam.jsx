import { Link, useParams } from 'react-router-dom';
import { getAdminTeam } from '../api/client';
import useAsync from '../components/useAsync';
import { ErrorState, Loading } from '../components/States';
import RolesNeeded from '../components/RolesNeeded';
import StatusPill from '../components/StatusPill';

export default function AdminTeam() {
  const { teamId } = useParams();
  const { data, loading, error, reload } = useAsync(() => getAdminTeam(teamId), [teamId]);

  return (
    <>
      <p><Link to="/admin">Back to dashboard</Link></p>
      {loading ? <Loading label="Loading team details" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <>
          <div className="head">
            <div>
              <h1>{data.title}</h1>
              <p>{data.member_count} of {data.team_size_target} seats filled <StatusPill status={data.status} /></p>
            </div>
          </div>
          <section className="card">
            <h2>Project details</h2>
            <p className="desc admin-text">{data.description || 'No description provided.'}</p>
            <p className="desc">Created by <Link to={`/admin/students/${data.creator_id}`}>{data.creator_name}</Link></p>
            <p className="lbl">Open roles</p>
            <RolesNeeded roles={data.roles_needed} />
          </section>

          <section className="card">
            <h2>Team members</h2>
            {data.members.length === 0 ? <p className="desc">No members yet.</p> : (
              <ul className="admin-list">
                {data.members.map((m) => (
                  <li key={m.user_id}>
                    <Link to={`/admin/students/${m.user_id}`}>{m.name}</Link>
                    {m.user_id === data.creator_id && <span className="tag owner">Owner</span>}
                    <span className="admin-secondary">{m.role_name || 'Role not set'} · {m.availability_hours} hrs/wk</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card">
            <h2>Pending requests</h2>
            {data.pending_requests.length === 0 ? <p className="desc">No pending requests.</p> : (
              <ul className="admin-list">
                {data.pending_requests.map((r) => (
                  <li key={r.id}><Link to={`/admin/students/${r.user_id}`}>{r.user_name}</Link></li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
