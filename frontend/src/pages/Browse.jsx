import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { joinProject, getCurrentUser, getProjects, getRoles } from '../api/client';
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

  // project_id -> 'joining' | error message
  const [requests, setRequests] = useState({});
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

  async function handleJoin(projectId) {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: { pathname: '/browse' } } });
      return;
    }
    setRequests((r) => ({ ...r, [projectId]: 'joining' }));
    try {
      // Demo: joining is instant, so reload to show the new roster.
      await joinProject(projectId);
      setRequests((r) => ({ ...r, [projectId]: undefined }));
      projectsState.reload();
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
            const isFull = p.status === 'full' || p.member_count >= p.team_size_target;
            return (
              <article className="card" key={p.id}>
                <h2>
                  {p.title} <StatusPill status={p.status} />
                </h2>
                <p className="desc">{p.description}</p>

                {/* The ranking, made legible: the number the list was sorted
                    by, and the reason behind it. A score with no reason is
                    not worth showing. */}
                <FitChip fit={fit} project={p} student={student} />

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
                    <button className="btn" onClick={() => handleJoin(p.id)}>
                      Sign in to join
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
                  ) : (
                    <button
                      className="btn"
                      disabled={isFull || req === 'joining'}
                      onClick={() => handleJoin(p.id)}
                    >
                      {req === 'joining' ? 'Joining…' : 'Join team'}
                    </button>
                  )}
                  {isAuthenticated && (
                    <span className="meta">
                      {p.member_count} of {p.team_size_target}
                      {p.avg_availability_hours > 0 && ` · ${p.avg_availability_hours} hrs/wk avg`}
                    </span>
                  )}
                </div>
                {req && req !== 'joining' && (
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
