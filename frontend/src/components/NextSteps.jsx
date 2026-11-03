import { useEffect, useRef, useState } from 'react';
import { deleteNextStep, getNextSteps, reorderNextSteps, saveNextStep } from '../api/client';
import { NEXT_STEP_TITLE_MAX, ValidationError, charCount, validateNextStep } from '../lib/validation';
import { formatDue, toLocalInput } from './Milestones';

// The next-steps checklist (issue #42). Admins keep one list for the
// semester; every complete team works through it on their team page (#30).

const BLANK = { id: null, title: '', due_at: '' };

export function NextStepManager() {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [moving, setMoving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState(null);

  // Every write to `list` takes a ticket, and a reply is dropped once a newer
  // one has landed. Without this, a reorder reply computed before an insert
  // can come back after the insert's refresh and put the pre-insert list
  // back, so the new step disappears until the page is reloaded.
  const writeSeq = useRef(0);

  // `afterWrite` marks a refresh that follows a write which already
  // succeeded. Those must not take the list away: the card would swap it for
  // an error while the message underneath still reported success. The caller
  // gets false and says the list is stale instead.
  async function load({ afterWrite = false } = {}) {
    const ticket = ++writeSeq.current;
    try {
      const rows = await getNextSteps();
      if (ticket !== writeSeq.current) return true;
      setList(rows);
      setLoadError(null);
      return true;
    } catch (err) {
      if (afterWrite) return false;
      setLoadError(err);
      return false;
    }
  }

  const STALE = 'The list below couldn’t be refreshed — reload to see the change.';

  useEffect(() => {
    load();
  }, []);

  const { errors } = validateNextStep(form);
  const errorFor = (field) => (showErrors ? errors[field] : undefined);

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setServerError(null);
    setMessage(null);
  }

  function startEdit(s) {
    setForm({ id: s.id, title: s.title, due_at: toLocalInput(s.due_at) });
    setShowErrors(false);
    setServerError(null);
    setMessage(null);
  }

  function cancelEdit() {
    setForm(BLANK);
    setShowErrors(false);
    setServerError(null);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setShowErrors(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const saved = await saveNextStep(form);
      setForm(BLANK);
      setShowErrors(false);
      const fresh = await load({ afterWrite: true });
      setMessage(form.id ? `Saved “${saved.title}”.` : `Added “${saved.title}”.`);
      if (!fresh) setServerError(STALE);
    } catch (err) {
      setServerError(err instanceof ValidationError ? Object.values(err.fieldErrors)[0] : err.message);
    } finally {
      setSaving(false);
    }
  }

  // The new order shows straight away; the server's answer replaces it, and
  // if the move is refused the list reloads to what's really stored.
  async function move(index, by) {
    const next = list.slice();
    const [step] = next.splice(index, 1);
    next.splice(index + by, 0, step);
    const ticket = ++writeSeq.current;
    setList(next);
    setMoving(true);
    setServerError(null);
    setMessage(null);
    try {
      const rows = await reorderNextSteps(next.map((s) => s.id));
      // Dropped if an add, edit or delete has refreshed the list since.
      if (ticket === writeSeq.current) setList(rows);
    } catch (err) {
      setServerError(err.message);
      await load();
    } finally {
      setMoving(false);
    }
  }

  // Keeps a second click from deleting the same step again while the first is
  // still on its way. A ref rather than `deleting` alone: two clicks in the
  // same tick both read the same render's state, so the state flag lets the
  // second one through. `deleting` still drives the disabled button.
  const deletingRef = useRef(false);

  async function handleDelete(s) {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteNextStep(s.id);
      setConfirmingDelete(null);
      // cancelEdit() rather than setForm(BLANK): it clears showErrors and
      // serverError too, so a validation error from the step being edited
      // can't carry over onto the blank Add form.
      if (form.id === s.id) cancelEdit();
      const fresh = await load({ afterWrite: true });
      setMessage(`Deleted “${s.title}”.`);
      if (!fresh) setServerError(STALE);
    } catch (err) {
      setConfirmingDelete(null);
      setServerError(err.message);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const titleLength = charCount(form.title.trim());

  return (
    <section aria-label="Next steps">
      <div className="card">
        {loadError ? (
          <p className="inline-error" role="alert">{loadError.message}</p>
        ) : !list ? (
          <p className="desc" role="status">Loading next steps…</p>
        ) : list.length === 0 ? (
          <p className="desc">No next steps yet. Teams see this checklist once they're complete.</p>
        ) : (
          <ol className="admin-list next-step-list" aria-label="Next steps">
            {list.map((s, i) => (
              <li key={s.id}>
                <div>
                  <b>{s.title}</b>
                  <span className="admin-secondary">{s.due_at ? `Due ${formatDue(s.due_at)}` : 'No due date'}</span>
                </div>
                <span className="acts">
                  {confirmingDelete === s.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => handleDelete(s)} disabled={deleting}>
                        Delete “{s.title}”
                      </button>
                      <button type="button" className="btn quiet" onClick={() => setConfirmingDelete(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => move(i, -1)}
                        disabled={moving || i === 0}
                        aria-label={`Move ${s.title} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn quiet"
                        onClick={() => move(i, 1)}
                        disabled={moving || i === list.length - 1}
                        aria-label={`Move ${s.title} down`}
                      >
                        ↓
                      </button>
                      <button type="button" className="btn ghost" onClick={() => startEdit(s)} aria-label={`Edit ${s.title}`}>
                        Edit
                      </button>
                      <button type="button" className="btn quiet" onClick={() => setConfirmingDelete(s.id)} aria-label={`Delete ${s.title}`}>
                        Delete
                      </button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}

        <form className="milestone-form" onSubmit={handleSubmit} noValidate aria-label={form.id ? 'Edit step' : 'Add a step'}>
          <h3>{form.id ? 'Edit step' : 'Add a step'}</h3>
          <div className="field">
            <label htmlFor="next-step-title">Step</label>
            <input
              id="next-step-title"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              aria-invalid={errorFor('title') ? 'true' : undefined}
              aria-describedby={errorFor('title') ? 'next-step-title-error' : undefined}
            />
            <p className={titleLength > NEXT_STEP_TITLE_MAX ? 'counter over' : 'counter'}>
              {titleLength}/{NEXT_STEP_TITLE_MAX}
            </p>
            {errorFor('title') && (
              <p className="inline-error" id="next-step-title-error" role="alert">{errorFor('title')}</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="next-step-due">
              Due <span className="opt">Optional</span>
            </label>
            <input
              id="next-step-due"
              type="datetime-local"
              min="2000-01-01T00:00"
              max="2099-12-31T23:59"
              value={form.due_at}
              onChange={(e) => update({ due_at: e.target.value })}
              aria-invalid={errorFor('due_at') ? 'true' : undefined}
              aria-describedby={errorFor('due_at') ? 'next-step-due-error' : undefined}
            />
            {errorFor('due_at') && (
              <p className="inline-error" id="next-step-due-error" role="alert">{errorFor('due_at')}</p>
            )}
          </div>
          <div className="foot">
            <button className="btn" type="submit" disabled={saving}>
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add step'}
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
