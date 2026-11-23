import { useEffect, useId, useRef, useState } from 'react';
import {
  getDeliverableFileUrl,
  getDeliverables,
  postDeliverableComment,
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
} from '../lib/deliverables';
import { charCount } from '../lib/validation';
import { formatDue } from './Milestones';

// Milestone deliverables on the team page (issue #57). One entry per
// milestone an admin marked as needing a deliverable, each with its status,
// a way to hand in a new version, every earlier version, and the thread.
//
// The adviser's Approve / Request changes controls arrive with #54 (PR #90),
// along with the adviser's access to this list. Until then nobody is shown
// them — the database has no function to call, and a button that can only
// fail is worse than none.

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

export default function Deliverables({ projectId }) {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);

  async function load() {
    try {
      setList(await getDeliverables(projectId));
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }

  useEffect(() => {
    let live = true;
    getDeliverables(projectId)
      .then((rows) => live && setList(rows))
      .catch((err) => live && setLoadError(err));
    return () => {
      live = false;
    };
  }, [projectId]);

  // Nothing is due, so there's nothing to show; an empty card would read as
  // something missing.
  if (list && list.length === 0 && !loadError) return null;

  return (
    <section className="card deliverables" aria-label="Deliverables">
      <h2>Deliverables</h2>
      {loadError ? (
        <p className="inline-error" role="alert">{loadError.message}</p>
      ) : !list ? (
        <p className="desc" role="status">Loading deliverables…</p>
      ) : (
        <>
          <p className="desc">
            Anyone on the team can hand these in. Each new submission is kept as a version, so
            nothing earlier is lost.
          </p>
          {list.map((d) => (
            <Deliverable key={d.milestone_id} projectId={projectId} deliverable={d} onChanged={load} />
          ))}
        </>
      )}
    </section>
  );
}

function Deliverable({ projectId, deliverable: d, onChanged }) {
  const headingId = useId();
  const pastDue = new Date(d.due_at) < new Date();

  return (
    <article className="deliverable" aria-labelledby={headingId}>
      <header className="deliverable-head">
        <h3 id={headingId}>{d.name}</h3>
        <DeliverableStatus status={d.status} />
        {d.is_late && <LateTag />}
        <span className="meta">Due {formatDue(d.due_at)}</span>
      </header>
      {d.message && <p className="milestone-message">{d.message}</p>}

      <SubmitForm
        projectId={projectId}
        deliverable={d}
        pastDue={pastDue}
        onSubmitted={onChanged}
      />

      {d.versions.length > 0 && <VersionHistory name={d.name} versions={d.versions} />}

      <Thread projectId={projectId} deliverable={d} onPosted={onChanged} />
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
    try {
      const row = await submitDeliverable(projectId, d.milestone_id, mode === 'file' ? { file } : { link });
      reset();
      setDone(`Version ${row.version} submitted${row.is_late ? ' — marked late' : ''}.`);
      await onSubmitted();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
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

function VersionHistory({ name, versions }) {
  // The version whose download is starting, or an error per version id.
  const [opening, setOpening] = useState(null);
  const [errors, setErrors] = useState({});

  async function download(v) {
    setOpening(v.id);
    setErrors((e) => ({ ...e, [v.id]: undefined }));
    try {
      const url = await getDeliverableFileUrl(v.file_path, v.file_name);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setErrors((e) => ({ ...e, [v.id]: err.message }));
    } finally {
      setOpening(null);
    }
  }

  return (
    <div className="deliverable-versions">
      <h4>Version history</h4>
      <ol aria-label={`Versions of ${name}`} reversed>
        {versions.map((v) => (
          <li key={v.id} className="deliverable-version">
            <span className="version-number">Version {v.version}</span>
            <span className="version-what">
              {v.kind === 'file' ? (
                <>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => download(v)}
                    disabled={opening === v.id}
                    aria-label={`Download ${v.file_name}`}
                  >
                    {v.file_name}
                  </button>{' '}
                  <span className="sub">{formatBytes(v.file_size)}</span>
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
            {errors[v.id] && <span className="inline-error" role="alert">{errors[v.id]}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Thread({ projectId, deliverable: d, onPosted }) {
  const id = useId();
  const [body, setBody] = useState('');
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  const error = touched ? validateComment(body) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (validateComment(body)) return;
    setSaving(true);
    setServerError(null);
    try {
      await postDeliverableComment(projectId, d.milestone_id, body);
      setBody('');
      setTouched(false);
      await onPosted();
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSaving(false);
    }
  }

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
              <p className="thread-body">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form className="thread-reply" onSubmit={handleSubmit} noValidate aria-label={`Reply on ${d.name}`}>
        <div className="field">
          <label htmlFor={`${id}-reply`}>Reply</label>
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
            {saving ? 'Posting…' : 'Post reply'}
          </button>
          {serverError && <span className="inline-error" role="alert">{serverError}</span>}
        </div>
      </form>
    </div>
  );
}
