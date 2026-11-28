// The admin's semester controls (issue #61): which semester is current,
// closing it, and starting the next one.
//
// Closing archives a whole class, so the dialog makes the admin do three
// things in order before the button works: it offers the roster export
// first (#40 — once the semester closes the export only covers the next
// one), it says exactly how many teams and students will be archived and
// what else will be cancelled, and it keeps the button disabled until the
// semester's name is typed exactly. close_semester() checks the typed name
// again, so the disabled button is a courtesy, not the safeguard.
//
// Between closing one semester and starting the next nothing is current:
// Browse is empty and the panel shows the new-semester form instead.
import { useEffect, useRef, useState } from 'react';
import {
  closeSemester,
  getPastSemesters,
  getSemesterClosePreview,
  reopenSemester,
  startSemester,
} from '../api/client';
import { ValidationError } from '../lib/validation';
import ExportRosters from './ExportRosters';
import useAsync from './useAsync';
import { ErrorState, Loading } from './States';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "Aug 24 – Dec 12, 2026". Dates are calendar days, not moments, so they are
// read at noon UTC and printed in UTC: a viewer west of Greenwich would
// otherwise see the day before.
export function formatSemesterDates({ starts_on, ends_on }) {
  const day = (d, withYear) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}),
    });
  const sameYear = starts_on.slice(0, 4) === ends_on.slice(0, 4);
  return `${day(starts_on, !sameYear)} – ${day(ends_on, true)}`;
}

