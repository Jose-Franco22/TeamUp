import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createJoinRequest,
  getCurrentUser,
  getFormationDeadline,
  getProjects,
  getRoles,
} from '../api/client';
import { useSession } from '../auth/SessionContext';
import useAsync from '../components/useAsync';
import { ErrorState, Loading, Empty } from '../components/States';
import RolesNeeded from '../components/RolesNeeded';
import MemberStrip from '../components/MemberStrip';
import StatusPill from '../components/StatusPill';
import FitChip from '../components/FitChip';
import {
  describeEmpty,
  filterProjects,
  filterRanked,
  isOpenProject,
  rankProjects,
} from '../lib/browseFilters';
import { JOIN_BLOCKED, isPastDeadline } from '../lib/joinRequests';
import { JOIN_MESSAGE_MAX, charCount } from '../lib/validation';

export default function Browse() {
  const { status, user } = useSession();
  const isAuthenticated = status === 'authenticated';
  const navigate = useNavigate();

  // Everything is fetched, not just the open ones, so the page can say how
  // many the "open only" switch is hiding. The filtering itself happens in
  // lib/browseFilters.js, which is also what getProjects() uses.
  const projectsState = useAsync(() => getProjects({ onlyOpen: false }), []);
  const meState = useAsync(
    () => (isAuthenticated ? getCurrentUser() : Promise.resolve(null)),
    [isAuthenticated]
  );
  const rolesState = useAsync(getRoles, []);
  // Only used to say up front that requests are closed. If it fails the
  // button stays live and create_join_request() still refuses with the
  // same sentence.
  const deadlineState = useAsync(
    () => (isAuthenticated ? getFormationDeadline() : Promise.resolve(null)),
    [isAuthenticated]
  );

  // project_id -> 'sending' | 'sent' | error message
  const [requests, setRequests] = useState({});
  // project_id -> the note being written, for each card whose composer is open
  const [drafts, setDrafts] = useState({});
  const [onlyMatches, setOnlyMatches] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [roleId, setRoleId] = useState('');

  const me = meState.data;
  const mySkillIds = (me?.skills || []).map((s) => s.id);
  const hasSkills = mySkillIds.length > 0;

  // The profile and the roles list are both secondary to the project list. If
  // either fails the page still works: without a profile there is no ranking
  // and no match filter, without roles there is no role filter. Neither is a
  // reason to show an error page instead of the projects.
  const profileFailed = isAuthenticated && !!meState.error;
  const roles = rolesState.data || [];

  const student = useMemo(
    () =>
      me && hasSkills
        ? {
            availability_hours: me.availability_hours,
            skills: me.skills,
            // Months and projects per skill, loaded with the profile. Without
            // them every skill scores as a bare tag.
            evidence: me.evidence,
          }
        : null,
    [me, hasSkills]
  );

  const filters = { query, roleId, onlyOpen, onlyMatches, mySkillIds };

  function clearFilters() {
    setQuery('');
    setRoleId('');
    setOnlyMatches(false);
    setOnlyOpen(true);
  }

  function openComposer(projectId) {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: '/browse' } } });
      return;
    }
    setDrafts((d) => ({ ...d, [projectId]: d[projectId] ?? '' }));
  }

  function closeComposer(projectId) {
    setDrafts(({ [projectId]: _closed, ...rest }) => rest);
  }

  async function handleJoin(projectId) {
    setRequests((r) => ({ ...r, [projectId]: 'sending' }));
    try {
      await createJoinRequest(projectId, drafts[projectId] ?? '');
      setRequests((r) => ({ ...r, [projectId]: 'sent' }));
      closeComposer(projectId);
    } catch (err) {
      setRequests((r) => ({ ...r, [projectId]: err.message }));
    }
  }

  if (projectsState.loading) return <Loading label="Loading projects" />;
  if (projectsState.error) {
    return <ErrorState error={projectsState.error} onRetry={projectsState.reload} />;
  }

  const all = projectsState.data || [];
  const openCount = all.filter(isOpenProject).length;
  const hiddenFull = onlyOpen ? all.length - openCount : 0;

  // Rank first, then filter on the score, so "Only show matches" and the
  // order of the list are answering the same question. Filtering on an exact
  // skill overlap instead made a card reading "Partial fit" disappear when a
  // student asked to see their matches.
  const ranked = rankProjects(filterProjects(all, filters), { student });
  const visible = filterRanked(ranked, { onlyMatches });

  // Counted over every open project, not just the filtered ones, so the
  // number does not move as the student types in the search box.
  const matchCount = student
    ? rankProjects(all.filter(isOpenProject), { student }).filter((r) => r.fit.points > 0).length
    : 0;

  // A student can only be on one team. This is true across every project
  // in `all`, not just the one being rendered, so it's computed once here
  // rather than per-card.
  const onAnyTeam =
    isAuthenticated && all.some((p) => p.members.some((m) => m.user_id === user.id));

  const pastDeadline = isPastDeadline(deadlineState.data);

  const empty = describeEmpty({ total: all.length, openCount, filters });

  return (
    <>
      <div className="head">
        <div>
          <h1>Open projects</h1>
          <p>
            Showing {visible.length} of {all.length} project{all.length === 1 ? '' : 's'}
            {isAuthenticated && hasSkills && ` · ${matchCount} you could fill a role on`}
            {hiddenFull > 0 && ` · ${hiddenFull} full and hidden`}
          </p>
        </div>
      </div>

      <div className="filters">
        <label className="filter grow">
          <span>Search</span>
          <input
            type="search"
            placeholder="Title or keyword"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        {/* Hidden rather than broken when getRoles() fails — the role filter
            is a convenience, and the rest of the page does not depend on it. */}
        {roles.length > 0 && (
          <label className="filter">
            <span>Role</span>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">Any role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="switch">
          <input
            type="checkbox"
            checked={onlyOpen}
            onChange={(e) => setOnlyOpen(e.target.checked)}
          />
          Open projects only
        </label>

        {isAuthenticated && (
          <label className="switch">
            <input
              type="checkbox"
              checked={onlyMatches}
              disabled={!hasSkills}
              onChange={(e) => setOnlyMatches(e.target.checked)}
            />
            Only show matches
          </label>
        )}
      </div>

      {isAuthenticated && !hasSkills && !meState.loading && !profileFailed && (
        <p className="hint">
          Add skills to your profile, or import your resume, and these projects get ranked by
          how well you fit them.
        </p>
      )}

      {profileFailed && (
        <p className="hint" role="status">
          Couldn't load your profile, so projects aren't ranked.{' '}
          <button className="btn ghost" onClick={meState.reload}>
            Try again
          </button>
        </p>
      )}

      {visible.length === 0 ? (
        <Empty title={empty.title}>
          <p>{empty.hint}</p>
          {empty.canClear && (
            <button className="btn ghost" onClick={clearFilters}>
              Clear filters
            </button>
          )}
        </Empty>
      ) : (
        <div className="grid2">
          {visible.map(({ project: p, fit }) => {
            const req = requests[p.id];
            const isCreator = isAuthenticated && p.creator_id === user.id;
            const isMember = isAuthenticated && p.members.some((m) => m.user_id === user.id);
            const isPending =
              isAuthenticated && (req === 'sent' || p.viewer_request_status === 'pending');
            const isFull = p.status === 'full' || p.member_count >= p.team_size_target;
            // Why this student can't ask, if they can't — the same sentence
            // create_join_request() would raise. Own project and own team
            // say so on the button already.
            const blockedReason =
              !isAuthenticated || isCreator || isMember
                ? null
                : onAnyTeam
                  ? JOIN_BLOCKED.onTeam
                  : isPending
                    ? JOIN_BLOCKED.pending
                    : isFull
                      ? JOIN_BLOCKED.full
                      : pastDeadline
                        ? JOIN_BLOCKED.deadline
                        : null;
            const draft = drafts[p.id];
            const composing = draft !== undefined && !blockedReason;
            return (
              <article className="card" key={p.id}>
                <h2>
                  {p.title} <StatusPill status={p.status} />
                </h2>
                <p className="desc">{p.description}</p>

                {/* The ranking, made legible: the number the list was sorted
                    by, and the reason behind it. A score with no reason is
                    not worth showing. */}
                <FitChip fit={fit} />

                <p className="lbl">Roles needed</p>
                <RolesNeeded roles={p.roles_needed} mySkillIds={mySkillIds} />

                <MemberStrip
                  members={p.members}
                  targetSize={p.team_size_target}
                  memberCount={p.member_count}
                  isAuthenticated={isAuthenticated}
                />

                <div className="foot">
                  {!isAuthenticated ? (
                    <button className="btn" onClick={() => openComposer(p.id)}>
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
                  ) : isFull ? (
                    <button className="btn" disabled>
                      Project full
                    </button>
                  ) : pastDeadline ? (
                    <button className="btn" disabled>
                      Requests closed
                    </button>
                  ) : composing ? null : (
                    <button className="btn" onClick={() => openComposer(p.id)}>
                      Request to join
                    </button>
                  )}
                  {isAuthenticated && (
                    <span className="meta">
                      {p.member_count} of {p.team_size_target}
                      {p.avg_availability_hours > 0 && ` · ${p.avg_availability_hours} hrs/wk avg`}
                    </span>
                  )}
                </div>
                {blockedReason && <p className="hint blocked">{blockedReason}</p>}
                {composing && (
                  <JoinComposer
                    value={draft}
                    sending={req === 'sending'}
                    onChange={(text) => setDrafts((d) => ({ ...d, [p.id]: text }))}
                    onSend={() => handleJoin(p.id)}
                    onCancel={() => closeComposer(p.id)}
                  />
                )}
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

// The optional note to the creator, with a running count of what's left.
// Typing past the limit is allowed (so a paste isn't silently cut off) but
// sending isn't until it's back under.
function JoinComposer({ value, sending, onChange, onSend, onCancel }) {
  const left = JOIN_MESSAGE_MAX - charCount(value.trim());
  const id = useId();
  return (
    <div className="join-composer">
      <label htmlFor={id}>Why you're a good fit (optional)</label>
      <textarea
        id={id}
        rows={3}
        value={value}
        disabled={sending}
        aria-describedby={`${id}-count`}
        onChange={(e) => onChange(e.target.value)}
      />
      <p id={`${id}-count`} className={`counter${left < 0 ? ' over' : ''}`} aria-live="polite">
        {left >= 0
          ? `${left} character${left === 1 ? '' : 's'} left`
          : `${-left} character${left === -1 ? '' : 's'} over the ${JOIN_MESSAGE_MAX} limit`}
      </p>
      <div className="acts">
        <button className="btn" disabled={sending || left < 0} onClick={onSend}>
          {sending ? 'Sending…' : 'Send request'}
        </button>
        <button className="btn quiet" disabled={sending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
