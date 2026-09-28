import { useState } from 'react';
import { getRequests, getRoles, respondToRequest } from '../api/client';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import Avatar from '../components/Avatar';
import StatusPill from '../components/StatusPill';

// Default role for an incoming request: whichever listed role has a skill
// pinned to it that the applicant actually claims, otherwise the first role
// the project listed. Returns a roles.id — team_members.role_id is a
// foreign key now, not the free-text skill name this used to hand back.
//
// "Roles needed" is optional on a project, so there may be nothing to
// default to. Falling back to the first role in the taxonomy (rather than
// '') is what keeps a project that listed no roles from being unable to
// accept anyone at all — the select below offers every role for the same
// reason, since what a project listed is a wishlist, not a constraint on
// who the creator is allowed to seat.
function defaultRoleFor(r, allRoles) {
  const needed = r.roles_needed || [];
  if (needed.length > 0) {
    const match = needed.find((role) => role.skill_name && r.skills.includes(role.skill_name));
    return (match || needed[0]).role_id;
  }
  return allRoles[0]?.id ?? '';
}

export default function Requests() {
  const { data, loading, error, reload } = useAsync(getRequests, []);
  const rolesState = useAsync(getRoles, []);
  const [busy, setBusy] = useState({});
  const [roleChoices, setRoleChoices] = useState({});

  async function respond(id, status, role) {
    setBusy((b) => ({ ...b, [id]: status }));
    try {
      await respondToRequest(id, status, role);
      reload();
    } catch (err) {
      setBusy((b) => ({ ...b, [id]: err.message }));
    }
  }

  if (loading || rolesState.loading) return <Loading label="Loading requests" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (rolesState.error) return <ErrorState error={rolesState.error} onRetry={rolesState.reload} />;

  const { incoming = [], outgoing = [] } = data || {};
  const allRoles = rolesState.data || [];

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
          {incoming.map((r) => {
            const needed = r.roles_needed || [];
            const role = roleChoices[r.id] ?? defaultRoleFor(r, allRoles);
            return (
              <div className="row" key={r.id}>
                <Avatar name={r.user_name} size={34} />
                <div>
                  <div className="nm">{r.user_name}</div>
                  <div className="sub">{r.skills.join(', ') || 'No skills listed'}</div>
                </div>
                <div className="sub">{r.availability_hours} hrs/wk</div>
                <div className="decision">
                  <select
                    className="role-select"
                    aria-label={`Role for ${r.user_name}`}
                    value={role}
                    disabled={!!busy[r.id]}
                    onChange={(e) => setRoleChoices((c) => ({ ...c, [r.id]: e.target.value }))}
                  >
                    {needed.length > 0 && (
                      <optgroup label="Roles you listed">
                        {needed.map((rn) => (
                          <option key={rn.role_id} value={rn.role_id}>
                            {rn.role_name}
                            {rn.skill_name ? ` · ${rn.skill_name}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label={needed.length > 0 ? 'Other roles' : 'Roles'}>
                      {allRoles
                        .filter((ar) => !needed.some((rn) => rn.role_id === ar.id))
                        .map((ar) => (
                          <option key={ar.id} value={ar.id}>
                            {ar.name}
                          </option>
                        ))}
                    </optgroup>
                  </select>
                  <div className="acts">
                    <button
                      className="btn"
                      disabled={!!busy[r.id] || !role}
                      onClick={() => respond(r.id, 'accepted', role)}
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
              </div>
            );
          })}
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
