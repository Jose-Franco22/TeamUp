import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createProject,
  getMyTeam,
  getSkills,
  MAX_TEAM_SIZE,
  MIN_TEAM_SIZE,
} from '../api/client';
import useAsync from '../components/useAsync';
import { Empty, ErrorState, Loading } from '../components/States';

export default function CreateProject() {
  const navigate = useNavigate();
  const teamState = useAsync(getMyTeam, []);
  const skillsState = useAsync(getSkills, []);

  const [form, setForm] = useState({
    title: '',
    description: '',
    team_size_target: 4,
    creator_role: '',
  });
  const [roles, setRoles] = useState([{ skill_id: '', quantity_needed: 1 }]);
  const [submitState, setSubmitState] = useState(null); // 'saving' | message

  if (teamState.loading || skillsState.loading) return <Loading label="Loading" />;
  if (teamState.error) return <ErrorState error={teamState.error} onRetry={teamState.reload} />;
  if (skillsState.error) return <ErrorState error={skillsState.error} onRetry={skillsState.reload} />;

  // A student can only be on one team. Checking here — rather than letting
  // the submit fail — mirrors how Browse disables "Request to join"
  // preemptively instead of surfacing the same rule as a submit error.
  if (teamState.data) {
    return (
      <Empty title="You're already on a team.">
        <p>
          A student can only be on one senior project team at a time. See{' '}
          <Link to="/team">your team</Link>.
        </p>
      </Empty>
    );
  }

  const allSkills = skillsState.data || [];

  function updateRole(index, patch) {
    setRoles((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function addRole() {
    setRoles((rs) => [...rs, { skill_id: '', quantity_needed: 1 }]);
  }

  function removeRole(index) {
    setRoles((rs) => rs.filter((_, i) => i !== index));
  }

  // Excludes skills already chosen in another row so the same skill can't
  // be picked twice for one project.
  function skillOptionsFor(index) {
    const chosenElsewhere = roles.filter((_, i) => i !== index).map((r) => r.skill_id);
    return allSkills.filter((s) => s.id === roles[index].skill_id || !chosenElsewhere.includes(s.id));
  }

  const size = Number(form.team_size_target);
  const canSubmit =
    form.title.trim() &&
    form.description.trim() &&
    form.creator_role.trim() &&
    size >= MIN_TEAM_SIZE &&
    size <= MAX_TEAM_SIZE;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitState('saving');
    try {
      await createProject({
        title: form.title.trim(),
        description: form.description.trim(),
        team_size_target: Number(form.team_size_target),
        creator_role: form.creator_role.trim(),
        roles_needed: roles
          .filter((r) => r.skill_id)
          .map((r) => ({ skill_id: r.skill_id, quantity_needed: Number(r.quantity_needed) || 1 })),
      });
      // No project detail page yet — /team already shows this project,
      // since creating it makes you its first member.
      navigate('/team', { replace: true });
    } catch (err) {
      setSubmitState(err.message);
    }
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Create a project</h1>
          <p>Start a team and list the roles you still need filled</p>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <section className="card">
          <div className="field">
            <label htmlFor="title">
              Title <span className="req">Required</span>
            </label>
            <input
              id="title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="description">
              Description <span className="req">Required</span>
            </label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="size">
              Team size target <span className="req">Required</span>
            </label>
            <p className="hint">
              Including yourself — a team is {MIN_TEAM_SIZE} to {MAX_TEAM_SIZE} people.
            </p>
            <div className="num">
              <input
                id="size"
                type="number"
                min={MIN_TEAM_SIZE}
                max={MAX_TEAM_SIZE}
                value={form.team_size_target}
                onChange={(e) => setForm({ ...form, team_size_target: e.target.value })}
                required
              />
              <span>people</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="role">
              Your role <span className="req">Required</span>
            </label>
            <p className="hint">What you're contributing yourself, e.g. "Frontend."</p>
            <input
              id="role"
              value={form.creator_role}
              onChange={(e) => setForm({ ...form, creator_role: e.target.value })}
              required
            />
          </div>
        </section>

        <section className="card">
          <h2>
            Roles needed <span className="opt">Optional</span>
          </h2>
          <p className="desc">
            Skills you're still looking for, and how many of each. You can add these later.
          </p>

          <div className="role-rows">
            {roles.map((r, i) => (
              <div className="role-row" key={i}>
                <select
                  aria-label="Skill"
                  value={r.skill_id}
                  onChange={(e) => updateRole(i, { skill_id: e.target.value })}
                >
                  <option value="">Choose a skill…</option>
                  {skillOptionsFor(i).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Quantity needed"
                  type="number"
                  min="1"
                  value={r.quantity_needed}
                  onChange={(e) => updateRole(i, { quantity_needed: e.target.value })}
                />
                <button type="button" className="btn quiet" onClick={() => removeRole(i)}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="foot">
            <button type="button" className="btn ghost" onClick={addRole}>
              Add a role
            </button>
          </div>
        </section>

        <div className="foot">
          <button className="btn" type="submit" disabled={!canSubmit || submitState === 'saving'}>
            {submitState === 'saving' ? 'Creating…' : 'Create project'}
          </button>
          {submitState && submitState !== 'saving' && (
            <span className="inline-error" role="alert">
              {submitState}
            </span>
          )}
        </div>
      </form>
    </>
  );
}
