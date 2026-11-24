import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cancelAdviserRequest,
  getProjectAdviser,
  inviteAdviser,
  removeAdviser,
  searchAdvisers,
} from '../api/client';
import useAsync from './useAsync';
import Avatar from './Avatar';
import { isFull, matchingExpertise, orderAdvisers, spotsLabel } from '../lib/advising';

// The project's adviser, on the team page (issue #53).
//
// Four states, and the whole panel is a function of which one it is in:
//
//   nobody asked  → the owner gets a search box; everyone else gets nothing
//   pending       → who was asked, and the owner can cancel
//   accepted      → who it is, and the owner can remove them
//   declined      → who said no, and the owner can ask again
//
// Only the owner ever sees a control. Everyone else reads the same states —
// "see but can't change" is a criterion, not an accident of layout — and
// invite_adviser()/cancel_adviser_request()/remove_adviser() each re-check
// ownership server-side, so hiding the buttons only saves a round trip that
// would fail.
//
// The adviser is deliberately not part of the roster above this panel: an
// adviser holds no seat (supabase/39_project_advisers.sql), so putting them
// in the member list would be the one place in the app that implied they do.

// Below this many characters search_advisers() returns nothing rather than
// the student body, so there is no point sending the request. Same number as
// the function's own guard.
const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

