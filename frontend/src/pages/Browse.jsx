import { useState } from 'react';
import { createJoinRequest, getCurrentUser, getProjects } from '../api/client';
import useAsync from '../components/useAsync';
import { ErrorState, Loading, Empty } from '../components/States';
import RolesNeeded from '../components/RolesNeeded';
import MemberStrip from '../components/MemberStrip';
import StatusPill from '../components/StatusPill';

export default function Browse() {
  const projectsState = useAsync(getProjects, []);
  const meState = useAsync(getCurrentUser, []);

  // project_id -> 'sending' | 'sent' | error message
  const [requests, setRequests] = useState({});
  const [onlyMatches, setOnlyMatches] = useState(false);

  const mySkillIds = (meState.data?.skills || []).map((s) => s.id);

  async function handleJoin(projectId) {
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

  return (
    <>
      <div className="head">
        <div>
          <h1>Open projects</h1>
          <p>
            {all.length} project{all.length === 1 ? '' : 's'} ·{' '}
            {all.filter((p) => p.roles_needed.some((r) => mySkillIds.includes(r.skill_id))).length} need a
            skill you listed
          </p>
        </div>
        <label className="switch">
          <input
            type="checkbox"
            checked={onlyMatches}
            onChange={(e) => setOnlyMatches(e.target.checked)}
          />
          Only show matches
        </label>
      </div>

      {visible.length === 0 ? (
        <Empty title="No projects match your skills yet.">
          <p>Add more skills to your profile, or clear the filter to see everything.</p>
        </Empty>
      ) : (
        <div className="grid2">
          {visible.map((p) => {
            const req = requests[p.id];
            const isFull = p.status === 'full' || p.member_count >= p.team_size_target;
            return (
              <article className="card" key={p.id}>
                <h2>
                  {p.title} <StatusPill status={p.status} />
                </h2>
                <p className="desc">{p.description}</p>

                <p className="lbl">Roles needed</p>
                <RolesNeeded roles={p.roles_needed} mySkillIds={mySkillIds} />

                <MemberStrip members={p.members} targetSize={p.team_size_target} />

                <div className="foot">
                  <button
                    className="btn"
                    disabled={isFull || req === 'sending' || req === 'sent'}
                    onClick={() => handleJoin(p.id)}
                  >
                    {req === 'sent' ? 'Request sent' : req === 'sending' ? 'Sending…' : 'Request to join'}
                  </button>
                  <span className="meta">
                    {p.member_count} of {p.team_size_target}
                    {p.avg_availability_hours > 0 && ` · ${p.avg_availability_hours} hrs/wk avg`}
                  </span>
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
