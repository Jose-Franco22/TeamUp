import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  deleteAnnouncement,
  getAnnouncementFeed,
  getMilestones,
  markAnnouncementsSeen,
  saveAnnouncement,
} from '../api/client';
import { useSession } from '../auth/SessionContext';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';
import { formatDue } from '../components/Milestones';
import {
  ANNOUNCEMENT_BODY_MAX,
  ValidationError,
  charCount,
  validateAnnouncement,
} from '../lib/validation';

// Fired once this page has recorded the visit, so the tab's badge clears.
export const ANNOUNCEMENTS_SEEN = 'teamup:announcements-seen';

const DAY = 24 * 60 * 60 * 1000;

// "today", "tomorrow", "in 5 days", "in 3 weeks", "in 4 months", "3 days
// ago" — next to the full date, so the exact one is always there too.
export function relativeDue(iso, now = new Date()) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date(iso)) - startOf(now)) / DAY);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const n = Math.abs(days);
  const span =
    n < 14 ? `${n} days`
    : n < 60 ? `${Math.round(n / 7)} weeks`
    : n < 365 ? `${Math.round(n / 30)} months`
    : `${Math.round(n / 365)} year${Math.round(n / 365) === 1 ? '' : 's'}`;
  return days > 0 ? `in ${span}` : `${span} ago`;
}

