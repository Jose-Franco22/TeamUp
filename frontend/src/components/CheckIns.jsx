import { useState } from 'react';
import { getCheckIns, saveCheckIn } from '../api/client';
import {
  CHECK_IN_MAX,
  formatWeek,
  groupCheckIns,
  hasBlocker,
  validateCheckIn,
  weekStart,
} from '../lib/checkIns';
import { charCount } from '../lib/validation';
import useAsync from './useAsync';

const EMPTY = { did: '', doing_next: '', blockers: '' };

const FIELDS = [
  { name: 'did', label: 'What I did', hint: 'Required' },
  { name: 'doing_next', label: "What's next", hint: 'Required' },
  { name: 'blockers', label: 'Anything blocking me', hint: 'Optional — your adviser sees these highlighted' },
];

// Weekly check-ins (issue #55), on the team page.
//
//   projectId  whose check-ins
//   members    today's roster, [{ user_id, name }] — who should be checking in
//   formedAt   when the team formed; null while it's still forming
//   viewerId   the signed-in user
//   canPost    false for an adviser, who reads but holds no seat
//
// One check-in per member per Monday–Sunday Central week, editable until the
// week ends. The database enforces all of that (42_check_ins.sql); the form
// just doesn't offer what would be refused.
export default function CheckIns({ projectId, members, formedAt, viewerId, canPost = true }) {
  const { data, loading, error, setData } = useAsync(() => getCheckIns(projectId), [projectId]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState(null);

  const currentWeek = weekStart();
  const all = data || [];
  const mine = all.find((c) => c.user_id === viewerId && c.week_start === currentWeek) || null;
  const showForm = canPost && Boolean(formedAt) && (!mine || editing);

  function startEditing() {
    setForm({ did: mine.did, doing_next: mine.doing_next, blockers: mine.blockers ?? '' });
    setErrors({});
    setServerError(null);
    setStatus(null);
    setEditing(true);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError(null);
    setStatus(null);
    const check = validateCheckIn(form);
    setErrors(check.errors);
    if (!check.isValid) return;
    setSaving(true);
    try {
      const updated = await saveCheckIn(projectId, form, mine?.id ?? null);
      setData(updated);
      setStatus(mine ? 'Check-in updated.' : 'Check-in posted.');
      setForm(EMPTY);
      setEditing(false);
    } catch (err) {
      if (err.fieldErrors) setErrors(err.fieldErrors);
      else setServerError(err.message || 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  const groups = groupCheckIns(all, members, { currentWeek, formedAt });
  const memberName = (id) => members.find((m) => m.user_id === id)?.name;

  return (
    <section className="card check-ins" aria-label="Weekly check-ins">
      <h2>Weekly check-ins</h2>
      <p className="desc">
        A few lines a week on what you did, what's next and what's in the way, so the team and your
        adviser are up to date without a meeting. Weeks run Monday to Sunday, Central time.
      </p>

      {canPost && !formedAt && (
        <p className="hint">Check-ins open once every seat on the team is filled.</p>
      )}

      {status && (
        <p className="meta" role="status">
          {status}
        </p>
      )}

      {canPost && formedAt && mine && !editing && (
        <div className="foot">
          <span className="sub">You've checked in this week. You can edit it until Sunday night.</span>
          <button type="button" className="btn quiet" onClick={startEditing}>
            Edit my check-in
          </button>
        </div>
      )}

      {showForm && (
        <form className="check-in-form" onSubmit={handleSubmit} noValidate aria-label="Check-in form">
          {FIELDS.map((f) => {
            const id = `check-in-${f.name}`;
            const count = charCount(form[f.name]);
            return (
              <div className="field" key={f.name}>
                <label htmlFor={id}>
                  {f.label} <span className="sub">({f.hint})</span>
                </label>
                <textarea
                  id={id}
                  rows={2}
                  value={form[f.name]}
                  aria-invalid={errors[f.name] ? 'true' : undefined}
                  aria-describedby={errors[f.name] ? `${id}-error` : `${id}-count`}
                  onChange={(e) => setForm((v) => ({ ...v, [f.name]: e.target.value }))}
                />
                <div className={`counter${count > CHECK_IN_MAX ? ' over' : ''}`} id={`${id}-count`}>
                  {count}/{CHECK_IN_MAX}
                </div>
                {errors[f.name] && (
                  <p className="inline-error" id={`${id}-error`} role="alert">
                    {errors[f.name]}
                  </p>
                )}
              </div>
            );
          })}
          <div className="foot">
            <button type="submit" className="btn" disabled={saving}>
              {saving ? 'Saving…' : mine ? 'Save changes' : 'Post check-in'}
            </button>
            {editing && (
              <button
                type="button"
                className="btn quiet"
                onClick={() => {
                  setEditing(false);
                  setErrors({});
                  setServerError(null);
                }}
              >
                Cancel
              </button>
            )}
            {serverError && (
              <span className="inline-error" role="alert">
                {serverError}
              </span>
            )}
          </div>
        </form>
      )}

      {loading ? (
        <p className="sub">Loading check-ins…</p>
      ) : error ? (
        <p className="inline-error" role="alert">
          {error.message || "Couldn't load check-ins."}
        </p>
      ) : (
        groups.map((g) => {
          const isCurrent = g.week === currentWeek;
          const heading = `${isCurrent ? 'This week' : 'Week of'} ${formatWeek(g.week)}`;
          return (
            <section className="check-in-week" key={g.week} aria-label={heading}>
              <h3>{heading}</h3>
              {g.checkIns.length === 0 ? (
                <p className="sub">No check-ins {isCurrent ? 'yet' : 'that week'}.</p>
              ) : (
                <ul className="check-in-list">
                  {g.checkIns.map((c) => {
                    const blocked = hasBlocker(c);
                    const name = c.user_name || memberName(c.user_id) || 'A former member';
                    return (
                      <li
                        key={c.id}
                        className={`check-in${blocked ? ' blocked' : ''}`}
                        aria-label={`${name}'s check-in${blocked ? ', has a blocker' : ''}`}
                      >
                        <div className="nm">
                          {name}
                          {blocked && <span className="tag blocker">Blocker</span>}
                        </div>
                        <dl>
                          <dt>Did</dt>
                          <dd>{c.did}</dd>
                          <dt>Next</dt>
                          <dd>{c.doing_next}</dd>
                          {blocked && (
                            <>
                              <dt>Blocked by</dt>
                              <dd className="blocker-text">{c.blockers}</dd>
                            </>
                          )}
                        </dl>
                      </li>
                    );
                  })}
                </ul>
              )}
              {g.missing.length > 0 && (
                <p className="missing" aria-label={`Missing check-ins for ${heading}`}>
                  {isCurrent ? 'Not checked in yet: ' : "Didn't check in: "}
                  {g.missing.map((m) => m.name).join(', ')}
                </p>
              )}
            </section>
          );
        })
      )}
    </section>
  );
}
