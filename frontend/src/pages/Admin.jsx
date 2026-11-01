import { Link } from 'react-router-dom';
import { getAdminActions, getAdminDashboard } from '../api/client';
import { formatDue } from '../components/Milestones';
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

const ACTION_TEXT = {
  assign: (a) => `placed ${a.student_name ?? 'a student'} on “${a.to_project_title}”`,
  move: (a) => `moved ${a.student_name ?? 'a student'} from “${a.from_project_title}” to “${a.to_project_title}”`,
  remove: (a) => `took ${a.student_name ?? 'a student'} off “${a.from_project_title}”`,
};

// Every admin placement change (issue #39), newest first.
export function RecentChanges() {
  const { data, loading, error, reload } = useAsync(() => getAdminActions(20), []);
  return (
    <section aria-labelledby="changes-heading">
      <h2 className="section" id="changes-heading">Recent admin changes</h2>
      {loading ? <Loading label="Loading changes" /> : error ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty title="No admin changes yet."><p>Assignments, moves and removals show up here.</p></Empty>
      ) : (
        <div className="card">
          <ul className="admin-list" aria-label="Recent admin changes">
            {data.map((a) => (
              <li key={a.id}>
                {a.admin_name ?? 'An admin'} {ACTION_TEXT[a.action]?.(a) ?? a.action}
                {a.role_name && a.action !== 'remove' ? ` as ${a.role_name}` : ''}
                <span className="admin-secondary">{formatDue(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
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

      <RecentChanges />
    </>
  );
}
