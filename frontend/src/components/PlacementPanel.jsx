import { useEffect, useState } from 'react';
import { adminAssignStudent, adminMoveStudent, getAdminDashboard, getRoles, removeMember } from '../api/client';

// An admin places a student (issue #39): assign an unplaced student to a
// team with an open seat, move a placed one to another, or take them off.
// Works after the formation deadline. The database re-checks every rule —
// admin_assign_student(), admin_move_student(), remove_member() in
// supabase/27_admin_placement.sql — this only saves a round trip.
//
// `student` is admin_student_details(); `onChanged` refetches it.
export default function PlacementPanel({ student, onChanged }) {
  const [teams, setTeams] = useState(null);
  const [roles, setRoles] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [teamId, setTeamId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [result, setResult] = useState(null); // { ok: boolean, text }

  async function loadTeams() {
    const dashboard = await getAdminDashboard();
    setTeams(dashboard.teams);
  }

  useEffect(() => {
    let live = true;
    Promise.all([getAdminDashboard(), getRoles()])
      .then(([dashboard, roleList]) => {
        if (!live) return;
        setTeams(dashboard.teams);
        setRoles(roleList);
      })
      .catch((err) => live && setLoadError(err));
    return () => {
      live = false;
    };
  }, []);

  const membership = student.membership;
  const currentTeam = membership && teams?.find((t) => t.id === membership.team_id);
  const isCreator = Boolean(currentTeam && currentTeam.creator_id === student.id);

  // Only teams with a seat free, and never the one they're already on.
  const openTeams = (teams || []).filter(
    (t) => t.member_count < t.team_size_target && t.id !== membership?.team_id
  );

  // Default the role to the first one the chosen team is still recruiting.
  function pickTeam(id) {
    setTeamId(id);
    setResult(null);
    const team = teams.find((t) => t.id === id);
    const listed = team?.roles_needed?.find((r) => r.quantity_needed > 0);
    if (listed) setRoleId(listed.role_id);
  }

  async function run(action, success) {
    setBusy(true);
    setResult(null);
    try {
      await action();
      setResult({ ok: true, text: success });
      setTeamId('');
      setRoleId('');
      setConfirmingRemove(false);
      await Promise.all([onChanged?.(), loadTeams()]);
    } catch (err) {
      setResult({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  }

  function handlePlace(e) {
    e.preventDefault();
    const team = teams.find((t) => t.id === teamId);
    if (membership) {
      run(() => adminMoveStudent(student.id, teamId, roleId), `Moved ${student.name} to “${team.title}”.`);
    } else {
      run(() => adminAssignStudent(student.id, teamId, roleId), `Placed ${student.name} on “${team.title}”.`);
    }
  }

  function handleRemove() {
    run(() => removeMember(student.id), `Took ${student.name} off “${membership.project_title}”.`);
  }

  const feedback = result && (
    <p className={result.ok ? 'meta placement-ok' : 'inline-error'} role={result.ok ? 'status' : 'alert'}>
      {result.text}
    </p>
  );

  if (loadError) return <p className="inline-error" role="alert">{loadError.message}</p>;
  if (!teams || !roles) return <p className="desc" role="status">Loading teams…</p>;

  if (isCreator) {
    return (
      <>
        {feedback}
        <p className="hint">
          {student.name} created “{membership.project_title}”, so they can't be moved or removed —
          only they can delete the team.
        </p>
      </>
    );
  }

  const verb = membership ? 'Move' : 'Assign';

  return (
    <div className="placement">
      <p className="hint">
        Works after the formation deadline too. {student.name} and the owners of the teams involved
        are notified, and the change is recorded.
      </p>
      {feedback}
      <form className="placement-form" onSubmit={handlePlace} aria-label={`${verb} ${student.name}`}>
        <h3>{membership ? 'Move to another team' : 'Assign to a team'}</h3>
        {openTeams.length === 0 ? (
          <p className="desc">No other team has an open seat.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="placement-team">Team</label>
              <select id="placement-team" value={teamId} onChange={(e) => pickTeam(e.target.value)}>
                <option value="">Choose a team…</option>
                {openTeams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.member_count} of {t.team_size_target})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="placement-role">Role</label>
              <select id="placement-role" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
                <option value="">Choose a role…</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="foot">
              <button className="btn" type="submit" disabled={busy || !teamId || !roleId}>
                {busy ? 'Saving…' : `${verb} ${student.name.split(' ')[0]}`}
              </button>
            </div>
          </>
        )}
      </form>

      {membership && (
        <div className="foot">
          {confirmingRemove ? (
            <span className="acts">
              <button type="button" className="btn danger" onClick={handleRemove} disabled={busy}>
                Remove from “{membership.project_title}”
              </button>
              <button type="button" className="btn quiet" onClick={() => setConfirmingRemove(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" className="btn quiet" onClick={() => setConfirmingRemove(true)} disabled={busy}>
              Remove from team
            </button>
          )}
        </div>
      )}
    </div>
  );
}
