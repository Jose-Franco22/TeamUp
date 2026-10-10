import { useEffect, useState } from 'react';
import { getCurrentUser, removeSkill, updateCurrentUser } from '../api/client';
import {
  AVAILABILITY_MAX,
  AVAILABILITY_MIN,
  BIO_MAX,
  ValidationError,
  charCount,
  validateProfile,
} from '../lib/validation';
import useAsync from '../components/useAsync';
import { ErrorState, Loading } from '../components/States';
import Avatar from '../components/Avatar';
import ResumeImport from '../components/ResumeImport';
import SkillPicker from '../components/SkillPicker';

export default function Profile() {
  const { data, loading, error, reload, setData } = useAsync(getCurrentUser, []);
  const [form, setForm] = useState(null);
  const [saveState, setSaveState] = useState(null); // 'saving' | 'saved' | message
  const [removingId, setRemovingId] = useState(null);
  const [removeError, setRemoveError] = useState(null);
  const [serverErrors, setServerErrors] = useState({});

  useEffect(() => {
    if (data) {
      setForm({
        bio: data.bio || '',
        github_url: data.github_url || '',
        availability_hours: data.availability_hours ?? 0,
      });
    }
  }, [data]);

  if (loading) return <Loading label="Loading your profile" />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!form) return null;

  const dirty =
    form.bio !== (data.bio || '') ||
    form.github_url !== (data.github_url || '') ||
    String(form.availability_hours) !== String(data.availability_hours ?? 0);

  // Client-side errors from validateProfile, plus any field error the server
  // sent back on the last save (a database CHECK the form didn't catch).
  const { values, errors: clientErrors, isValid } = validateProfile(form);
  const errors = { ...serverErrors, ...clientErrors };
  const bioCount = charCount(form.bio.trim());

  function update(field, value) {
    setForm({ ...form, [field]: value });
    setServerErrors((prev) => {
      const { [field]: _cleared, ...rest } = prev;
      return rest;
    });
    if (saveState && saveState !== 'saving') setSaveState(null);
  }

  async function handleSave() {
    if (!isValid) return;
    setSaveState('saving');
    try {
      const updated = await updateCurrentUser(values);
      setData(updated);
      setSaveState('saved');
    } catch (err) {
      if (err instanceof ValidationError) {
        setServerErrors(err.fieldErrors);
        setSaveState(null);
      } else {
        setSaveState(err.message || 'Could not save your profile. Try again.');
      }
    }
  }

  // aria wiring for a field's error message, shared by all three inputs.
  function errorProps(field) {
    return errors[field]
      ? { 'aria-invalid': true, 'aria-describedby': `${field}-error` }
      : { 'aria-invalid': false };
  }
  function fieldError(field) {
    return errors[field] ? (
      <p id={`${field}-error`} className="inline-error" role="alert">
        {errors[field]}
      </p>
    ) : null;
  }

  async function handleRemoveSkill(skillId) {
    setRemovingId(skillId);
    setRemoveError(null);
    try {
      setData(await removeSkill(skillId));
    } catch (err) {
      setRemoveError(err.message);
    } finally {
      setRemovingId(null);
    }
  }

  // Group skills by category for display.
  const byCategory = (data.skills || []).reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});

  return (
    <>
      <div className="head">
        <div>
          <h1>Your profile</h1>
          <p>What teams see when your name comes up</p>
        </div>
      </div>

      <section className="card">
        <div className="idrow">
          <Avatar name={data.name} size={48} />
          <div>
            <h2>{data.name}</h2>
            <p className="desc">{data.email}</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="bio">Bio</label>
          <textarea
            id="bio"
            value={form.bio}
            onChange={(e) => update('bio', e.target.value)}
            {...errorProps('bio')}
          />
          <p className={`counter${bioCount > BIO_MAX ? ' over' : ''}`} data-testid="bio-counter">
            {bioCount}/{BIO_MAX}
          </p>
          {fieldError('bio')}
        </div>

        <div className="field">
          <label htmlFor="gh">GitHub URL</label>
          <p className="hint">Your profile link, like https://github.com/your-username. Optional.</p>
          <input
            id="gh"
            type="url"
            inputMode="url"
            placeholder="https://github.com/your-username"
            value={form.github_url}
            onChange={(e) => update('github_url', e.target.value)}
            {...errorProps('github_url')}
          />
          {fieldError('github_url')}
        </div>

        <div className="field">
          <label htmlFor="hrs">Availability</label>
          <p className="hint">
            Hours per week you can put into the project ({AVAILABILITY_MIN}–{AVAILABILITY_MAX}).
          </p>
          <div className="num">
            <input
              id="hrs"
              type="number"
              min={AVAILABILITY_MIN}
              max={AVAILABILITY_MAX}
              step="1"
              value={form.availability_hours}
              onChange={(e) => update('availability_hours', e.target.value)}
              {...errorProps('availability_hours')}
            />
            <span>hours per week</span>
          </div>
          {fieldError('availability_hours')}
        </div>

        <div className="foot">
          <button
            className="btn"
            disabled={!dirty || !isValid || saveState === 'saving'}
            onClick={handleSave}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
          {saveState === 'saved' && !dirty && <span className="meta">Saved</span>}
          {saveState && saveState !== 'saving' && saveState !== 'saved' && (
            <span className="inline-error" role="alert">{saveState}</span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Skills</h2>
        <p className="desc">
          Teams are matched to you on these. Items marked <em>imported</em> came from your resume — check
          them before they go live.
        </p>

        {Object.entries(byCategory).map(([category, list]) => (
          <div key={category}>
            <p className="lbl">{category}</p>
            <div className="tags">
              {list.map((s) => (
                <span className="tag" key={s.id}>
                  {s.name}
                  {s.source === 'resume' && <em>imported</em>}
                  <button
                    className="tag-remove"
                    aria-label={`Remove ${s.name}`}
                    title="Remove skill"
                    disabled={removingId !== null}
                    onClick={() => handleRemoveSkill(s.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ))}

        {removeError && <p className="inline-error" role="alert">{removeError}</p>}

        <div className="foot">
          <SkillPicker mySkills={data.skills} onAdded={setData} />
          <ResumeImport mySkills={data.skills} onImported={setData} />
        </div>
      </section>
    </>
  );
}
