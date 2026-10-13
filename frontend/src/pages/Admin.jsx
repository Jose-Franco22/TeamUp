import { Link } from 'react-router-dom';
import { getAdminDashboard } from '../api/client';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import StatusPill from '../components/StatusPill';

export function PendingProjectLinks({ requests }) {
  if (requests.length === 0) return <span className="desc">No pending requests</span>;
  return (
    <ul className="admin-list">
      {requests.map((r) => (
        <li key={r.id}>
          {r.team_id ? <Link to={`/admin/teams/${r.team_id}`}>{r.project_title}</Link> : r.project_title}
        </li>
      ))}
    </ul>
  );
}

export default function Admin() {
  const { data, loading, error, reload } = useAsync(getAdminDashboard, []);

  if (loading) return <Loading label="Loading team formation" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <>
      <div className="head">
        <div>
          <h1>Administration</h1>
          <p>Track team formation and find students who still need a team.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <dl className="admin-summary" aria-label="Formation summary">
        <div><dt>Teams formed</dt><dd>{data.summary.formed_teams}</dd></div>
        <div><dt>Teams still open</dt><dd>{data.summary.open_teams}</dd></div>
        <div><dt>Students unplaced</dt><dd>{data.summary.unplaced_students}</dd></div>
      </dl>

      <section aria-labelledby="all-teams-heading">
        <h2 className="section" id="all-teams-heading">All teams</h2>
        {data.teams.length === 0 ? (
          <Empty title="No teams yet."><p>Teams will appear when students post projects.</p></Empty>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" aria-labelledby="all-teams-heading">
              <thead><tr><th scope="col">Team</th><th scope="col">Members and roles</th><th scope="col">Seats filled</th><th scope="col">Status</th></tr></thead>
              <tbody>
                {data.teams.map((t) => (
                  <tr key={t.id}>
                    <th scope="row"><Link to={`/admin/teams/${t.id}`}>{t.title}</Link></th>
                    <td>
                      {t.members.length === 0 ? 'No members yet' : (
                        <ul className="admin-list">
                          {t.members.map((m) => (
                            <li key={m.user_id}>
                              <Link to={`/admin/students/${m.user_id}`}>{m.name}</Link>
                              <span className="admin-secondary">{m.role_name || 'Role not set'}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td>{t.member_count} of {t.team_size_target}</td>
                    <td><StatusPill status={t.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="unplaced-heading">
        <h2 className="section" id="unplaced-heading">Unplaced students</h2>
        {data.unplaced_students.length === 0 ? (
          <Empty title="No unplaced students."><p>Every registered student has a team, or no students have signed in yet.</p></Empty>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table" aria-labelledby="unplaced-heading">
              <thead><tr><th scope="col">Student</th><th scope="col">Pending requests</th></tr></thead>
              <tbody>
                {data.unplaced_students.map((s) => (
                  <tr key={s.id}>
                    <th scope="row">
                      <Link to={`/admin/students/${s.id}`}>{s.name}</Link>
                      <span className="admin-secondary">{s.email}</span>
                    </th>
                    <td><PendingProjectLinks requests={s.pending_requests} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
