import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getRepoActivity, refreshRepoActivity, setProjectRepo } from '../api/client';
import {
  WINDOW_DAYS,
  activityMessage,
  activityRows,
  membersMissingLink,
  parseRepoUrl,
  refreshedLabel,
} from '../lib/github';

// The team's repository, and who has been committing to it (issue #58).
//
// It sits on the team page under the roster, and it is the first thing in
// TeamUp that is about a team *after* it has formed — which is where the
// faculty feedback of 12 Oct pointed.
//
// Three things worth knowing about how this behaves:
//
//   1. IT READS, THEN REFRESHES. The cached row renders immediately, so the
//      page is never empty while GitHub is being asked; the refresh that
//      follows usually answers "cached" without spending a GitHub request.
//      That second call is what keeps the numbers current without a button
//      being pressed, and the fifteen-minute window in the Edge Function is
//      what keeps it cheap.
//   2. A FAILURE NEVER REPLACES THE TABLE. Whatever we last knew stays on
//      screen with a sentence above it. The counts being an hour old is a
//      far better page than an error where the counts were.
//   3. ONLY THE OWNER SEES THE FORM, but anyone on the team can refresh.
//      set_project_repo() and project_repo_for_refresh() enforce exactly
//      that split server-side; hiding the form just saves a round trip that
//      would fail.
export default function RepoActivity({ projectId, isOwner, members = [], repo = '', viewerId }) {
  const [linked, setLinked] = useState(repo ?? '');
  const [activity, setActivity] = useState(null);
  const [reason, setReason] = useState(null);
  const [loading, setLoading] = useState(Boolean(repo));
  const [refreshing, setRefreshing] = useState(false);

  // The owner's form: shown when nothing is linked, and on demand after.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(repo ?? '');
  const [fieldError, setFieldError] = useState(null);
  const [saving, setSaving] = useState(false);

  // A refresh that comes back after the component is gone must not land.
  //
  // Set on the way in as well as cleared on the way out, which is not
  // ceremony: React's StrictMode mounts every component twice in
  // development, so a ref that is only ever cleared stays false for the
  // second, real mount and silently swallows every update after the first
  // await. The table sat on "Checking GitHub…" forever, and no jsdom test
  // caught it — the suite doesn't render under StrictMode. The browser did.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(
    async (currentRepo, { force = false } = {}) => {
      if (!currentRepo) {
        setActivity(null);
        setReason(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      // Whatever we last heard, on screen before GitHub is asked.
      const cached = await getRepoActivity(projectId).catch(() => null);
      if (!live.current) return;
      if (cached) setActivity(cached);
      setLoading(false);

      setRefreshing(true);
      const result = await refreshRepoActivity(projectId, { force });
      if (!live.current) return;
      setRefreshing(false);
      if (result.ok) {
        setActivity(result.activity);
        // The row carries its own error: "we asked, and GitHub said no".
        setReason(result.activity?.error ?? null);
      } else {
        setReason(result.reason);
      }
    },
    [projectId]
  );

  useEffect(() => {
    load(repo ?? '');
    setLinked(repo ?? '');
    setDraft(repo ?? '');
  }, [repo, load]);

  async function handleSave(event) {
    event.preventDefault();
    const text = draft.trim();
    // Parsed here for the message under the box; client.js parses again
    // before sending, and set_project_repo() is the real boundary.
    if (text !== '') {
      const parsed = parseRepoUrl(text);
      if (parsed.error) {
        setFieldError(parsed.error);
        return;
      }
    }
    setSaving(true);
    setFieldError(null);
    try {
      const project = await setProjectRepo(projectId, text);
      const saved = project?.github_repo ?? '';
      setLinked(saved);
      setDraft(saved);
      setEditing(false);
      setActivity(null);
      setReason(null);
      await load(saved, { force: true });
    } catch (error) {
      setFieldError(error?.fieldErrors?.github_repo ?? error.message);
    } finally {
      if (live.current) setSaving(false);
    }
  }

  const rows = activityRows(activity?.contributors ?? [], members);
  const missing = membersMissingLink(members);
  const viewerNeedsLink = missing.some((m) => m.user_id === viewerId);
  const othersMissing = missing.filter((m) => m.user_id !== viewerId);
  const windowDays = activity?.window_days ?? WINDOW_DAYS;
  const shortRepo = linked.replace(/^https:\/\/github\.com\//, '');

  return (
    <section className="card" aria-label="Repository activity">
      <h2>Repository</h2>

      {linked ? (
        <p className="desc">
          <a href={linked} target="_blank" rel="noreferrer noopener">
            {shortRepo}
          </a>
          {/* Three states, not two: a last commit, a window with nothing in
              it, and not having asked yet. The third must not read as the
              second — "no commits" about a repository we have not looked at
              is simply untrue. */}
          {activity?.last_commit_at
            ? ` · last commit ${new Date(activity.last_commit_at).toLocaleDateString()}`
            : activity
              ? ' · no commits in the window yet'
              : ''}
        </p>
      ) : (
        <p className="desc">
          {isOwner
            ? 'Link your team’s repository and TeamUp will show who has been contributing, so nobody has to ask.'
            : 'No repository is linked yet — the project owner can add one.'}
        </p>
      )}

      {isOwner && (editing || !linked) ? (
        <form className="field" onSubmit={handleSave}>
          <label htmlFor="repo-url">Repository URL</label>
          <p className="hint">
            The repository itself, like https://github.com/owner/repo. Members’ commits are matched
            by the GitHub URL on their profile.
          </p>
          <input
            id="repo-url"
            name="repo-url"
            type="text"
            placeholder="https://github.com/owner/repo"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setFieldError(null);
            }}
            aria-invalid={fieldError ? 'true' : undefined}
            aria-describedby={fieldError ? 'repo-url-error' : undefined}
          />
          {fieldError && (
            <span className="inline-error" id="repo-url-error" role="alert">
              {fieldError}
            </span>
          )}
          <div className="foot">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : linked ? 'Save repository' : 'Link repository'}
            </button>
            {linked && (
              <button
                className="btn quiet"
                type="button"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setDraft(linked);
                  setFieldError(null);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        isOwner && (
          <div className="foot">
            <button className="btn quiet" type="button" onClick={() => setEditing(true)}>
              Change repository
            </button>
          </div>
        )
      )}

      {/* Not an alert: the table underneath is still worth reading, and a
          screen reader interrupting to say the counts are an hour old would
          be louder than the news deserves. */}
      {reason && (
        <p className="hint" role="status">
          {activityMessage(reason)}
        </p>
      )}

      {linked && (
        <>
          <h3>Last {windowDays} days</h3>
          {/* GitHub's /repos/{owner}/{repo}/commits lists the default branch
              and nothing else, so work sitting on a feature branch does not
              appear here until it is merged. Said out loud because the
              alternative is a student reading a teammate's empty row as "did
              nothing" — the minor note on Jose's #91 review. It is
              unconditional: the surprise lands hardest on the team whose
              numbers look wrong, and they have no reason to come looking for
              an explanation. */}
          <p className="sub">
            Counts the default branch only, so work on a feature branch shows up once it is
            merged.
          </p>
          {loading && !activity ? (
            <p className="hint">Checking GitHub…</p>
          ) : (
            <div className="repo-table-wrap">
              <table className="repo-table">
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    <th scope="col">Commits</th>
                    <th scope="col">Pull requests</th>
                    <th scope="col">Last commit</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.user_id ?? `unlinked-${row.name}`}>
                      <td>
                        {row.name}
                        {row.unlinked && <span className="tag">Unlinked contributor</span>}
                        {!row.unlinked && !row.linked && (
                          <div className="sub">No GitHub URL on their profile</div>
                        )}
                      </td>
                      {/* A member whose profile has no link has no counts at
                          all, rather than zeroes: a zero says "wrote nothing
                          this fortnight", and the honest answer is "we can't
                          tell yet". */}
                      <td>{row.linked || row.unlinked ? row.commits : '—'}</td>
                      <td>{row.linked || row.unlinked ? row.pull_requests : '—'}</td>
                      <td>
                        {row.last_commit_at
                          ? new Date(row.last_commit_at).toLocaleDateString()
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {viewerNeedsLink && (
            <p className="hint">
              Your commits aren’t being counted yet.{' '}
              <Link to="/profile">Add your GitHub URL to your profile</Link> and they will show up
              here on the next refresh.
            </p>
          )}
          {othersMissing.length > 0 && (
            <p className="hint">
              {othersMissing.map((m) => m.name).join(', ')}{' '}
              {othersMissing.length === 1 ? 'has' : 'have'} no GitHub URL on their profile, so
              those commits can’t be matched yet.
            </p>
          )}

          <div className="foot">
            <span className="sub">
              {activity ? `Updated ${refreshedLabel(activity.fetched_at)}` : 'Not checked yet'}
            </span>
            <button
              className="btn quiet"
              type="button"
              disabled={refreshing}
              onClick={() => load(linked, { force: true })}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
