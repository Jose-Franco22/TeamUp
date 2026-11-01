import { useEffect, useState } from 'react';
import {
  deleteNextStep,
  getNextSteps,
  getTeamChecklist,
  saveNextStep,
  setNextStepDone,
} from '../api/client';
import { ValidationError, validateNextStep } from '../lib/validation';
import { formatDue } from './Milestones';

// What a team does once it's full (issue #30). Admins keep one list for the
// class; each team checks the items off on its own, and sees who did each.

// A datetime-local input wants local "YYYY-MM-DDTHH:mm", not ISO.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isOverdue(step, now = new Date()) {
  return Boolean(step.due_at && !step.completed_at && new Date(step.due_at) < now);
}

// --- The team's checklist ----------------------------------------------------

export function TeamChecklist({ teamId }) {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // next_step_id while its checkbox is saving.
  const [saving, setSaving] = useState(null);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    let live = true;
    getTeamChecklist(teamId)
      .then((rows) => live && setList(rows))
      .catch((err) => live && setLoadError(err));
    return () => {
      live = false;
    };
  }, [teamId]);

  async function toggle(step) {
    setSaving(step.id);
    setSaveError(null);
    try {
      setList(await setNextStepDone(teamId, step.id, !step.completed_at));
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(null);
    }
  }

  const now = new Date();
  const doneCount = (list || []).filter((s) => s.completed_at).length;

  return (
    <section className="card next-steps" aria-label="Next steps">
      <h2>Next steps</h2>
      {loadError ? (
        <p className="inline-error" role="alert">{loadError.message}</p>
      ) : !list ? (
        <p className="desc" role="status">Loading next steps…</p>
      ) : list.length === 0 ? (
        <p className="desc">Your team is complete. There's nothing on the checklist yet.</p>
      ) : (
        <>
          <p className="desc">
            Your team is complete. Anyone on the team can check these off — {doneCount} of{' '}
            {list.length} done.
          </p>
          <ul className="next-step-list">
            {list.map((s) => {
              const overdue = isOverdue(s, now);
              return (
                <li key={s.id} className={overdue ? 'next-step overdue' : 'next-step'} data-overdue={overdue || undefined}>
                  <label>
                    <input
                      type="checkbox"
                      checked={Boolean(s.completed_at)}
                      disabled={saving === s.id}
                      onChange={() => toggle(s)}
                    />
                    <span className="next-step-title">{s.title}</span>
                  </label>
                  <div className="next-step-meta">
                    {s.due_at && (
                      <span className="next-step-due">
                        Due {formatDue(s.due_at)}
                        {overdue && <span className="pill danger">Overdue</span>}
                      </span>
                    )}
                    {s.completed_at && (
                      <span className="next-step-done">
                        Done by {s.completed_by_name ?? 'a former member'} on{' '}
                        {new Date(s.completed_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {saveError && <p className="inline-error" role="alert">{saveError}</p>}
    </section>
  );
}

// --- Admin manager -----------------------------------------------------------

const BLANK = { id: null, title: '', due_at: '' };

export function NextStepManager() {
  const [list, setList] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(null);
  const [message, setMessage] = useState(null);

  async function load() {
    try {
      setList(await getNextSteps());
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    }
  }

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
      setMessage(form.id ? `Saved “${saved.title}”.` : `Added “${saved.title}”.`);
      setForm(BLANK);
      setShowErrors(false);
      await load();
    } catch (err) {
      setServerError(err instanceof ValidationError ? Object.values(err.fieldErrors)[0] : err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(s) {
    setConfirmingDelete(null);
    try {
      await deleteNextStep(s.id);
      if (form.id === s.id) setForm(BLANK);
      setMessage(`Deleted “${s.title}”.`);
      await load();
    } catch (err) {
      setServerError(err.message);
    }
  }

  return (
    <section aria-label="Next steps checklist">
      <div className="card">
        {loadError ? (
          <p className="inline-error" role="alert">{loadError.message}</p>
        ) : !list ? (
          <p className="desc" role="status">Loading next steps…</p>
        ) : list.length === 0 ? (
          <p className="desc">No next steps yet.</p>
        ) : (
          <ul className="admin-list milestone-admin-list" aria-label="Next steps">
            {list.map((s) => (
              <li key={s.id}>
                <div>
                  <b>{s.title}</b>
                  <span className="admin-secondary">{s.due_at ? `Due ${formatDue(s.due_at)}` : 'No due date'}</span>
                </div>
                <span className="acts">
                  {confirmingDelete === s.id ? (
                    <>
                      <button type="button" className="btn danger" onClick={() => handleDelete(s)}>
                        Delete “{s.title}”
                      </button>
                      <button type="button" className="btn quiet" onClick={() => setConfirmingDelete(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
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
          </ul>
        )}

        <form className="milestone-form" onSubmit={handleSubmit} noValidate aria-label={form.id ? 'Edit next step' : 'Add a next step'}>
          <h3>{form.id ? 'Edit next step' : 'Add a next step'}</h3>
          <div className="field">
            <label htmlFor="next-step-title">Step</label>
            <input
              id="next-step-title"
              value={form.title}
              onChange={(e) => update({ title: e.target.value })}
              aria-invalid={errorFor('title') ? 'true' : undefined}
              aria-describedby={errorFor('title') ? 'next-step-title-error' : undefined}
            />
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
