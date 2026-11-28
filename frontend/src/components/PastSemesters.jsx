// Past semesters (issue #61): the teams a viewer can still open after their
// semester closed — a student's own, the ones an adviser advised, and every
// one for an admin. past_semesters() decides which; this only draws them.
//
// READ-ONLY BY CONSTRUCTION. There is nothing here that writes: no form, no
// input, and the only buttons open and close a team's details. A past team
// can't be edited anyway (the database's archive guard refuses every write
// into a closed semester), but a control that is offered and then refused is
// worse than none.
//
// Renders nothing at all for someone with no past semesters, so the pages
// that include it look exactly as they did before #61 until the first close.
import { useState } from 'react';
import { getPastSemesters, getPastTeam } from '../api/client';
import { DELIVERABLE_STATUS } from '../lib/deliverables';
import { formatSemesterDates } from './SemesterPanel';
import useAsync from './useAsync';
import { ErrorState, Loading } from './States';

const day = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const week = (d) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function memberLine(members) {
  if (members.length === 0) return 'No members';
  return members.map((m) => (m.role_name ? `${m.name} (${m.role_name})` : m.name)).join(', ');
}

function PastTeamDetail({ projectId }) {
  const { data, loading, error, reload } = useAsync(() => getPastTeam(projectId), [projectId]);
  if (loading) return <Loading label="Loading the team" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  return (
    <div className="past-team-detail">
      {data.description && <p className="desc">{data.description}</p>}

      <h4>Members</h4>
      {data.members.length === 0 ? (
        <p className="desc">Nobody was on this team.</p>
      ) : (
        <ul className="admin-list">
          {data.members.map((m) => (
            <li key={m.user_id}>
              {m.name}
              {m.role_name && <span className="member-role">{m.role_name}</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="desc">Adviser: {data.adviser ? data.adviser.name : 'none'}</p>

      <h4>Deliverables</h4>
      {data.deliverables.length === 0 ? (
        <p className="desc">No milestone took a deliverable that semester.</p>
      ) : (
        <ul className="admin-list" aria-label="Deliverables">
          {data.deliverables.map((d) => {
            const latest = d.versions[0];
            const status = DELIVERABLE_STATUS[d.status] ?? { label: d.status, tone: 'quiet' };
            return (
              <li key={d.milestone_id}>
                {d.name}
                <span className={`pill ${status.tone}`}>{status.label}</span>
                {latest && (
                  <span className="admin-secondary">
                    Version {latest.version}: {latest.kind === 'link' ? latest.link_url : latest.file_name}
                    {latest.is_late ? ' (late)' : ''}
                  </span>
                )}
                {d.comments.length > 0 && (
                  <ul className="past-comments">
                    {d.comments.map((c) => (
                      <li key={c.id}>
                        <strong>{c.author_name ?? 'Someone'}:</strong> {c.body || 'Approved'}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <h4>Check-ins</h4>
      {data.check_ins.length === 0 ? (
        <p className="desc">No check-ins were posted.</p>
      ) : (
        <ul className="admin-list" aria-label="Check-ins">
          {data.check_ins.map((c) => (
            <li key={c.id}>
              <strong>Week of {week(c.week_start)}, {c.user_name ?? 'a former member'}:</strong> {c.did}
              <span className="admin-secondary">Next: {c.doing_next}</span>
              {c.blockers && <span className="admin-secondary">Blocked on: {c.blockers}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PastTeamRow({ team }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="past-team">
      <div className="past-team-head">
        <span className="past-team-title">{team.title}</span>
        {team.is_member && <span className="pill">Your team</span>}
        {team.is_adviser && <span className="pill info">You advised</span>}
        <span className="admin-secondary">{memberLine(team.members)}</span>
        {team.adviser_name && <span className="admin-secondary">Adviser: {team.adviser_name}</span>}
        <button
          type="button"
          className="btn ghost"
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} ${team.title}`}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open && <PastTeamDetail projectId={team.project_id} />}
    </li>
  );
}

export default function PastSemesters() {
  const { data, loading, error, reload } = useAsync(getPastSemesters, []);
  if (loading) return null;
  if (!error && (!data || data.length === 0)) return null;

  return (
    <section aria-labelledby="past-semesters-heading" className="past-semesters">
      <h2 className="section" id="past-semesters-heading">
        Past semesters
      </h2>
      {error ? (
        // Not an alert: this sits under the page's main content (your team,
        // the dashboard), which loaded fine. Saying so quietly, with a way to
        // retry, beats announcing a second error over a page that works.
        <p className="hint">
          Past semesters couldn&apos;t be loaded: {error.message || 'something went wrong'}.
          <button type="button" className="btn ghost" onClick={reload}>
            Try again
          </button>
        </p>
      ) : (
        data.map((s) => (
          <div key={s.id} className="card past-semester">
            <h3>{s.name}</h3>
            <p className="desc">
              {formatSemesterDates(s)} · closed {day(s.closed_at)} · read-only
            </p>
            {s.teams.length === 0 ? (
              <p className="desc">No teams that semester.</p>
            ) : (
              <ul className="admin-list past-teams" aria-label={`${s.name} teams`}>
                {s.teams.map((t) => (
                  <PastTeamRow key={t.project_id} team={t} />
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </section>
  );
}
