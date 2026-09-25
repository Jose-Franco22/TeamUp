import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteTeam, getMyTeam, leaveTeam, removeMember } from '../api/client';
import { useSession } from '../auth/SessionContext';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import Avatar from '../components/Avatar';
import StatusPill from '../components/StatusPill';

export default function Team() {
  const { data, loading, error, reload } = useAsync(getMyTeam, []);
  const { user } = useSession();
  const navigate = useNavigate();
  // null | 'confirming' | 'deleting' | error message
  const [deleteState, setDeleteState] = useState(null);
  // null | 'confirming' | 'leaving' | error message
  const [leaveState, setLeaveState] = useState(null);
  // user_id -> 'confirming' | 'removing' | error message
  const [removeState, setRemoveState] = useState({});

  async function handleLeave() {
    setLeaveState('leaving');
    try {
      await leaveTeam();
      // You're off the roster, so there's no team page left to show.
      navigate('/browse', { replace: true });
    } catch (err) {
      setLeaveState(err.message);
    }
  }

  async function handleRemove(userId) {
    setRemoveState((r) => ({ ...r, [userId]: 'removing' }));
    try {
      await removeMember(userId);
      reload();
      setRemoveState((r) => ({ ...r, [userId]: undefined }));
    } catch (err) {
      setRemoveState((r) => ({ ...r, [userId]: err.message }));
    }
  }

  async function handleDelete() {
    setDeleteState('deleting');
    try {
      await deleteTeam(data.team_id);
      // The project is gone, so /team has nothing left to show. Browse is
      // where you'd go next anyway, now that you're free to join something.
      navigate('/browse', { replace: true });
    } catch (err) {
      setDeleteState(err.message);
    }
  }

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

  // Deleting is the owner's call alone, and only while nobody else has
  // joined — the same two rules delete_team() enforces server-side. The
  // creator is always seated on their own team by create_project, so "no
  // members" means "nobody but me," never a roster of zero.
  const isOwner = data.creator_id === user?.id;
  const isAlone = data.members.length <= 1;

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

        {isOwner && (
          <p className="hint">
            <Link to={`/projects/${data.id}/edit`}>Edit this project</Link> — description, team size
            target, or the roles you're recruiting for.
          </p>
        )}

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
          <div>{isOwner ? '' : 'Availability'}</div>
        </div>
        {data.members.map((m) => {
          const rm = removeState[m.user_id];
          // The owner can't remove themselves — that's deleting the team,
          // which has its own control below. remove_member() refuses it too.
          const canRemove = isOwner && m.user_id !== user?.id;
          return (
            <div className="row" key={m.user_id}>
              <Avatar name={m.name} size={34} />
              <div>
                <div className="nm">
                  {m.name}
                  {m.user_id === data.creator_id && <span className="tag owner">Owner</span>}
                </div>
                <div className="sub">{m.skills.join(', ') || 'No skills listed'}</div>
              </div>
              <div className="sub">{m.role || 'Not set'}</div>
              <div className="sub">
                {canRemove ? (
                  rm === 'confirming' ? (
                    <span className="acts">
                      <button
                        className="btn danger"
                        onClick={() => handleRemove(m.user_id)}
                      >
                        Remove {m.name.split(' ')[0]}
                      </button>
                      <button
                        className="btn quiet"
                        onClick={() => setRemoveState((r) => ({ ...r, [m.user_id]: undefined }))}
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <>
                      <button
                        className="btn quiet"
                        disabled={rm === 'removing'}
                        onClick={() => setRemoveState((r) => ({ ...r, [m.user_id]: 'confirming' }))}
                      >
                        {rm === 'removing' ? 'Removing…' : 'Remove'}
                      </button>
                      {rm && !['confirming', 'removing'].includes(rm) && (
                        <span className="inline-error" role="alert">{rm}</span>
                      )}
                    </>
                  )
                ) : (
                  `${m.availability_hours} hrs/wk`
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="note">
        Roles come from what each member was accepted for. Skills shown are their profile skills.
      </p>

      {!isOwner && (
        <section className="card danger-zone">
          <h2>Leave this team</h2>
          <p className="desc">
            Your seat opens back up right away so the team can recruit a replacement, and you'll be
            free to join or start something else. Let your team know yourself — the app won't tell
            them.
          </p>

          {leaveState === 'confirming' ? (
            <div className="foot">
              <span className="btn-label">Leave “{data.title}”?</span>
              <button className="btn danger" onClick={handleLeave}>
                Yes, leave
              </button>
              <button className="btn quiet" onClick={() => setLeaveState(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <div className="foot">
              <button
                className="btn danger"
                disabled={leaveState === 'leaving'}
                onClick={() => setLeaveState('confirming')}
              >
                {leaveState === 'leaving' ? 'Leaving…' : 'Leave team'}
              </button>
              {leaveState && !['confirming', 'leaving'].includes(leaveState) && (
                <span className="inline-error" role="alert">{leaveState}</span>
              )}
            </div>
          )}
        </section>
      )}

      {isOwner && (
        <section className="card danger-zone">
          <h2>Delete this team</h2>
          <p className="desc">
            {isAlone
              ? 'Removes the project, its open roles, and any requests people have sent it. This cannot be undone, and frees you up to create or join something else.'
              : "You can only delete this team while you're the only one on it. Someone has already joined, so the team stays."}
          </p>

          <div className="foot">
            {deleteState === 'confirming' ? (
              <>
                <span className="btn-label">Delete “{data.title}” permanently?</span>
                <button className="btn danger" onClick={handleDelete}>
                  Yes, delete it
                </button>
                <button className="btn quiet" onClick={() => setDeleteState(null)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="btn danger"
                disabled={!isAlone || deleteState === 'deleting'}
                onClick={() => setDeleteState('confirming')}
              >
                {deleteState === 'deleting' ? 'Deleting…' : 'Delete team'}
              </button>
            )}
            {deleteState && !['confirming', 'deleting'].includes(deleteState) && (
              <span className="inline-error" role="alert">
                {deleteState}
              </span>
            )}
          </div>
        </section>
      )}
    </>
  );
}
