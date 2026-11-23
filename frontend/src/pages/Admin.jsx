import { useState } from 'react';
import { Link } from 'react-router-dom';
import { getAdminActions, getAdminDashboard } from '../api/client';
import { formatDue } from '../components/Milestones';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import StatusPill from '../components/StatusPill';

export function PendingProjectLinks({ requests }) {
  if (requests.length === 0) return <span className="desc">No pending requests</span>;
  return (
    <ul className="admin-list">
      {requests.map((r) => (
        <li key={r.id}>
          {r.team_id ? <Link to={`/admin/teams/${r.team_id}`}>{r.project_title}</Link> : r.project_title}
        </li>
      ))}
    </ul>
  );
}

const ACTION_TEXT = {
  assign: (a) => `placed ${a.student_name ?? 'a student'} on “${a.to_project_title}”`,
  move: (a) => `moved ${a.student_name ?? 'a student'} from “${a.from_project_title}” to “${a.to_project_title}”`,
  remove: (a) => `took ${a.student_name ?? 'a student'} off “${a.from_project_title}”`,
};

// Every admin placement change (issue #39), newest first.
export function RecentChanges() {
  const { data, loading, error, reload } = useAsync(() => getAdminActions(20), []);
  return (
    <section aria-labelledby="changes-heading">
      <h2 className="section" id="changes-heading">Recent admin changes</h2>
      {loading ? <Loading label="Loading changes" /> : error ? <ErrorState error={error} onRetry={reload} /> : data.length === 0 ? (
        <Empty title="No admin changes yet."><p>Assignments, moves and removals show up here.</p></Empty>
      ) : (
        <div className="card">
          <ul className="admin-list" aria-label="Recent admin changes">
            {data.map((a) => (
              <li key={a.id}>
                {a.admin_name ?? 'An admin'} {ACTION_TEXT[a.action]?.(a) ?? a.action}
                {a.role_name && a.action !== 'remove' ? ` as ${a.role_name}` : ''}
                <span className="admin-secondary">{formatDue(a.created_at)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// How far a team is through the next-steps checklist (issue #42). Teams
// only see the checklist once they're full (#30), so an open team that
// hasn't started shows a dash: whether it is open is the Status column's job.
export function NextStepProgress({ team }) {
  const progress = team.next_steps;
  if (!progress) return null;
  if (progress.total === 0) {
    return <span className="desc">No checklist yet</span>;
  }
  if (team.status !== 'full' && progress.done === 0) {
    return (
      <span className="desc" title="Starts when the team is full">
        <span aria-hidden="true">—</span>
        <span className="sr-only">Starts when the team is full</span>
      </span>
    );
  }
  return (
    <span className={progress.done === progress.total ? 'next-step-progress done' : 'next-step-progress'}>
      {progress.done} of {progress.total} done
    </span>
  );
}

// ---------- sorting and filtering (client-side: the whole list is loaded) ----------

const STATUS_ORDER = ['open', 'full'];
const statusRank = (t) => {
  const i = STATUS_ORDER.indexOf(t.status);
  return i === -1 ? STATUS_ORDER.length : i;
};
const seatShare = (t) => (t.team_size_target > 0 ? t.member_count / t.team_size_target : 1);
// Share of the checklist done, or null when there is nothing to measure yet:
// no checklist, or an open team that hasn't started (NextStepProgress's dash).
function stepShare(t) {
  const p = t.next_steps;
  if (!p || p.total === 0 || (t.status !== 'full' && p.done === 0)) return null;
  return p.done / p.total;
}
const byTitle = (a, b) =>
  a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || String(a.id).localeCompare(String(b.id));

const COMPARE = {
  title: byTitle,
  seats: (a, b) => seatShare(a) - seatShare(b) || a.member_count - b.member_count,
  status: (a, b) => statusRank(a) - statusRank(b),
  next: (a, b) => stepShare(a) - stepShare(b),
};

// The default order: open teams first, emptiest at the top (they need
// students); then full teams, least checklist progress first.
function needsAttention(a, b) {
  return statusRank(a) - statusRank(b)
    || (a.status === 'open' ? seatShare(a) - seatShare(b) : (stepShare(a) ?? 1) - (stepShare(b) ?? 1))
    || byTitle(a, b);
}

// sort is 'attention' or '<column>:<asc|desc>'.
export function sortTeams(teams, sort) {
  if (sort === 'attention') return [...teams].sort(needsAttention);
  const [column, dir] = sort.split(':');
  const sign = dir === 'desc' ? -1 : 1;
  return [...teams].sort((a, b) => {
    // Teams with no checklist progress to compare go last in both directions.
    if (column === 'next' && (stepShare(a) === null || stepShare(b) === null)) {
      return (stepShare(a) === null) - (stepShare(b) === null) || byTitle(a, b);
    }
    return sign * COMPARE[column](a, b) || byTitle(a, b);
  });
}

const SORT_OPTIONS = [
  ['attention', 'Needs attention first'],
  ['title:asc', 'Team, A to Z'],
  ['title:desc', 'Team, Z to A'],
  ['seats:asc', 'Seats filled, fewest first'],
  ['seats:desc', 'Seats filled, most first'],
  ['status:asc', 'Status, open first'],
  ['status:desc', 'Status, full first'],
  ['next:asc', 'Next steps, least done first'],
  ['next:desc', 'Next steps, most done first'],
];

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function resultCount(shown, total) {
  if (shown === total) return total === 1 ? 'Showing 1 team' : `Showing all ${total} teams`;
  return `Showing ${shown} of ${total} ${total === 1 ? 'team' : 'teams'}`;
}

function SortIcon({ dir }) {
  return (
    <svg className={dir ? 'sort-icon on' : 'sort-icon'} data-direction={dir ?? 'none'} width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {dir === 'asc' ? <path d="M6 9.5v-7M3 5.5l3-3 3 3" /> : dir === 'desc' ? <path d="M6 2.5v7M3 6.5l3 3 3-3" /> : <path d="M3.5 4.5 6 2l2.5 2.5M3.5 7.5 6 10l2.5-2.5" />}
    </svg>
  );
}

// A column title that sorts: once ascending, again descending.
function SortHeader({ column, label, sort, onSort, className }) {
  const [active, dir] = sort.split(':');
  const on = active === column;
  return (
    <th scope="col" role="columnheader" className={className} aria-sort={on ? (dir === 'desc' ? 'descending' : 'ascending') : undefined}>
      <button type="button" className="sort-button" onClick={() => onSort(column)}>
        {label}
        <SortIcon dir={on ? dir : null} />
      </button>
    </th>
  );
}

function SeatsFilled({ team }) {
  const share = Math.min(1, team.team_size_target > 0 ? team.member_count / team.team_size_target : 0);
  return (
    <span className="seat-fill">
      <span className={share >= 1 ? 'seat-fill-bar full' : 'seat-fill-bar'} aria-hidden="true">
        <span style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span className="seat-fill-count">{team.member_count} of {team.team_size_target}</span>
    </span>
  );
}

function SummaryArrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" focusable="false">
      <path d="M7 2.5v9M3.5 8 7 11.5 10.5 8" />
    </svg>
  );
}

// The explicit table roles look redundant, but at phone width the tables are
// restyled as cards (display: block), and some browsers drop a table's
// semantics when its display changes. The roles keep it a table.
export default function Admin() {
  const { data, loading, error, reload } = useAsync(getAdminDashboard, []);
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState('attention');

  if (loading) return <Loading label="Loading team formation" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;

  const total = data.teams.length;
  const statuses = [...STATUS_ORDER, ...new Set(data.teams.map((t) => t.status).filter((s) => s && !STATUS_ORDER.includes(s)))];
  const sorted = sortTeams(data.teams, sort);
  const shown = statusFilter ? sorted.filter((t) => t.status === statusFilter) : sorted;
  const sortByColumn = (column) => setSort((s) => (s === `${column}:asc` ? `${column}:desc` : `${column}:asc`));
  const unplaced = data.summary.unplaced_students;

  return (
    <>
      <div className="head">
        <div>
          <h1>Administration</h1>
          <p>Track team formation and find students who still need a team.</p>
        </div>
        <button className="btn ghost" onClick={reload}>Refresh</button>
      </div>

      <dl className="admin-summary" aria-label="Formation summary">
        <div><dt>Teams formed</dt><dd>{data.summary.formed_teams}</dd></div>
        <div><dt>Teams still open</dt><dd>{data.summary.open_teams}</dd></div>
        <div className="summary-jump">
          <dt>Students unplaced</dt>
          <dd>
            <a href="#unplaced-heading" aria-label={`${unplaced} ${unplaced === 1 ? 'student' : 'students'} unplaced: go to the list`}>
              {unplaced}<SummaryArrow />
            </a>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="all-teams-heading">
        <h2 className="section" id="all-teams-heading">All teams</h2>
        {total === 0 ? (
          <Empty title="No teams yet."><p>Teams will appear when students post projects.</p></Empty>
        ) : (
          <div className="data-table">
            <div className="table-toolbar">
              <div className="table-control">
                <label htmlFor="team-status-filter">Status</label>
                <select id="team-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All statuses ({total})</option>
                  {statuses.map((s) => (
                    <option key={s} value={s}>{capitalize(s)} ({data.teams.filter((t) => t.status === s).length})</option>
                  ))}
                </select>
              </div>
              <div className="table-control">
                <label htmlFor="team-sort">Sort by</label>
                <select id="team-sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                  {SORT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              {statusFilter && (
                <span className="filter-chip">
                  Status: {statusFilter}
                  <button type="button" aria-label={`Remove filter: status ${statusFilter}`} onClick={() => setStatusFilter('')}>
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false"><path d="M2 2l6 6M8 2 2 8" /></svg>
                  </button>
                </span>
              )}
            </div>

            {shown.length === 0 ? (
              <Empty title="No teams match this filter.">
                <p>No team is {statusFilter} right now.</p>
                <button type="button" className="btn ghost" onClick={() => setStatusFilter('')}>Clear filter</button>
              </Empty>
            ) : (
              <table className="admin-table teams-table" role="table" aria-labelledby="all-teams-heading">
                <colgroup>
                  <col className="col-team" /><col /><col className="col-seats" /><col className="col-status" /><col className="col-next" />
                </colgroup>
                <thead role="rowgroup">
                  <tr role="row">
                    <SortHeader column="title" label="Team" sort={sort} onSort={sortByColumn} />
                    <th scope="col" role="columnheader">Members and roles</th>
                    <SortHeader column="seats" label="Seats filled" className="numeric" sort={sort} onSort={sortByColumn} />
                    <SortHeader column="status" label="Status" sort={sort} onSort={sortByColumn} />
                    <SortHeader column="next" label="Next steps" sort={sort} onSort={sortByColumn} />
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {shown.map((t) => (
                    <tr key={t.id} role="row">
                      <th scope="row" role="rowheader" className="cell-team">
                        <Link to={`/admin/teams/${t.id}`} title={t.title}>{t.title}</Link>
                      </th>
                      <td role="cell" className="cell-members">
                        {t.members.length === 0 ? <span className="desc">No members yet</span> : (
                          <ul className="admin-list member-list">
                            {t.members.map((m) => (
                              <li key={m.user_id}>
                                <Link to={`/admin/students/${m.user_id}`} title={m.name}>{m.name}</Link>
                                <span className="member-role">{m.role_name || 'Role not set'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td role="cell" className="numeric cell-seats" data-label="Seats filled"><SeatsFilled team={t} /></td>
                      <td role="cell" className="cell-status"><StatusPill status={t.status} /></td>
                      <td role="cell" className="cell-next" data-label="Next steps"><NextStepProgress team={t} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <p className="table-foot" aria-live="polite">{resultCount(shown.length, total)}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="unplaced-heading">
        <h2 className="section" id="unplaced-heading">Unplaced students</h2>
        {data.unplaced_students.length === 0 ? (
          <Empty title="No unplaced students."><p>Every registered student has a team, or no students have signed in yet.</p></Empty>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table unplaced-table" role="table" aria-labelledby="unplaced-heading">
              <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Student</th><th scope="col" role="columnheader">Pending requests</th></tr></thead>
              <tbody role="rowgroup">
                {data.unplaced_students.map((s) => (
                  <tr key={s.id} role="row">
                    <th scope="row" role="rowheader">
                      <Link to={`/admin/students/${s.id}`}>{s.name}</Link>
                      <span className="admin-secondary">{s.email}</span>
                    </th>
                    <td role="cell" data-label="Pending requests"><PendingProjectLinks requests={s.pending_requests} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RecentChanges />
    </>
  );
}
