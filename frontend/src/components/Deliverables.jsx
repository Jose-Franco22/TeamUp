import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  DELIVERABLE_LINK_TTL_SECONDS,
  getDeliverableFileUrls,
  getDeliverables,
  postDeliverableComment,
  reviewDeliverable,
  submitDeliverable,
} from '../api/client';
import {
  COMMENT_MAX,
  DELIVERABLE_ACCEPT,
  DELIVERABLE_STATUS,
  formatBytes,
  validateComment,
  validateDeliverableFile,
  validateDeliverableLink,
  validateReview,
} from '../lib/deliverables';
import { charCount } from '../lib/validation';
import { deliverableAnchor, formatDue } from './Milestones';

// Milestone deliverables (issue #57). One entry per milestone an admin marked
// as needing a deliverable, each with its status, every version, and the
// thread. The team sees a form to hand in a new version; the project's
// adviser (`asAdviser`, from the teams-you-advise list) sees Approve and
// Request changes on the newest version instead. The database refuses each
// side the other's controls anyway — review_deliverable() and the upload
// policy — so what this decides is only what is worth offering.

// Shown beside the list when a write succeeded but reading the list back
// didn't. The list stays on screen: swapping it for an error made a saved
// submission look lost, and students resubmitted (#95 review). The same
// shape as NextStepManager's (PR #80).
export const STALE_LIST = 'The list below couldn’t be refreshed — reload to see the change.';

// Re-mint download links this long before they expire.
const LINK_REFRESH_MARGIN_SECONDS = 10 * 60;

export function DeliverableStatus({ status }) {
  const { label, tone } = DELIVERABLE_STATUS[status] ?? DELIVERABLE_STATUS.not_submitted;
  return (
    <span className={`pill deliverable-status ${tone}`} data-status={status}>
      {label}
    </span>
  );
}

// Late is said in words as well as colour, and per version: a team that was
// late once and resubmitted on time should see both.
export function LateTag() {
  return <span className="pill danger deliverable-late">Late</span>;
}

// Only ever an http(s) link — submit_deliverable() refuses anything else, and
// this is the second lock on the same door, for a row written some other way.
function SafeLink({ href }) {
  if (!/^https?:\/\//i.test(href ?? '')) return <span>{href}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {href}
    </a>
  );
}

