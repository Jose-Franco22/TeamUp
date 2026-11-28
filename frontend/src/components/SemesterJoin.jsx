import { useEffect, useState } from 'react';
import { enrollInCurrentSemester, getCurrentSemester } from '../api/client';

// "Are you taking the course this semester?" (50_semesters.sql, decision 9).
//
// A student account carries over from one semester to the next, so the app
// can't tell a returning student from one who has graduated. Until they
// answer, they aren't counted in this semester: an admin doesn't see them
// as unplaced, and the semester's reminders and announcement emails don't
// reach them. Asking to join a team or taking a seat counts them too.
//
// "Not this semester" only hides the prompt in this browser, for this
// semester; it writes nothing, so changing their mind is one press away on
// the next visit from another device, or by joining a team.
const DISMISSED_KEY = 'teamup.semesterJoinDismissed';

function dismissedIds() {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY)) || [];
  } catch {
    return [];
  }
}

export default function SemesterJoin() {
  const [semester, setSemester] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let live = true;
    getCurrentSemester()
      .then((s) => live && setSemester(s))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  if (!semester?.needs_enrollment || hidden || dismissedIds().includes(semester.id)) return null;

  async function join() {
    setBusy(true);
    setError(null);
    try {
      setSemester(await enrollInCurrentSemester());
    } catch (e) {
      setError(e?.message || 'Could not join the semester. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify([...dismissedIds(), semester.id]));
    setHidden(true);
  }

  return (
    <section className="card milestone-banner semester-join" aria-label={`Join ${semester.name}`}>
      <p className="milestone-countdown">Taking senior project in {semester.name}?</p>
      <p>
        Join {semester.name} so you can be placed on a team and get this semester&apos;s deadlines
        and announcements. Your profile and skills carry over.
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="milestone-more">
        <button type="button" className="btn" onClick={join} disabled={busy} aria-busy={busy}>
          {busy ? 'Joining…' : `Join ${semester.name}`}
        </button>{' '}
        <button type="button" className="btn quiet" onClick={dismiss} disabled={busy}>
          Not this semester
        </button>
      </div>
    </section>
  );
}
