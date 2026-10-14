import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { deleteMilestone, getMilestones, saveMilestone } from '../api/client';
import { MILESTONE_MESSAGE_MAX, ValidationError, charCount, validateMilestone } from '../lib/validation';

// The class schedule (issue #38). Admins keep it on the dashboard; students
// see what's coming up in a banner on every page.

export function formatDue(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// A datetime-local input wants local "YYYY-MM-DDTHH:mm", not ISO.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// --- Student banner --------------------------------------------------------

// The next few milestones, and whether rosters have locked. Renders nothing
// when there's nothing scheduled. A failed load keeps whatever was shown
// last: it's an extra on top of whatever page is open. Refreshed on every
// page change, like the request alerts, so an admin's edit shows up
// without a reload; the old list stays up meanwhile, so nothing flashes.
export function MilestoneBanner({ limit = 3 }) {
  const { pathname } = useLocation();
  const [list, setList] = useState(null);

  useEffect(() => {
    let live = true;
    getMilestones()
      .then((rows) => live && setList(rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname]);

  if (!list || list.length === 0) return null;

  const now = new Date();
  const upcoming = list.filter((m) => new Date(m.due_at) > now).slice(0, limit);
  const deadline = list.find((m) => m.is_formation_deadline);
  const locked = deadline && new Date(deadline.due_at) <= now;
  if (upcoming.length === 0 && !locked) return null;

  return (
    <section className="card milestone-banner" aria-label="Upcoming deadlines">
      {locked && (
        <p className="milestone-locked">
          Team formation closed {formatDue(deadline.due_at)}. Rosters are locked — ask an admin if
          you need a change.
        </p>
      )}
      {upcoming.length > 0 && (
        <ul className="milestone-list">
          {upcoming.map((m) => (
            <li key={m.id}>
              <span className="milestone-name">
                {m.name}
                {m.is_formation_deadline && <span className="pill warn">Rosters lock</span>}
              </span>
              <span className="milestone-due">{formatDue(m.due_at)}</span>
              {m.message && <p className="milestone-message">{m.message}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Admin manager -----------------------------------------------------------

const BLANK = { id: null, name: '', due_at: '', is_formation_deadline: false, message: '' };

export function MilestoneManager() {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [showErrors, setShowErrors] = useState(false);
  // The message is the free-text field, so its error shows as soon as the
  // admin leaves it rather than waiting for Save.
  const [messageTouched, setMessageTouched] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [message, setMessage] = useState(null);

  async function load() {
    try {
      setList(await getMilestones());
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const { errors } = validateMilestone(form);
  const errorFor = (field) =>
    showErrors || (field === 'message' && messageTouched) ? errors[field] : undefined;

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setServerError(null);
    setMessage(null);
  }

  function startEdit(m) {
    setForm({
      id: m.id,
      name: m.name,
      due_at: toLocalInput(m.due_at),
      is_formation_deadline: m.is_formation_deadline,
      message: m.message ?? '',
    });
    setShowErrors(false);
    setMessageTouched(false);
    setServerError(null);
    setMessage(null);
  }

  function cancelEdit() {
    setForm(BLANK);
    setShowErrors(false);
    setMessageTouched(false);
    setServerError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const saved = await saveMilestone(form);
      setMessage(form.id ? `Saved “${saved.name}”.` : `Added “${saved.name}”.`);
      setForm(BLANK);
      setShowErrors(false);
      setMessageTouched(false);
      await load();
    } catch (err) {
      setServerError(err instanceof ValidationError ? Object.values(err.fieldErrors)[0] : err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(m) {
    setConfirmingDelete(null);
    try {
      await deleteMilestone(m.id);
      if (form.id === m.id) setForm(BLANK);
      setMessage(`Deleted “${m.name}”.`);
      await load();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <section aria-label="Milestones">
      <div className="card">
        {loadError ? (
          <p className="inline-error" role="alert">{loadError.message}</p>
        ) : !list ? (
          <p className="desc" role="status">Loading milestones…</p>
        ) : list.length === 0 ? (
          <p className="desc">No milestones yet.</p>
        ) : (
          <ul className="admin-list milestone-admin-list" aria-label="Milestones">
            {list.map((m) => (
              <li key={m.id}>
                <div>
                  <b>{m.name}</b>
                  {m.is_formation_deadline && <span className="pill warn">Formation deadline</span>}
                  <span className="admin-secondary">{formatDue(m.due_at)}</span>
                  {m.message && <p className="milestone-message">{m.message}</p>}
                </div>
                <span className="acts">
                  {confirmingDelete === m.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => handleDelete(m)}>
                        Delete “{m.name}”
                      </button>
                      <button type="button" className="btn quiet" onClick={() => setConfirmingDelete(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" className="btn ghost" onClick={() => startEdit(m)} aria-label={`Edit ${m.name}`}>
                        Edit
                      </button>
                      <button type="button" className="btn quiet" onClick={() => setConfirmingDelete(m.id)} aria-label={`Delete ${m.name}`}>
                        Delete
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        <form className="milestone-form" onSubmit={handleSubmit} noValidate aria-label={form.id ? 'Edit milestone' : 'Add a milestone'}>
          <h3>{form.id ? 'Edit milestone' : 'Add a milestone'}</h3>
          <div className="field">
            <label htmlFor="milestone-name">Name</label>
            <input
              id="milestone-name"
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              aria-invalid={errorFor('name') ? 'true' : undefined}
              aria-describedby={errorFor('name') ? 'milestone-name-error' : undefined}
            />
            {errorFor('name') && (
              <p className="inline-error" id="milestone-name-error" role="alert">{errorFor('name')}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="milestone-due">Due</label>
            <input
              id="milestone-due"
              type="datetime-local"
              min="2000-01-01T00:00"
              max="2099-12-31T23:59"
              value={form.due_at}
              onChange={(e) => update({ due_at: e.target.value })}
              aria-invalid={errorFor('due_at') ? 'true' : undefined}
              aria-describedby={errorFor('due_at') ? 'milestone-due-error' : undefined}
            />
            {errorFor('due_at') && (
              <p className="inline-error" id="milestone-due-error" role="alert">{errorFor('due_at')}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="milestone-message">
              Message for students <span className="opt">Optional</span>
            </label>
            <p className="hint" id="milestone-message-hint">
              What's expected by this date — what to hand in, where, and anything to watch out for.
            </p>
            <textarea
              id="milestone-message"
              value={form.message}
              onChange={(e) => update({ message: e.target.value })}
              onBlur={() => setMessageTouched(true)}
              aria-invalid={errorFor('message') ? 'true' : undefined}
              aria-describedby={
                errorFor('message') ? 'milestone-message-hint milestone-message-error' : 'milestone-message-hint'
              }
            />
            <p className={charCount(form.message.trim()) > MILESTONE_MESSAGE_MAX ? 'counter over' : 'counter'}>
              {charCount(form.message.trim())}/{MILESTONE_MESSAGE_MAX}
            </p>
            {errorFor('message') && (
              <p className="inline-error" id="milestone-message-error" role="alert">{errorFor('message')}</p>
            )}
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={form.is_formation_deadline}
              onChange={(e) => update({ is_formation_deadline: e.target.checked })}
            />
            This is the team formation deadline — after it, students can't post projects, send
            requests, leave or remove members
          </label>
          <div className="foot">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add milestone'}
            </button>
            {form.id && (
              <button type="button" className="btn quiet" onClick={cancelEdit}>
                Cancel
              </button>
            )}
            {message && <span className="meta" role="status">{message}</span>}
            {serverError && <span className="inline-error" role="alert">{serverError}</span>}
          </div>
        </form>
      </div>
    </section>
  );
}