// `rolesNeeded` is the project's open roles, only ever used to pick out which
// of a candidate's areas of expertise this project actually needs (issue
// #60). It is optional: with none passed, the areas still show, just without
// anything highlighted — which is also what happens for a project whose roles
// have all been filled.
export default function AdviserPanel({ projectId, isOwner, rolesNeeded = [] }) {
  const loadAdviser = useCallback(() => getProjectAdviser(projectId), [projectId]);
  const { data: adviser, loading, error, setData } = useAsync(loadAdviser, [projectId]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // null | 'inviting' | 'cancelling' | 'removing'
  const [busy, setBusy] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [asking, setAsking] = useState(false);

  // A search per keystroke would be a request per keystroke. The timer is
  // cleared on every change and on unmount, so a typed-then-left panel does
  // not fire one after it is gone.
  const latestQuery = useRef('');
  useEffect(() => {
    const trimmed = query.trim();
    latestQuery.current = trimmed;
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return undefined;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      searchAdvisers(projectId, trimmed)
        .then((found) => {
          // Answers can come back out of order; only the newest one counts.
          if (latestQuery.current !== trimmed) return;
          setResults(found);
          setSearchError(null);
        })
        .catch((err) => {
          if (latestQuery.current !== trimmed) return;
          setResults([]);
          setSearchError(err.message || 'Could not search for an adviser.');
        })
        .finally(() => {
          if (latestQuery.current === trimmed) setSearching(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, projectId]);

  // #60's order: whoever can say yes, best fit first. search_advisers() has
  // already put full advisers last, and orderAdvisers() does it again on
  // purpose — the expertise half of the comparison can only happen here, so
  // the whole ordering lives in one place and mock mode cannot disagree with
  // the database about the first row.
  const ordered = useMemo(() => orderAdvisers(results, rolesNeeded), [results, rolesNeeded]);

  function resetSearch() {
    setQuery('');
    setResults([]);
    setSearchError(null);
    setAsking(false);
  }

  async function run(state, call) {
    setBusy(state);
    setActionError(null);
    try {
      await call();
      // Re-read rather than patching state by hand: the server decides what
      // the panel now says, and a refused call has changed nothing.
      setData(await getProjectAdviser(projectId));
      resetSearch();
    } catch (err) {
      setActionError(err.message || 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const invite = (userId) => run('inviting', () => inviteAdviser(projectId, userId));
  const cancel = () => run('cancelling', () => cancelAdviserRequest(projectId));
  const remove = () => run('removing', () => removeAdviser(projectId));

  if (loading) {
    return (
      <section className="card" aria-label="Adviser">
        <h2>Adviser</h2>
        <p className="state" role="status">Loading the adviser…</p>
      </section>
    );
  }

  // A panel that cannot load is not worth an error banner on a page that
  // otherwise works: the adviser is one line of a team page, and the states
  // below are all readable without it. Say so and stop.
  if (error) {
    return (
      <section className="card" aria-label="Adviser">
        <h2>Adviser</h2>
        <p className="hint">Could not load the adviser just now.</p>
      </section>
    );
  }

  const status = adviser?.status ?? null;
  const open = status === 'pending' || status === 'accepted';
  // After a decline the owner can ask somebody else, so the search box comes
  // back — but only once they say they want it, so the panel does not read as
  // if the decline had not happened.
  const searchable = isOwner && !open && (asking || !adviser);

  return (
    <section className="card" aria-label="Adviser">
      <h2>Adviser</h2>

      {!adviser && (
        <p className="hint">
          {isOwner
            ? 'Nobody is advising this project yet. Ask a Computer Science faculty member to be your team’s contact — an adviser takes no seat on the roster.'
            : 'Nobody is advising this project yet.'}
        </p>
      )}

      {adviser && (
        <div className="rows">
          <div className="row adviser">
            <Avatar name={adviser.adviser_name} size={34} />
            <div>
              <div className="nm">
                {adviser.adviser_name}
                {status === 'pending' && <span className="tag">Pending</span>}
                {status === 'declined' && <span className="tag">Declined</span>}
              </div>
              <div className="sub">
                {status === 'accepted' && 'Advising this project'}
                {status === 'pending' && 'Asked, and has not answered yet'}
                {status === 'declined' && 'Turned down the invitation'}
                {adviser.adviser_email && ` · ${adviser.adviser_email}`}
              </div>
            </div>
            <div className="sub">
              {isOwner && status === 'pending' && (
                <button className="btn quiet" onClick={cancel} disabled={busy !== null}>
                  {busy === 'cancelling' ? 'Cancelling…' : 'Cancel request'}
                </button>
              )}
              {isOwner && status === 'accepted' && (
                <button className="btn danger" onClick={remove} disabled={busy !== null}>
                  {busy === 'removing' ? 'Removing…' : 'Remove adviser'}
                </button>
              )}
              {isOwner && status === 'declined' && !asking && (
                <button className="btn" onClick={() => setAsking(true)} disabled={busy !== null}>
                  Ask someone else
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <p className="inline-error" role="alert">{actionError}</p>
      )}

      {searchable && (
        <div className="adviser-search">
          <label htmlFor="adviser-search-input">Search by name or email</label>
          <input
            id="adviser-search-input"
            type="search"
            value={query}
            autoComplete="off"
            placeholder="A CS faculty member’s name or email"
            onChange={(e) => setQuery(e.target.value)}
          />

          {query.trim().length > 0 && query.trim().length < MIN_QUERY && (
            <p className="hint">Type at least {MIN_QUERY} characters.</p>
          )}
          {searching && <p className="state" role="status">Searching…</p>}
          {searchError && <p className="inline-error" role="alert">{searchError}</p>}

          {!searching && !searchError && query.trim().length >= MIN_QUERY && results.length === 0 && (
            <p className="hint">
              Nobody matching that. People already on this team can’t advise it.
            </p>
          )}

          {ordered.length > 0 && (
            <ul className="adviser-results">
              {ordered.map((u) => {
                const matches = matchingExpertise(u, rolesNeeded);
                const matchedBy = new Map(matches.map((m) => [m.id, m.basis]));
                const full = isFull(u);
                return (
                  <li key={u.id} className={full ? 'is-full' : undefined}>
                    <Avatar name={u.name} size={28} />
                    <span>
                      <span className="nm">
                        {u.name}
                        {full && <span className="tag">Full</span>}
                      </span>
                      <span className="sub">{u.email}</span>
                      {/* Its own element, not appended to the email: the
                          email is one fact a caller may want to read on its
                          own, and joining them makes every assertion about
                          it a substring match. */}
                      <span className="sub spots">{spotsLabel(u)}</span>
                      {(u.expertise?.length ?? 0) > 0 && (
                        <span className="areas">
                          {u.expertise.map((area) => (
                            <span
                              key={area.id}
                              className={matchedBy.has(area.id) ? 'area match' : 'area'}
                              title={
                                matchedBy.get(area.id) === 'has-skill'
                                  ? 'This project asks for this'
                                  : matchedBy.has(area.id)
                                    ? 'Close to something this project asks for'
                                    : undefined
                              }
                            >
                              {area.name}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <button
                      className="btn"
                      onClick={() => invite(u.id)}
                      disabled={busy !== null || full}
                      title={full ? 'They are already advising as many teams as they take on' : undefined}
                    >
                      {busy === 'inviting' ? 'Asking…' : 'Ask to advise'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
