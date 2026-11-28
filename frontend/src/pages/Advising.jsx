import { Link } from 'react-router-dom';
import { getAdviserDashboard } from '../api/client';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import { ATTENTION, attentionReasons, daysSince, sortAdvisedTeams } from '../lib/adviserDashboard';
import ExportRosters from '../components/ExportRosters';
import { DELIVERABLE_STATUS } from '../lib/deliverables';
import PastSemesters from '../components/PastSemesters';

// The adviser dashboard (issue #56): every team I advise on one page, the
// ones that need me first. Each card is a link to that team's read-only page
// (#54); nothing on this page changes anything.

const dueFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

function daysAgo(days) {
  if (days === null) return 'Never';
  if (days === 0) return 'Today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function TeamCard({ team, now }) {
  const reasons = attentionReasons(team, now);
  const flagged = reasons.length > 0;
  const status = team.next_deliverable_status ? DELIVERABLE_STATUS[team.next_deliverable_status] : null;
  const commitDays = daysSince(team.last_commit_at, now);

  return (
    <li>
      <Link
        to={`/advising/${team.project_id}`}
        className={flagged ? 'card advising-card flagged' : 'card advising-card'}
        aria-label={`${team.title}${flagged ? ', needs attention' : ''}`}
      >
        <div className="advising-head">
          <h2>{team.title}</h2>
          {flagged ? (
            <span className="pill danger">Needs attention</span>
          ) : (
            <span className="pill good">On track</span>
          )}
        </div>

        {flagged && (
          <ul className="attention-list" aria-label="Why it needs attention">
            {reasons.map((r) => (
              <li key={r}>{ATTENTION[r]}</li>
            ))}
          </ul>
        )}

        <p className="desc">
          {team.members.length > 0 ? team.members.map((m) => m.name).join(', ') : 'No members yet'}
        </p>

        <dl className="kv advising-stats">
          <div>
            <dt>Check-ins this week</dt>
            <dd>
              {team.check_ins_submitted} of {team.check_ins_expected}
            </dd>
          </div>
          <div>
            <dt>Open blockers</dt>
            <dd>{team.open_blockers}</dd>
          </div>
          <div>
            <dt>Last check-in</dt>
            <dd>{daysAgo(daysSince(team.last_check_in_at, now))}</dd>
          </div>
          <div>
            <dt>Next milestone</dt>
            <dd>
              {team.next_milestone_name ? (
                <>
                  {team.next_milestone_name}{' '}
                  <span className="advising-due">
                    due {dueFormat.format(new Date(team.next_milestone_due_at))}
                  </span>
                  {status && <span className={`pill ${status.tone}`}>{status.label}</span>}
                </>
              ) : (
                'None scheduled'
              )}
            </dd>
          </div>
          {commitDays !== null && (
            <div>
              <dt>Last commit</dt>
              <dd>{daysAgo(commitDays)}</dd>
            </div>
          )}
        </dl>
      </Link>
    </li>
  );
}

export default function Advising() {
  const { data, loading, error, reload } = useAsync(getAdviserDashboard, []);

  if (loading) return <Loading label="Loading the teams you advise" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const now = new Date();
  const teams = sortAdvisedTeams(data ?? [], now);
  const flaggedCount = teams.filter((t) => attentionReasons(t, now).length > 0).length;

  return (
    <>
      <div className="head">
        <div>
          <h1>Advising</h1>
          <p>
            {teams.length === 0
              ? 'The teams you advise, and how each is doing'
              : `${teams.length === 1 ? '1 team' : `${teams.length} teams`}${
                  flaggedCount > 0 ? ` · ${flaggedCount} need${flaggedCount === 1 ? 's' : ''} attention, listed first` : ' · all on track'
                }`}
          </p>
        </div>
        {/* #40's last criterion: "advisers get the same export limited to the
            teams they advise, from the Advising dashboard (#56)". The same
            component as the admin's, which is why it takes a label —
            export_rosters() narrows by who is asking, so there is nothing
            adviser-specific to build on this side.

            Hidden with no teams, because an adviser who has stepped down
            would otherwise get a button that export_rosters() refuses: it
            rejects a caller who is neither an admin nor an accepted adviser.

            One wrinkle worth knowing: an admin who also advises gets the
            *admin* scope here — every team, not only theirs — because
            export_rosters() checks admin first. That is the function's whole
            design (it answers by who is asking, as admin_dashboard() does),
            so the button keeps the neutral label rather than promising
            "my teams" and handing an instructor the whole class. */}
        {teams.length > 0 && (
          <div className="head-actions">
            <ExportRosters />
          </div>
        )}
      </div>

      {teams.length === 0 ? (
        <Empty title="You aren't advising any teams yet.">
          <p>
            A project owner asks you to advise their team from their team page. Invitations show up
            on your <Link to="/requests">Requests</Link> page; once you accept one, the team appears
            here with its check-ins, blockers and deliverables.
          </p>
        </Empty>
      ) : (
        <ul className="advising-list">
          {teams.map((t) => (
            <TeamCard key={t.project_id} team={t} now={now} />
          ))}
        </ul>
      )}

      {/* #61: the teams advised in semesters that have closed. */}
      <PastSemesters />
    </>
  );
}
