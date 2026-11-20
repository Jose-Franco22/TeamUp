import { useState } from 'react';
import { getAdvisedProjects, stepDownAsAdviser } from '../api/client';
import useAsync from './useAsync';
import Avatar from './Avatar';
import StatusPill from './StatusPill';

// The teams you advise, on the team page (issue #54).
//
// Read-only, and that is the whole point of it: "I can view the team page and
// its members but can't edit the project, accept join requests or manage
// members". There is no control here but stepping down, and the database
// refuses the rest anyway — update_project(), respond_to_join_request(),
// remove_member() and set_member_role() all check the creator, with a case
// each in supabase/tests/adviser_responses.test.sql.
//
// This sits beside "Your team" rather than replacing it, because advising is
// not membership: somebody can advise two projects and be on a team of their
// own, and the page has to show both without implying either is the other.
export default function AdvisedTeams() {
  const { data, loading, error, setData } = useAsync(getAdvisedProjects, []);
  // project id -> 'confirming' | 'leaving' | an error message
  const [state, setState] = useState({});

  async function stepDown(projectId) {
    setState((s) => ({ ...s, [projectId]: 'leaving' }));
    try {
      await stepDownAsAdviser(projectId);
      setData((list) => list.filter((p) => p.id !== projectId));
      setState((s) => ({ ...s, [projectId]: undefined }));
    } catch (err) {
      setState((s) => ({ ...s, [projectId]: err.message || 'Something went wrong.' }));
    }
  }

  // One section of somebody else's page: a failure here shows nothing rather
  // than taking the roster above it down.
  if (loading || error) return null;
  const projects = data || [];
  if (projects.length === 0) return null;

  return (
    <>
      <h2 className="section">Teams you advise</h2>
      {projects.map((p) => {
        const s = state[p.id];
        return (
          <section className="card" key={p.id} aria-label={`Advising ${p.title}`}>
            <h3>
              {p.title} <StatusPill status={p.status} />
            </h3>
            <p className="desc">{p.description}</p>

            <div className="kv">
              <div>
                <b>Members</b>
                <span>
                  {p.member_count} of {p.team_size_target}
                </span>
              </div>
              <div>
                <b>Created by</b>
                <span>{p.creator_name}</span>
              </div>
            </div>

            {p.members.length > 0 && (
              <div className="rows">
                {p.members.map((m) => (
                  <div className="row adviser" key={m.user_id}>
                    <Avatar name={m.name} size={30} />
                    <div>
                      <div className="nm">
                        {m.name}
                        {m.user_id === p.creator_id && <span className="tag owner">Owner</span>}
                      </div>
                      <div className="sub">{m.role || 'Not set'}</div>
                    </div>
                    <div />
                  </div>
                ))}
              </div>
            )}

            <p className="hint">
              You advise this project. You are not on its roster and hold no seat on it, so you
              cannot edit it, answer join requests or change who is on the team.
            </p>

            <div className="foot">
              {s === 'confirming' ? (
                <span className="acts">
                  <span className="sub">
                    Stop advising “{p.title}”? The owner is told, and can invite someone else.
                  </span>
                  <button className="btn danger" onClick={() => stepDown(p.id)}>
                    Yes, step down
                  </button>
                  <button
                    className="btn quiet"
                    onClick={() => setState((x) => ({ ...x, [p.id]: undefined }))}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  className="btn quiet"
                  disabled={s === 'leaving'}
                  onClick={() => setState((x) => ({ ...x, [p.id]: 'confirming' }))}
                >
                  {s === 'leaving' ? 'Stepping down…' : 'Step down as adviser'}
                </button>
              )}
              {s && s !== 'confirming' && s !== 'leaving' && (
                <span className="inline-error" role="alert">{s}</span>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
