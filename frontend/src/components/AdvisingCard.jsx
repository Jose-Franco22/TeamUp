import { useEffect, useState } from 'react';
import {
  addExpertise,
  myAdvising,
  removeExpertise,
  setAdvisingAvailable,
  setAdvisingMaxTeams,
} from '../api/client';
import { ADVISING_MAX_MAX, ADVISING_MAX_MIN } from '../lib/validation';
import SkillPicker from './SkillPicker';

// Issue #60 — the adviser's own settings, on the Profile page.
//
// Faculty only, and it renders nothing at all otherwise. That is the part of
// this issue that needed a decision rather than code: criterion 1 says "any
// user can turn on Available to advise", which was written on 12 Oct when an
// adviser was any TeamUp account. #99 then made advising faculty-only, so a
// student with this card would be setting a maximum nobody could reach and
// listing areas nobody could search — a control that looks like it works and
// does nothing. The whole argument is in supabase/47_adviser_expertise.sql.
//
// Nothing here guesses at who is faculty: myAdvising() answers it, because
// faculty_directory is revoked from `authenticated` and the browser has no
// other way to know.
//
// The fields save one at a time, as they are changed, like the two
// preferences above them on the page — there is no Save button, because
// there is nothing here you would want to change and then abandon.
export default function AdvisingCard() {
  const [state, setState] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    myAdvising().then(
      (data) => live && setState(data),
      () => live && setFailed(true)
    );
    return () => {
      live = false;
    };
  }, []);

  // Not faculty, still loading, or the read failed: no card. A faculty member
  // whose settings could not be loaded is the one case worth a word, but it
  // is one line of a profile page that otherwise works, so it says so quietly
  // rather than taking over the page — the same choice AdviserPanel makes.
  if (failed) {
    return (
      <section className="card" aria-label="Advising">
        <h2>Advising</h2>
        <p className="hint">Could not load your advising settings just now.</p>
      </section>
    );
  }
  if (!state || !state.is_faculty) return null;

  return (
    <section className="card advising" aria-label="Advising">
      <h2>Advising</h2>
      <p className="desc">
        Project owners find advisers by name or email. These settings decide whether you are offered to
        them, and what they see when you are.
      </p>

      <AvailableSwitch state={state} onSaved={setState} />

      {state.available && (
        <>
          <MaxTeams state={state} onSaved={setState} />
          <Expertise state={state} onSaved={setState} />
        </>
      )}
    </section>
  );
}

function AvailableSwitch({ state, onSaved }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function toggle(e) {
    const next = e.target.checked;
    setSaving(true);
    setError(null);
    try {
      onSaved(await setAdvisingAvailable(next));
    } catch (err) {
      setError(err.message || 'Could not save that. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <label className="switch">
        <input type="checkbox" checked={state.available} disabled={saving} onChange={toggle} />
        Available to advise
      </label>
      <p className="hint">
        {state.available
          ? 'You can be found and asked. Turning this off hides you from adviser search and refuses new requests — it does not remove you from the teams you already advise.'
          : `You are hidden from adviser search and cannot be asked. ${
              state.advising > 0
                ? `The ${state.advising === 1 ? 'team' : state.advising + ' teams'} you already advise ${
                    state.advising === 1 ? 'is' : 'are'
                  } unaffected.`
                : ''
            }`}
      </p>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </>
  );
}

function MaxTeams({ state, onSaved }) {
  const [value, setValue] = useState(state.max_teams === null ? '' : String(state.max_teams));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const stored = state.max_teams === null ? '' : String(state.max_teams);
  const dirty = value.trim() !== stored;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const next = await setAdvisingMaxTeams(value.trim() === '' ? null : value.trim());
      onSaved(next);
      setValue(next.max_teams === null ? '' : String(next.max_teams));
    } catch (err) {
      setError(err.fieldErrors?.advising_max_teams || err.message || 'Could not save that.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor="max-teams">Most teams I&rsquo;ll advise at once</label>
      <div className="row-inline">
        <input
          id="max-teams"
          type="number"
          inputMode="numeric"
          min={ADVISING_MAX_MIN}
          max={ADVISING_MAX_MAX}
          value={value}
          placeholder="No limit"
          disabled={saving}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn quiet" disabled={saving || !dirty} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="hint">
        {ADVISING_MAX_MIN}&ndash;{ADVISING_MAX_MAX}, or leave it empty for no limit.{' '}
        {state.advising > 0 && (
          <>
            You advise {state.advising} {state.advising === 1 ? 'team' : 'teams'} now
            {state.is_full ? ', which is your limit — new requests will be refused until you raise it.' : '.'}{' '}
            Lowering the number below that keeps the teams you have; it only stops new ones.
          </>
        )}
      </p>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </div>
  );
}

function Expertise({ state, onSaved }) {
  const [removing, setRemoving] = useState(null);
  const [error, setError] = useState(null);

  async function remove(skillId) {
    setRemoving(skillId);
    setError(null);
    try {
      onSaved(await removeExpertise(skillId));
    } catch (err) {
      setError(err.message || 'Could not remove that area.');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <div className="field">
      <p className="lbl">Areas I advise in</p>
      <p className="hint">
        Shown to owners searching for an adviser, with the ones that match what their project needs picked
        out. These are separate from the skills on your own profile.
      </p>

      {state.expertise.length === 0 ? (
        <p className="hint">Nothing listed yet, so owners see your name without any areas beside it.</p>
      ) : (
        <div className="tags">
          {state.expertise.map((area) => (
            <span className="tag" key={area.id}>
              {area.name}
              <button
                className="tag-remove"
                aria-label={`Remove ${area.name}`}
                title="Remove area"
                disabled={removing !== null}
                onClick={() => remove(area.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}

      <div className="foot">
        <SkillPicker
          mySkills={state.expertise}
          onPick={addExpertise}
          onAdded={onSaved}
          label="Add an area"
        />
      </div>
    </div>
  );
}
