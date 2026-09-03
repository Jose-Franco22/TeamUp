import { useEffect, useState } from 'react';
import { getCurrentUser, updateCurrentUser } from '../api/client';
import useAsync from '../components/useAsync';
import { ErrorState, Loading } from '../components/States';
import Avatar from '../components/Avatar';

export default function Profile() {
  const { data, loading, error, reload, setData } = useAsync(getCurrentUser, []);
  const [form, setForm] = useState(null);
  const [saveState, setSaveState] = useState(null); // 'saving' | 'saved' | message

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
    Number(form.availability_hours) !== data.availability_hours;

  async function handleSave() {
    setSaveState('saving');
    try {
      const updated = await updateCurrentUser({
        bio: form.bio,
        github_url: form.github_url,
        availability_hours: Number(form.availability_hours),
      });
      setData(updated);
      setSaveState('saved');
    } catch (err) {
      setSaveState(err.message);
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
            onChange={(e) => setForm({ ...form, bio: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="gh">GitHub URL</label>
          <input
            id="gh"
            value={form.github_url}
            onChange={(e) => setForm({ ...form, github_url: e.target.value })}
          />
        </div>

        <div className="field">
          <label htmlFor="hrs">Availability</label>
          <p className="hint">Hours per week you can put into the project.</p>
          <div className="num">
            <input
              id="hrs"
              type="number"
              min="0"
              max="40"
              value={form.availability_hours}
              onChange={(e) => setForm({ ...form, availability_hours: e.target.value })}
            />
            <span>hours per week</span>
          </div>
        </div>

        <div className="foot">
          <button className="btn" disabled={!dirty || saveState === 'saving'} onClick={handleSave}>
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
                </span>
              ))}
            </div>
          </div>
        ))}

        <div className="foot">
          <button className="btn ghost">Add a skill</button>
          <button className="btn ghost">Import from resume</button>
        </div>
      </section>
    </>
  );
}