// Everything students need to know from the people running the class:
// upcoming deadlines (the milestones from #38), announcements, and the
// deadlines that have passed. Admins and advisers also post, edit and
// delete announcements here; they manage milestones on the Milestones tab.
export default function Announcements() {
  const { user } = useSession();
  const isAdmin = user?.is_admin === true;
  const feed = useAsync(getAnnouncementFeed, []);
  const schedule = useAsync(getMilestones, []);
  const [editing, setEditing] = useState(null);
  // Lives here, not in the form: the form remounts once a save ends editing.
  const [postStatus, setPostStatus] = useState(null);

  useEffect(() => {
    markAnnouncementsSeen()
      .then(() => window.dispatchEvent(new Event(ANNOUNCEMENTS_SEEN)))
      .catch(() => {});
  }, []);

  const now = new Date();
  const upcoming = (schedule.data || []).filter((m) => new Date(m.due_at) > now);
  const past = (schedule.data || []).filter((m) => new Date(m.due_at) <= now).reverse();

  async function refreshFeed() {
    feed.setData(await getAnnouncementFeed());
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Announcements</h1>
          <p>Deadlines and news from your instructors and advisers.</p>
        </div>
      </div>

      <section className="page-section" aria-labelledby="upcoming-heading">
        <h2 className="section" id="upcoming-heading">Upcoming deadlines</h2>
        {schedule.loading ? (
          <Loading label="Loading deadlines" />
        ) : schedule.error ? (
          <ErrorState error={schedule.error} onRetry={schedule.reload} />
        ) : upcoming.length === 0 ? (
          <Empty title="No upcoming deadlines.">
            {isAdmin ? (
              <p>
                Add them on the <Link to="/admin/milestones">Milestones</Link> tab.
              </p>
            ) : (
              <p>Deadlines appear here as soon as they're set.</p>
            )}
          </Empty>
        ) : (
          <ul className="deadline-list" aria-label="Upcoming deadlines">
            {upcoming.map((m) => (
              <li key={m.id} className="card deadline">
                <div className="deadline-when">
                  <b>{relativeDue(m.due_at, now)}</b>
                  <span>{formatDue(m.due_at)}</span>
                </div>
                <div className="deadline-what">
                  <h3>
                    {m.name}
                    {m.is_formation_deadline && <span className="pill warn">Rosters lock</span>}
                  </h3>
                  {m.message && <p className="post-body">{m.message}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="page-section" aria-labelledby="posts-heading">
        <h2 className="section" id="posts-heading">Announcements</h2>
        {isAdmin && (
          <AnnouncementForm
            key={editing?.id ?? 'new'}
            editing={editing}
            onDone={async (text) => {
              setEditing(null);
              setPostStatus(text);
              await refreshFeed();
            }}
            onCancel={() => setEditing(null)}
            onChange={() => setPostStatus(null)}
          />
        )}
        {postStatus && <p className="meta post-status" role="status">{postStatus}</p>}
        {feed.loading ? (
          <Loading label="Loading announcements" />
        ) : feed.error ? (
          <ErrorState error={feed.error} onRetry={feed.reload} />
        ) : feed.data.length === 0 ? (
          <Empty title="No announcements yet.">
            <p>{isAdmin ? 'Post one above and every student will see it here.' : 'Check back here for news from your instructors.'}</p>
          </Empty>
        ) : (
          <ul className="post-list" aria-label="Announcements">
            {feed.data.map((a) => (
              <AnnouncementItem
                key={a.id}
                announcement={a}
                isAdmin={isAdmin}
                onEdit={() => setEditing(a)}
                onDeleted={refreshFeed}
              />
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section className="page-section" aria-labelledby="past-heading">
          <h2 className="section" id="past-heading">Past deadlines</h2>
          <ul className="card admin-list past-list" aria-label="Past deadlines">
            {past.map((m) => (
              <li key={m.id}>
                {m.name}
                <span className="admin-secondary">{formatDue(m.due_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function AnnouncementItem({ announcement: a, isAdmin, onEdit, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState(null);
  const edited = new Date(a.updated_at) - new Date(a.created_at) > 60 * 1000;

  async function handleDelete() {
    try {
      await deleteAnnouncement(a.id);
      await onDeleted();
    } catch (err) {
      setError(err.message);
      setConfirming(false);
    }
  }

  return (
    <li className="card post">
      <h3>{a.title}</h3>
      <p className="post-meta">
        {a.author_name ? `${a.author_name} · ` : ''}
        {formatDue(a.created_at)}
        {edited && ` · edited ${formatDue(a.updated_at)}`}
      </p>
      <p className="post-body">{a.body}</p>
      {isAdmin && (
        <div className="foot">
          {confirming ? (
            <span className="acts">
              <button type="button" className="btn danger" onClick={handleDelete}>
                Delete “{a.title}”
              </button>
              <button type="button" className="btn quiet" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </span>
          ) : (
            <span className="acts">
              <button type="button" className="btn ghost" onClick={onEdit} aria-label={`Edit ${a.title}`}>
                Edit
              </button>
              <button type="button" className="btn quiet" onClick={() => setConfirming(true)} aria-label={`Delete ${a.title}`}>
                Delete
              </button>
            </span>
          )}
          {error && <span className="inline-error" role="alert">{error}</span>}
        </div>
      )}
    </li>
  );
}

// Post a new announcement, or edit `editing`. Errors show once a field has
// been left, or on Post; the server re-checks every rule.
function AnnouncementForm({ editing, onDone, onCancel, onChange }) {
  const [form, setForm] = useState({ title: editing?.title ?? '', body: editing?.body ?? '' });
  const [touched, setTouched] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);

  const { errors } = validateAnnouncement(form);
  const errorFor = (field) => (touched.has(field) ? errors[field] : undefined);
  const touch = (...fields) => setTouched((t) => new Set([...t, ...fields]));

  function update(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setServerError(null);
    onChange?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    touch('title', 'body');
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    try {
      const saved = await saveAnnouncement({ id: editing?.id ?? null, ...form });
      setForm({ title: '', body: '' });
      setTouched(new Set());
      await onDone(editing ? `Saved “${saved.title}”.` : `Posted “${saved.title}”.`);
    } catch (err) {
      setServerError(err instanceof ValidationError ? Object.values(err.fieldErrors)[0] : err.message);
    } finally {
      setSaving(false);
    }
  }

  const bodyCount = charCount(form.body.trim());

  return (
    <form className="card post-form" onSubmit={handleSubmit} noValidate aria-label={editing ? 'Edit announcement' : 'Post an announcement'}>
      <h3>{editing ? 'Edit announcement' : 'Post an announcement'}</h3>
      <div className="field">
        <label htmlFor="announcement-title">Title</label>
        <input
          id="announcement-title"
          value={form.title}
          onChange={(e) => update({ title: e.target.value })}
          onBlur={() => touch('title')}
          aria-invalid={errorFor('title') ? 'true' : undefined}
          aria-describedby={errorFor('title') ? 'announcement-title-error' : undefined}
        />
        {errorFor('title') && (
          <p className="inline-error" id="announcement-title-error" role="alert">{errorFor('title')}</p>
        )}
      </div>
      <div className="field">
        <label htmlFor="announcement-body">Message</label>
        <textarea
          id="announcement-body"
          value={form.body}
          onChange={(e) => update({ body: e.target.value })}
          onBlur={() => touch('body')}
          aria-invalid={errorFor('body') ? 'true' : undefined}
          aria-describedby={errorFor('body') ? 'announcement-body-error' : undefined}
        />
        <p className={bodyCount > ANNOUNCEMENT_BODY_MAX ? 'counter over' : 'counter'}>
          {bodyCount}/{ANNOUNCEMENT_BODY_MAX}
        </p>
        {errorFor('body') && (
          <p className="inline-error" id="announcement-body-error" role="alert">{errorFor('body')}</p>
        )}
      </div>
      <div className="foot">
        <button className="btn" type="submit" disabled={saving}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Post announcement'}
        </button>
        {editing && (
          <button type="button" className="btn quiet" onClick={onCancel}>
            Cancel
          </button>
        )}
        {serverError && <span className="inline-error" role="alert">{serverError}</span>}
      </div>
    </form>
  );
}