export function CloseSemesterDialog({ preview, onCancel, onClosed }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dialogRef = useRef(null);
  const matches = typed === preview.name;

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function confirm() {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      onClosed(await closeSemester(preview.semester_id, typed));
    } catch (err) {
      setError(err?.message || 'The semester could not be closed. Try again.');
      setBusy(false);
    }
  }

  return (
    <div className="tour-backdrop">
      <div
        className="tour semester-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-semester-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(e) => e.key === 'Escape' && !busy && onCancel()}
      >
        <h2 id="close-semester-title">Close {preview.name}?</h2>

        <ol className="semester-steps">
          <li>
            <h3>Export the rosters first</h3>
            <p className="desc">
              Once {preview.name} is closed, the export covers the next semester only. Save this
              semester&apos;s teams and members before you go on.
            </p>
            <ExportRosters label={`Export ${preview.name} rosters`} />
          </li>
          <li>
            <h3>Check what closing does</h3>
            <ul className="semester-impact" aria-label="What closing will do">
              <li>
                <strong>{plural(preview.teams, 'team')}</strong> and{' '}
                <strong>{plural(preview.students, 'student')}</strong> will be archived. They stay
                readable under Past semesters, and nothing is deleted.
              </li>
              <li>{plural(preview.pending_join_requests, 'pending join request')} will be cancelled.</li>
              <li>{plural(preview.pending_adviser_requests, 'pending adviser request')} will be cancelled.</li>
              <li>{plural(preview.adviser_links, 'adviser link')} will end.</li>
              <li>Every student will be free to join a team in the next semester.</li>
            </ul>
          </li>
          <li>
            <div className="field">
              <label htmlFor="confirm-semester-name">
                Type <strong>{preview.name}</strong> to confirm
              </label>
              <input
                id="confirm-semester-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                disabled={busy}
              />
            </div>
          </li>
        </ol>

        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}

        <div className="tour-foot">
          <button type="button" className="btn quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn danger" onClick={confirm} disabled={!matches || busy}>
            {busy ? 'Closing…' : `Close ${preview.name}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// Undo a close (50_semesters.sql, decision 8): only the semester closed
// last, and only until the next one starts — which is exactly while this
// panel shows no current semester. For an admin, past_semesters() lists
// every closed semester newest first, so the first is the one.
export function ReopenLast({ onReopened }) {
  const { data } = useAsync(getPastSemesters, []);
  const [state, setState] = useState(null); // null | 'confirming' | 'working' | message
  const last = data?.[0];
  if (!last) return null;

  async function reopen() {
    setState('working');
    try {
      onReopened(await reopenSemester(last.id));
    } catch (err) {
      setState(err?.message || 'The semester could not be reopened. Try again.');
    }
  }

  return (
    <p className="hint semester-reopen">
      Closed {last.name} by mistake? Reopening makes its teams editable again. Requests the close
      cancelled stay cancelled.
      {state === 'confirming' || state === 'working' ? (
        <>
          <button type="button" className="btn ghost" onClick={reopen} disabled={state === 'working'}>
            {state === 'working' ? 'Reopening…' : `Yes, reopen ${last.name}`}
          </button>
          <button type="button" className="btn quiet" onClick={() => setState(null)} disabled={state === 'working'}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="btn ghost" onClick={() => setState('confirming')}>
          Reopen {last.name}
        </button>
      )}
      {state && !['confirming', 'working'].includes(state) && (
        <span className="inline-error" role="alert">
          {state}
        </span>
      )}
    </p>
  );
}

const EMPTY_FORM = { name: '', starts_on: '', ends_on: '', formation_deadline: '' };

export function NewSemesterForm({ onStarted }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setServerError(null);
    try {
      onStarted(await startSemester(form));
      setForm(EMPTY_FORM);
    } catch (err) {
      if (err instanceof ValidationError) setErrors(err.fieldErrors);
      else setServerError(err?.message || 'The semester could not be started. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const field = (id, label, type, key, hint) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {hint && (
        <p className="hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      <input
        id={id}
        type={type}
        value={form[key]}
        onChange={set(key)}
        aria-invalid={errors[key] ? 'true' : undefined}
        aria-describedby={[hint && `${id}-hint`, errors[key] && `${id}-error`].filter(Boolean).join(' ') || undefined}
      />
      {errors[key] && (
        <p className="inline-error" id={`${id}-error`} role="alert">
          {errors[key]}
        </p>
      )}
    </div>
  );

  return (
    <form className="card semester-form" onSubmit={submit} noValidate aria-label="Start the next semester">
      <h3>Start the next semester</h3>
      {field('semester-name', 'Name', 'text', 'name', 'Like "Spring 2027". Admins type it to close the semester.')}
      <div className="semester-dates">
        {field('semester-starts', 'Starts', 'date', 'starts_on')}
        {field('semester-ends', 'Ends', 'date', 'ends_on')}
      </div>
      {field(
        'semester-deadline',
        'Team formation deadline',
        'datetime-local',
        'formation_deadline',
        'Rosters lock at this moment. It shows on the Milestones tab, where you can move it later.'
      )}
      {serverError && (
        <p className="inline-error" role="alert">
          {serverError}
        </p>
      )}
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Starting…' : 'Start semester'}
      </button>
    </form>
  );
}

// `onChange` is called after a close or a start, so the page around it can
// reload what it shows from the semester that is now current.
export default function SemesterPanel({ onChange }) {
  const { data: preview, loading, error, reload } = useAsync(getSemesterClosePreview, []);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(null);

  return (
    <section aria-labelledby="semester-heading" className="semester-panel">
      <h2 className="section" id="semester-heading">
        Semester
      </h2>
      {loading ? (
        <Loading label="Loading the semester" />
      ) : error ? (
        <ErrorState error={error} onRetry={reload} />
      ) : preview ? (
        <div className="card semester-current">
          <div>
            <p className="semester-name">{preview.name}</p>
            <p className="desc">
              The current semester · {formatSemesterDates(preview)} · {plural(preview.teams, 'team')},{' '}
              {plural(preview.students, 'student')}
            </p>
          </div>
          <button type="button" className="btn ghost" onClick={() => setClosing(true)}>
            Close semester
          </button>
        </div>
      ) : (
        <>
          <p className="desc semester-gap" role="status">
            {closed
              ? `${closed.name} is closed: ${plural(closed.teams, 'team')} and ${plural(closed.students, 'student')} archived. `
              : ''}
            No semester is open. Students can&apos;t post projects or join teams until the next one starts.
          </p>
          <ReopenLast
            onReopened={() => {
              setClosed(null);
              reload();
              onChange?.();
            }}
          />
          <NewSemesterForm
            onStarted={() => {
              setClosed(null);
              reload();
              onChange?.();
            }}
          />
        </>
      )}

      {closing && preview && (
        <CloseSemesterDialog
          preview={preview}
          onCancel={() => setClosing(false)}
          onClosed={(summary) => {
            setClosing(false);
            setClosed(summary);
            reload();
            onChange?.();
          }}
        />
      )}
    </section>
  );
}