function formatWhen(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function Deliverables({ projectId, asAdviser = false }) {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // versionId -> signed URL, or null where none could be minted. A version
  // missing from the map is still being minted.
  const [links, setLinks] = useState({});
  const listRef = useRef(null);
  // Every read of the list takes a ticket; a reply is dropped once a newer
  // one has landed, so a slow first load can't overwrite a refresh.
  const seq = useRef(0);

  const mintLinks = useCallback(async (rows) => {
    const versions = (rows ?? []).flatMap((d) => d.versions);
    try {
      setLinks(await getDeliverableFileUrls(versions));
    } catch {
      // Every file reads "unavailable" rather than the list failing: the
      // versions and the thread are still worth showing.
      setLinks(Object.fromEntries(versions.filter((v) => v.kind === 'file').map((v) => [v.id, null])));
    }
  }, []);

  // `afterWrite` marks a refresh that follows a write which already
  // succeeded. A failure then keeps the list on screen and returns false,
  // and the caller says the list is stale; only a first load that fails
  // shows an error in place of the list.
  const load = useCallback(
    async ({ afterWrite = false } = {}) => {
      const ticket = ++seq.current;
      try {
        const rows = await getDeliverables(projectId);
        if (ticket !== seq.current) return true;
        listRef.current = rows;
        setList(rows);
        setLoadError(null);
        mintLinks(rows);
        return true;
      } catch (err) {
        if (ticket !== seq.current) return true;
        if (!afterWrite && !listRef.current) setLoadError(err);
        return false;
      }
    },
    [projectId, mintLinks]
  );

  useEffect(() => {
    listRef.current = null;
    load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  // A page left open keeps working downloads.
  useEffect(() => {
    const every = (DELIVERABLE_LINK_TTL_SECONDS - LINK_REFRESH_MARGIN_SECONDS) * 1000;
    const timer = setInterval(() => mintLinks(listRef.current), every);
    return () => clearInterval(timer);
  }, [mintLinks]);

  // "Hand it in" (Announcements, the deadline banner) arrives here as
  // /team#deliverable-<milestone>. Once the list has rendered, bring that
  // deliverable into view and move focus to its heading, so a keyboard or
  // screen-reader user lands there too. Once per navigation, keyed on
  // location.key: a refresh after a write must not yank the page back, but
  // pressing the banner's button again while already on /team should.
  // Only the student's own team carries the anchors — see Deliverable.
  const location = useLocation();
  const scrolledFor = useRef(null);
  useEffect(() => {
    if (asAdviser || !list || scrolledFor.current === location.key) return;
    const target = location.hash ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    if (!target || !target.classList.contains('deliverable')) return;
    scrolledFor.current = location.key;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView?.({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    target.querySelector('h3')?.focus({ preventScroll: true });
  }, [list, location.key, location.hash, asAdviser]);

  const afterWrite = () => load({ afterWrite: true });

  // Nothing is due, so there's nothing to show; an empty card would read as
  // something missing.
  if (list && list.length === 0) return null;

  return (
    <section className="card deliverables" aria-label="Deliverables">
      <h2>Deliverables</h2>
      {!list && loadError ? (
        <p className="inline-error" role="alert">{loadError.message}</p>
      ) : !list ? (
        <p className="desc" role="status">Loading deliverables…</p>
      ) : (
        <>
          <p className="desc">
            {asAdviser
              ? 'Review the newest version of each deliverable. Approving or requesting changes tells the team.'
              : 'Anyone on the team can hand these in. Each new submission is kept as a version, so nothing earlier is lost.'}
          </p>
          {list.map((d) => (
            <Deliverable
              key={d.milestone_id}
              projectId={projectId}
              deliverable={d}
              links={links}
              asAdviser={asAdviser}
              onChanged={afterWrite}
            />
          ))}
        </>
      )}
    </section>
  );
}

function Deliverable({ projectId, deliverable: d, links, asAdviser, onChanged }) {
  const headingId = useId();
  const pastDue = new Date(d.due_at) < new Date();
  const latest = d.versions[0] ?? null;

  return (
    // The anchor "Hand it in" points at. Only on the student's own team: an
    // adviser's view of other teams repeats the same milestones, and two
    // elements with one id would make the target ambiguous.
    <article
      className="deliverable"
      id={asAdviser ? undefined : deliverableAnchor(d.milestone_id)}
      aria-labelledby={headingId}
    >
      <header className="deliverable-head">
        {/* Focusable from script only, so arriving from "Hand it in" puts
            keyboard and screen-reader users at this deliverable. */}
        <h3 id={headingId} tabIndex={-1}>{d.name}</h3>
        <DeliverableStatus status={d.status} />
        {d.is_late && <LateTag />}
        <span className="meta">Due {formatDue(d.due_at)}</span>
      </header>
      {d.message && <p className="milestone-message">{d.message}</p>}

      {asAdviser ? (
        latest ? (
          <ReviewPanel projectId={projectId} deliverable={d} latest={latest} onReviewed={onChanged} />
        ) : (
          <p className="hint">Nothing has been submitted for this yet.</p>
        )
      ) : (
        <SubmitForm projectId={projectId} deliverable={d} pastDue={pastDue} onSubmitted={onChanged} />
      )}

      {d.versions.length > 0 && <VersionHistory name={d.name} versions={d.versions} links={links} />}

      <Thread projectId={projectId} deliverable={d} asAdviser={asAdviser} onPosted={onChanged} />
    </article>
  );
}

function SubmitForm({ projectId, deliverable: d, pastDue, onSubmitted }) {
  const id = useId();
  const fileInput = useRef(null);
  const [mode, setMode] = useState('file');
  const [file, setFile] = useState(null);
  const [link, setLink] = useState('');
  const [linkTouched, setLinkTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [done, setDone] = useState(null);

  // A file is judged the moment it's picked: there's no point letting
  // someone wait on a 40 MB upload the bucket is going to refuse.
  const fileError = mode === 'file' && file ? validateDeliverableFile(file) : null;
  const linkError = mode === 'link' && linkTouched ? validateDeliverableLink(link) : null;
  const ready = mode === 'file' ? Boolean(file) && !fileError : !validateDeliverableLink(link);

  function reset() {
    setFile(null);
    setLink('');
    setLinkTouched(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  function switchMode(next) {
    setMode(next);
    reset();
    setServerError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLinkTouched(true);
    if (!ready) return;
    setSaving(true);
    setServerError(null);
    setDone(null);
    let row;
    try {
      row = await submitDeliverable(projectId, d.milestone_id, mode === 'file' ? { file } : { link });
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
      return;
    }
    reset();
    const saved = `Version ${row.version} submitted${row.is_late ? ' — marked late' : ''}.`;
    setDone(saved);
    const fresh = await onSubmitted();
    if (!fresh) setDone(`${saved} ${STALE_LIST}`);
    setSaving(false);
  }

  const hasVersions = d.versions.length > 0;

  return (
    <form className="deliverable-form" onSubmit={handleSubmit} noValidate aria-label={`Submit ${d.name}`}>
      <fieldset className="deliverable-mode">
        <legend className="sr-only">Submit as</legend>
        <label>
          <input type="radio" name={`${id}-mode`} checked={mode === 'file'} onChange={() => switchMode('file')} />
          Upload a file
        </label>
        <label>
          <input type="radio" name={`${id}-mode`} checked={mode === 'link'} onChange={() => switchMode('link')} />
          Paste a link
        </label>
      </fieldset>

      {mode === 'file' ? (
        <div className="field">
          <label htmlFor={`${id}-file`}>File</label>
          <p className="hint" id={`${id}-file-hint`}>PDF, DOCX or PPTX, up to 25 MB.</p>
          <input
            id={`${id}-file`}
            ref={fileInput}
            type="file"
            accept={DELIVERABLE_ACCEPT}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setServerError(null);
              setDone(null);
            }}
            aria-invalid={fileError ? 'true' : undefined}
            aria-describedby={fileError ? `${id}-file-hint ${id}-file-error` : `${id}-file-hint`}
          />
          {file && !fileError && (
            <p className="hint">
              {file.name} · {formatBytes(file.size)}
            </p>
          )}
          {fileError && (
            <p className="inline-error" id={`${id}-file-error`} role="alert">{fileError}</p>
          )}
        </div>
      ) : (
        <div className="field">
          <label htmlFor={`${id}-link`}>Link</label>
          <p className="hint" id={`${id}-link-hint`}>A shared document, slides or repository, starting with https://.</p>
          <input
            id={`${id}-link`}
            type="url"
            inputMode="url"
            value={link}
            onChange={(e) => {
              setLink(e.target.value);
              setServerError(null);
              setDone(null);
            }}
            onBlur={() => setLinkTouched(true)}
            aria-invalid={linkError ? 'true' : undefined}
            aria-describedby={linkError ? `${id}-link-hint ${id}-link-error` : `${id}-link-hint`}
          />
          {linkError && (
            <p className="inline-error" id={`${id}-link-error`} role="alert">{linkError}</p>
          )}
        </div>
      )}

      {pastDue && (
        <p className="hint">The due date has passed. You can still submit, and it will be marked late.</p>
      )}

      <div className="foot">
        <button className="btn" type="submit" disabled={saving || !ready}>
          {saving ? 'Submitting…' : hasVersions ? 'Submit a new version' : 'Submit'}
        </button>
        {done && <span className="meta" role="status">{done}</span>}
        {serverError && <span className="inline-error" role="alert">{serverError}</span>}
      </div>
    </form>
  );
}

// The adviser's decision on the newest version. The version number goes with
// it, and review_deliverable() refuses if the team has submitted a newer one
// in the meantime, so the verdict is always about what was on screen.
function ReviewPanel({ projectId, deliverable: d, latest, onReviewed }) {
  const id = useId();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  async function decide(decision) {
    const invalid = validateReview(decision, note);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSaving(decision);
    setError(null);
    setDone(null);
    try {
      await reviewDeliverable(projectId, d.milestone_id, latest.version, decision, note);
    } catch (err) {
      setError(err.message);
      setSaving(null);
      return;
    }
    setNote('');
    const said =
      decision === 'approved'
        ? `Approved version ${latest.version}. The team has been told.`
        : `Asked for changes to version ${latest.version}. The team has been told.`;
    setDone(said);
    const fresh = await onReviewed();
    if (!fresh) setDone(`${said} ${STALE_LIST}`);
    setSaving(null);
  }

  return (
    <div className="review-panel" role="group" aria-label={`Review version ${latest.version} of ${d.name}`}>
      <h4>Review version {latest.version}</h4>
      <div className="field">
        <label htmlFor={`${id}-note`}>
          Note to the team <span className="opt">Required to request changes</span>
        </label>
        <textarea
          id={`${id}-note`}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? `${id}-note-error` : undefined}
        />
      </div>
      <div className="foot">
        <button type="button" className="btn" disabled={Boolean(saving)} onClick={() => decide('approved')}>
          {saving === 'approved' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={Boolean(saving)}
          onClick={() => decide('changes_requested')}
        >
          {saving === 'changes_requested' ? 'Sending…' : 'Request changes'}
        </button>
        {done && <span className="meta" role="status">{done}</span>}
        {error && (
          <span className="inline-error" id={`${id}-note-error`} role="alert">{error}</span>
        )}
      </div>
    </div>
  );
}

// Each stored file is a real <a href download>, with its signed URL minted
// before the click. A click handler that awaited the URL and then called
// window.open() ran outside the click's user gesture, so Safari, Firefox and
// mobile browsers blocked it and the button did nothing (#95 review). A link
// also gets right-click and keyboard access for free.
function VersionHistory({ name, versions, links }) {
  return (
    <div className="deliverable-versions">
      <h4>Version history</h4>
      <ol aria-label={`Versions of ${name}`} reversed>
        {versions.map((v) => {
          const minted = Object.hasOwn(links, v.id);
          const href = links[v.id];
          return (
            <li key={v.id} className="deliverable-version">
              <span className="version-number">Version {v.version}</span>
              <span className="version-what">
                {v.kind === 'file' ? (
                  <>
                    {href ? (
                      <a className="download-link" href={href} download={v.file_name} aria-label={`Download ${v.file_name}`}>
                        {v.file_name}
                      </a>
                    ) : (
                      <span>{v.file_name}</span>
                    )}{' '}
                    <span className="sub">
                      {formatBytes(v.file_size)}
                      {!minted && ' · preparing the download…'}
                    </span>
                    {minted && !href && (
                      <span className="inline-error" role="alert">
                        This file can’t be downloaded right now — reload to try again.
                      </span>
                    )}
                  </>
                ) : (
                  <SafeLink href={v.link_url} />
                )}
              </span>
              <span className="sub">
                {v.submitted_by_name ?? 'A former member'} · {formatWhen(v.submitted_at)}
              </span>
              <span className="version-tags">
                <DeliverableStatus status={v.status} />
                {v.is_late && <LateTag />}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Thread({ projectId, deliverable: d, asAdviser, onPosted }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [stale, setStale] = useState(false);

  const error = touched ? validateComment(body) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (validateComment(body)) return;
    setSaving(true);
    setServerError(null);
    setStale(false);
    try {
      await postDeliverableComment(projectId, d.milestone_id, body);
    } catch (err) {
      setServerError(err.message);
      setSaving(false);
      return;
    }
    setBody('');
    setTouched(false);
    const fresh = await onPosted();
    setStale(!fresh);
    setSaving(false);
  }

  const label = asAdviser ? 'Comment' : 'Reply';

  return (
    <div className="deliverable-thread">
      <h4>Comments</h4>
      {d.comments.length === 0 ? (
        <p className="desc">No comments yet.</p>
      ) : (
        <ul className="thread" aria-label={`Comments on ${d.name}`}>
          {d.comments.map((c) => (
            <li key={c.id}>
              <div className="thread-meta">
                <b>{c.author_name ?? 'A former member'}</b>
                <span className="sub">
                  {formatWhen(c.created_at)}
                  {c.version != null && ` · on version ${c.version}`}
                </span>
                {c.decision && <DeliverableStatus status={c.decision} />}
              </div>
              {c.body && <p className="thread-body">{c.body}</p>}
            </li>
          ))}
        </ul>
      )}

      <form className="thread-reply" onSubmit={handleSubmit} noValidate aria-label={`${label} on ${d.name}`}>
        <div className="field">
          <label htmlFor={`${id}-reply`}>{label}</label>
          <textarea
            id={`${id}-reply`}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setServerError(null);
            }}
            onBlur={() => body !== '' && setTouched(true)}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? `${id}-reply-error` : undefined}
          />
          <p className={charCount(body.trim()) > COMMENT_MAX ? 'counter over' : 'counter'}>
            {charCount(body.trim())}/{COMMENT_MAX}
          </p>
          {error && (
            <p className="inline-error" id={`${id}-reply-error`} role="alert">{error}</p>
          )}
        </div>
        <div className="foot">
          <button className="btn ghost" type="submit" disabled={saving}>
            {saving ? 'Posting…' : asAdviser ? 'Post comment' : 'Post reply'}
          </button>
          {stale && <span className="meta" role="status">Posted. {STALE_LIST}</span>}
          {serverError && <span className="inline-error" role="alert">{serverError}</span>}
        </div>
      </form>
    </div>
  );
}
