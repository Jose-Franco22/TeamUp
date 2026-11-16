import { Link, useParams } from 'react-router-dom';
import { getAdminStudent } from '../api/client';
import useAsync from '../components/useAsync';
import { ErrorState, Loading } from '../components/States';
import PlacementPanel from '../components/PlacementPanel';
import { PendingProjectLinks } from './Admin';

export default function AdminStudent() {
  const { studentId } = useParams();
  const { data, loading, error, reload, setData } = useAsync(() => getAdminStudent(studentId), [studentId]);

  // Refetch in place after a placement change, so the page doesn't flash
  // back to its loading state and lose the confirmation message.
  async function refresh() {
    setData(await getAdminStudent(studentId));
  }

  return (
    <>
      <p><Link to="/admin">Back to dashboard</Link></p>
      {loading ? <Loading label="Loading student details" /> : error ? <ErrorState error={error} onRetry={reload} /> : (
        <>
          <div className="head"><div><h1>{data.name}</h1><p>{data.email}</p></div></div>
          <section className="card">
            <h2>Student profile</h2>
            <p className="desc admin-text">{data.bio || 'No bio provided.'}</p>
            <div className="kv">
              <div><b>Availability</b><span>{data.availability_hours} hrs/wk</span></div>
              <div><b>GitHub</b><span>{data.github_url
                ? <a href={data.github_url} target="_blank" rel="noreferrer">GitHub profile</a>
                : 'Not provided'}</span></div>
            </div>
            <p className="lbl">Skills</p>
            {data.skills.length === 0 ? <p className="desc">No skills listed.</p> : (
              <div className="tags">{data.skills.map((s) => <span className="tag" key={s.id}>{s.name}</span>)}</div>
            )}
          </section>

          <section className="card">
            <h2>Team placement</h2>
            {data.membership ? (
              <p className="desc">
                <Link to={`/admin/teams/${data.membership.team_id}`}>{data.membership.project_title}</Link>
                <span className="admin-secondary">{data.membership.role_name || 'Role not set'}</span>
              </p>
            ) : <p className="desc">Not on a team.</p>}
            <PlacementPanel student={data} onChanged={refresh} />
          </section>

          <section className="card">
            <h2>Pending requests</h2>
            <PendingProjectLinks requests={data.pending_requests} />
          </section>
        </>
      )}
    </>
  );
}
