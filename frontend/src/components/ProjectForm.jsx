import { useState } from 'react';
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE } from '../api/client';

// The project fields, shared by CreateProject and EditProject. Both screens
// enforce the same rules — team size 2-4, no duplicate roles, and roles that
// fit the open seats — so they're written once here rather than twice.
//
// The one thing that differs between them is how many seats are already
// taken: on create that's always 1 (you), but on edit it's the current
// roster, so lowering the target below the people already on the team has
// to be refused. `memberCount` carries that difference.
export default function ProjectForm({
  allRoles,
  allSkills,
  initial,
  memberCount = 1,
  onSubmit,
  submitLabel,
  savingLabel,
  savedLabel,
  roleFieldHint,
  children,
}) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    team_size_target: initial?.team_size_target ?? 4,
    own_role_id: initial?.own_role_id ?? '',
  });
  const [rows, setRows] = useState(
    initial?.roles_needed?.length
      ? initial.roles_needed.map((r) => ({
          role_id: r.role_id,
          skill_id: r.skill_id ?? '',
          quantity_needed: r.quantity_needed,
        }))
      : [{ role_id: '', skill_id: '', quantity_needed: 1 }]
  );
  const [submitState, setSubmitState] = useState(null); // 'saving' | 'saved' | message

  // Skills are grouped by category in the dropdown — the taxonomy has four
  // categories and a flat list of twelve reads as an undifferentiated blob.
  const skillsByCategory = allSkills.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});

  // A role declares which skill categories belong to it (roles.skill_categories),
  // so the skill dropdown only offers skills that actually fit the chosen role.
  // create_project/update_project enforce the same pairing server-side.
  function categoriesFor(roleId) {
    return allRoles.find((r) => r.id === roleId)?.skill_categories ?? [];
  }

  function skillFitsRole(skillId, roleId) {
    const skill = allSkills.find((s) => s.id === skillId);
    return !!skill && categoriesFor(roleId).includes(skill.category);
  }

  function skillGroupsFor(roleId) {
    const allowed = categoriesFor(roleId);
    return Object.entries(skillsByCategory).filter(([category]) => allowed.includes(category));
  }

  // Changing the role can strand the skill that was picked under the old one
  // (Frontend Developer + React, switched to Data / ML). Clear it rather than
  // submitting a pair the database will reject.
  function updateRow(index, patch) {
    setRows((rs) =>
      rs.map((r, i) => {
        if (i !== index) return r;
        const next = { ...r, ...patch };
        if (patch.role_id !== undefined && next.skill_id && !skillFitsRole(next.skill_id, next.role_id)) {
          next.skill_id = '';
        }
        return next;
      })
    );
    setSubmitState(null);
  }

  function addRow() {
    setRows((rs) => [...rs, { role_id: '', skill_id: '', quantity_needed: 1 }]);
  }

  function removeRow(index) {
    setRows((rs) => rs.filter((_, i) => i !== index));
    setSubmitState(null);
  }

  function updateForm(patch) {
    setForm((f) => ({ ...f, ...patch }));
    setSubmitState(null);
  }

  // project_roles_needed is keyed on (project_id, role_id), so the same
  // role can't be listed twice — hide the ones already taken by another
  // row rather than letting the insert fail.
  function roleOptionsFor(index) {
    const takenElsewhere = rows.filter((_, i) => i !== index).map((r) => r.role_id);
    return allRoles.filter((r) => r.id === rows[index].role_id || !takenElsewhere.includes(r.id));
  }

  const size = Number(form.team_size_target);
  // The target can't drop below the people already on the roster — on
  // create that floor is 1 (you), on edit it's whoever has joined since.
  const sizeFloor = Math.max(MIN_TEAM_SIZE, memberCount);
  const sizeValid = size >= sizeFloor && size <= MAX_TEAM_SIZE;

  // Roles recruit for the seats nobody holds yet.
  const openSeats = sizeValid ? size - memberCount : 0;
  const assigned = rows.reduce((sum, r) => sum + (Number(r.quantity_needed) || 0), 0);
  const overSubscribed = sizeValid && assigned > openSeats;

  // A row with a quantity but no role picked would be silently dropped on
  // submit, so block the button instead of losing it without telling anyone.
  const rowsComplete = rows.every((r) => r.role_id);
  const canSubmit =
    form.title.trim() &&
    form.description.trim() &&
    form.own_role_id &&
    rowsComplete &&
    !overSubscribed &&
    sizeValid;

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitState('saving');
    try {
      await onSubmit({
        title: form.title.trim(),
        description: form.description.trim(),
        team_size_target: Number(form.team_size_target),
        own_role_id: form.own_role_id,
        roles_needed: rows
          .filter((r) => r.role_id)
          .map((r) => ({
            role_id: r.role_id,
            skill_id: r.skill_id || null,
            quantity_needed: Number(r.quantity_needed) || 1,
          })),
      });
      // A create navigates away, so this only ever shows on an edit.
      setSubmitState('saved');
    } catch (err) {
      setSubmitState(err.message);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <section className="card">
        <div className="field">
          <label htmlFor="title">
            Title <span className="req">Required</span>
          </label>
          <input
            id="title"
            value={form.title}
            onChange={(e) => updateForm({ title: e.target.value })}
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
            onChange={(e) => updateForm({ description: e.target.value })}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="size">
            Team size target <span className="req">Required</span>
          </label>
          <p className="hint">
            Including yourself — a team is {MIN_TEAM_SIZE} to {MAX_TEAM_SIZE} people.
            {memberCount > 1 &&
              ` ${memberCount} people are on this team already, so it can't go below ${memberCount}.`}
          </p>
          <div className="num">
            <input
              id="size"
              type="number"
              min={sizeFloor}
              max={MAX_TEAM_SIZE}
              value={form.team_size_target}
              onChange={(e) => updateForm({ team_size_target: e.target.value })}
              required
            />
            <span>people</span>
          </div>
        </div>

        <div className="field">
          <label htmlFor="role">
            Your role <span className="req">Required</span>
          </label>
          <p className="hint">{roleFieldHint}</p>
          <select
            id="role"
            value={form.own_role_id}
            onChange={(e) => updateForm({ own_role_id: e.target.value })}
            required
          >
            <option value="">Choose a role…</option>
            {allRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card">
        <h2>
          Roles needed <span className="opt">Optional</span>
        </h2>
        <p className="desc">
          Who you're still looking for, and how many of each. Pinning a skill to a role is
          optional — it's what puts the project in front of students who listed that skill. You can
          change these at any time.
        </p>
        <p className={overSubscribed ? 'hint seats over' : 'hint seats'}>
          {sizeValid ? (
            <>
              {assigned} of {openSeats} open seat{openSeats === 1 ? '' : 's'} assigned — a team of{' '}
              {size} is {memberCount === 1 ? 'you' : `${memberCount} of you`} plus {openSeats}.
              {overSubscribed && ' Lower a quantity, or raise the team size target.'}
            </>
          ) : (
            <>
              Set a team size between {sizeFloor} and {MAX_TEAM_SIZE} first.
            </>
          )}
        </p>

        <div className="role-rows">
          {rows.map((r, i) => (
            <div className="role-row" key={i}>
              <select
                aria-label="Role"
                value={r.role_id}
                onChange={(e) => updateRow(i, { role_id: e.target.value })}
              >
                <option value="">Choose a role…</option>
                {roleOptionsFor(i).map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Skill"
                value={r.skill_id}
                disabled={!r.role_id}
                onChange={(e) => updateRow(i, { skill_id: e.target.value })}
              >
                <option value="">{r.role_id ? 'Any skill' : 'Pick a role first'}</option>
                {skillGroupsFor(r.role_id).map(([category, list]) => (
                  <optgroup key={category} label={category}>
                    {list.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <span className="qty-field">
                <input
                  aria-label="How many people needed for this role"
                  type="number"
                  min="1"
                  max={Math.max(1, openSeats)}
                  value={r.quantity_needed}
                  onChange={(e) => updateRow(i, { quantity_needed: e.target.value })}
                />
                <span>people</span>
              </span>
              <button type="button" className="btn quiet" onClick={() => removeRow(i)}>
                Remove
              </button>
            </div>
          ))}
        </div>

        <div className="foot">
          <button
            type="button"
            className="btn ghost"
            onClick={addRow}
            disabled={rows.length >= allRoles.length || rows.length >= openSeats}
          >
            Add a role
          </button>
        </div>
      </section>

      <div className="foot">
        <button className="btn" type="submit" disabled={!canSubmit || submitState === 'saving'}>
          {submitState === 'saving' ? savingLabel : submitLabel}
        </button>
        {children}
        {submitState === 'saved' && <span className="meta">{savedLabel}</span>}
        {submitState && !['saving', 'saved'].includes(submitState) && (
          <span className="inline-error" role="alert">
            {submitState}
          </span>
        )}
      </div>
    </form>
  );
}
