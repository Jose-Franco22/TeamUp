import { getMyTeam } from '../api/client';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import Avatar from '../components/Avatar';
import StatusPill from '../components/StatusPill';

export default function Team() {
  const { data, loading, error, reload } = useAsync(getMyTeam, []);

  if (loading) return <Loading label="Loading your team" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  if (!data) {
    return (
      <Empty title="You are not on a team yet.">
        <p>Once a project accepts your request, your roster shows up here.</p>
      </Empty>
    );
  }

  const totalHours = data.members.reduce((sum, m) => sum + (m.availability_hours || 0), 0);

  return (
    <>
      <div className="head">
        <div>
          <h1>Your team</h1>
          <p>
            {data.formed_at
              ? `Formed ${new Date(data.formed_at).toLocaleDateString()} · roster locked at ${data.team_size_target}`
              : `Still forming · ${data.member_count} of ${data.team_size_target}`}
          </p>
        </div>
      </div>

      <section className="card">
        <h2>
          {data.title} <StatusPill status={data.status} />
        </h2>
        <p className="desc">{data.description}</p>

        <div className="kv">
          <div>
            <b>Team size target</b>
            <span>{data.team_size_target}</span>
          </div>
          <div>
            <b>Members</b>
            <span>{data.member_count}</span>
          </div>
          <div>
            <b>Combined availability</b>
            <span>{totalHours} hrs/wk</span>
          </div>
          <div>
            <b>Created by</b>
            <span>{data.creator_name}</span>
          </div>
        </div>
      </section>

      <div className="rows">
        <div className="row hd">
          <div />
          <div>Member</div>
          <div>Role</div>
          <div>Availability</div>
        </div>
        {data.members.map((m) => (
          <div className="row" key={m.user_id}>
            <Avatar name={m.name} size={34} />
            <div>
              <div className="nm">{m.name}</div>
              <div className="sub">{m.skills.join(', ') || 'No skills listed'}</div>
            </div>
            <div className="sub">{m.role || 'Not set'}</div>
            <div className="sub">{m.availability_hours} hrs/wk</div>
          </div>
        ))}
      </div>
      <p className="note">
        Roles come from what each member was accepted for. Skills shown are their profile skills.
      </p>
    </>
  );
}
