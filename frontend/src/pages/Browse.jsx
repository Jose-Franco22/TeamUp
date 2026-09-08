import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createJoinRequest, getCurrentUser, getProjects } from '../api/client';
import { useSession } from '../auth/SessionContext';
import useAsync from '../components/useAsync';
import { ErrorState, Loading, Empty } from '../components/States';
import RolesNeeded from '../components/RolesNeeded';
import MemberStrip from '../components/MemberStrip';
import StatusPill from '../components/StatusPill';

export default function Browse() {
  const { status, user } = useSession();
  const isAuthenticated = status === 'authenticated';
  const navigate = useNavigate();

  const projectsState = useAsync(getProjects, []);
  const meState = useAsync(
    () => (isAuthenticated ? getCurrentUser() : Promise.resolve(null)),
    [isAuthenticated]
  );

  // project_id -> 'sending' | 'sent' | error message
  const [requests, setRequests] = useState({});
  const [onlyMatches, setOnlyMatches] = useState(false);

  const mySkillIds = (meState.data?.skills || []).map((s) => s.id);

  async function handleJoin(projectId) {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: '/browse' } } });
      return;
    }
    setRequests((r) => ({ ...r, [projectId]: 'sending' }));
    try {
      await createJoinRequest(projectId);
      setRequests((r) => ({ ...r, [projectId]: 'sent' }));
    } catch (err) {
      setRequests((r) => ({ ...r, [projectId]: err.message }));
    }
  }

  if (projectsState.loading) return <Loading label="Loading projects" />;
  if (projectsState.error) {
    return <ErrorState error={projectsState.error} onRetry={projectsState.reload} />;
  }

  const all = projectsState.data || [];
  const visible = onlyMatches
    ? all.filter((p) => p.roles_needed.some((r) => mySkillIds.includes(r.skill_id)))
    : all;

  // A student can only be on one team. This is true across every project
  // in `all`, not just the one being rendered, so it's computed once here
  // rather than per-card.
  const onAnyTeam =
    isAuthenticated && all.some((p) => p.members.some((m) => m.user_id === user.id));

  return (
    <>
      <div className="head">
        <div>
          <h1>Open projects</h1>
          <p>
            {all.length} project{all.length === 1 ? '' : 's'}
            {isAuthenticated &&
              ` · ${all.filter((p) => p.roles_needed.some((r) => mySkillIds.includes(r.skill_id))).length} need a skill you listed`}
          </p>
        </div>
        {isAuthenticated && (
          <label className="switch">
            <input
              type="checkbox"
              checked={onlyMatches}
              onChange={(e) => setOnlyMatches(e.target.checked)}
            />
            Only show matches
          </label>
        )}
      </div>

      {visible.length === 0 ? (
        <Empty title="No projects match your skills yet.">
          <p>Add more skills to your profile, or clear the filter to see everything.</p>
        </Empty>
      ) : (
        <div className="grid2">
          {visible.map((p) => {
            const req = requests[p.id];
            const isCreator = isAuthenticated && p.creator_id === user.id;
            const isMember = isAuthenticated && p.members.some((m) => m.user_id === user.id);
            const isPending = isAuthenticated && (req === 'sent' || p.viewer_request_status === 'pending');
            const isFull = p.status === 'full' || p.member_count >= p.team_size_target;
            return (
              <article className="card" key={p.id}>
                <h2>
                  {p.title} <StatusPill status={p.status} />
                </h2>
                <p className="desc">{p.description}</p>

                <p className="lbl">Roles needed</p>
                <RolesNeeded roles={p.roles_needed} mySkillIds={mySkillIds} />

                <MemberStrip
                  members={p.members}
                  targetSize={p.team_size_target}
                  isAuthenticated={isAuthenticated}
                />

                <div className="foot">
                  {!isAuthenticated ? (
                    <button className="btn" onClick={() => handleJoin(p.id)}>
                      Sign in to request
                    </button>
                  ) : isCreator ? (
                    <span className="btn-label">Your project</span>
                  ) : isMember ? (
                    <button className="btn" disabled>
                      You're on this team
                    </button>
                  ) : onAnyTeam ? (
                    <button className="btn" disabled>
                      Already on a team
                    </button>
                  ) : isPending ? (
                    <button className="btn" disabled>
                      Request pending
                    </button>
                  ) : (
                    <button
                      className="btn"
                      disabled={isFull || req === 'sending'}
                      onClick={() => handleJoin(p.id)}
                    >
                      {req === 'sending' ? 'Sending…' : 'Request to join'}
                    </button>
                  )}
                  {isAuthenticated && (
                    <span className="meta">
                      {p.member_count} of {p.team_size_target}
                      {p.avg_availability_hours > 0 && ` · ${p.avg_availability_hours} hrs/wk avg`}
                    </span>
                  )}
                </div>
                {req && req !== 'sending' && req !== 'sent' && (
                  <p className="inline-error" role="alert">{req}</p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
