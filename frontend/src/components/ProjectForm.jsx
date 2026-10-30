import { useState } from 'react';
import { MAX_TEAM_SIZE, MIN_TEAM_SIZE } from '../api/client';
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  ValidationError,
  charCount,
  validateProject,
} from '../lib/validation';
import SkillSelect from './SkillSelect';

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
  // Which fields the student has actually edited. A form that is red before
  // it has been touched is just shouting; errors appear as each field is
  // used, and all at once if Submit is pressed while something is wrong.
  const [touched, setTouched] = useState(() => new Set());
  // Per-field errors the server rejected, for rules the form cannot know
  // about on its own.
  const [serverErrors, setServerErrors] = useState({});

  const touch = (...fields) => setTouched((t) => new Set([...t, ...fields]));

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

  function skillsFor(roleId) {
    const allowed = categoriesFor(roleId);
    return allSkills.filter((s) => allowed.includes(s.category));
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
    touch('roles_needed');
    setSubmitState(null);
    setServerErrors({});
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
    // Changing the team size changes how many seats the listed roles are
    // allowed to claim, so it can invalidate the roles without the student
    // having touched them. Reveal that error too, or Save just goes grey
    // with nothing on screen saying why.
    const also = 'team_size_target' in patch ? ['roles_needed'] : [];
    touch(...Object.keys(patch), ...also);
    setSubmitState(null);
    setServerErrors({});
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

  // One source of truth for every rule, shared with api/client.js and
  // mirrored by the CHECK constraints and the raises in create_project() /
  // update_project(). See supabase/16_project_validation.sql.
  // Listing roles is optional, and the form starts with one blank row. An
  // untouched row is not a mistake, so it is dropped rather than blocking
  // Submit with an error about a field nobody filled in. A row with a skill
  // or a changed quantity *has* been filled in, so a missing role on it is
  // a real omission and gets reported.
  const started = (r) => r.role_id || r.skill_id || Number(r.quantity_needed) !== 1;
  const draft = {
    title: form.title,
    description: form.description,
    team_size_target: form.team_size_target,
    own_role_id: form.own_role_id,
    roles_needed: rows.filter(started),
  };
  const { errors, isValid } = validateProject(draft, { memberCount });

  // A field's error is shown once it has been used, or once Submit has been
  // pressed with something wrong. Server errors always show: the student
  // cannot have caused them by not having typed yet.
  const errorFor = (field) =>
    serverErrors[field] ?? (touched.has(field) ? errors[field] : undefined);
  const describedBy = (field) => (errorFor(field) ? `${field}-error` : undefined);

  async function handleSubmit(e) {
    e.preventDefault();
    // Pressing Submit counts as touching everything, so a field never stays
    // silently invalid while the button sits disabled for no visible reason.
    touch('title', 'description', 'team_size_target', 'own_role_id', 'roles_needed');
    if (!isValid) return;

    setSubmitState('saving');
    setServerErrors({});
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
      // A rule the database enforces and the form could not know about —
      // put it next to the field it belongs to rather than at the bottom.
      if (err instanceof ValidationError) {
        setServerErrors(err.fieldErrors);
        setSubmitState(null);
      } else {
        setSubmitState(err.message);
      }
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
            onBlur={() => touch('title')}
            aria-invalid={errorFor('title') ? 'true' : undefined}
            aria-describedby={describedBy('title')}
            required
          />
          <p className="count">
            {charCount(form.title.trim())}/{TITLE_MAX}
          </p>
          {errorFor('title') && (
            <p className="inline-error" id="title-error" role="alert">
              {errorFor('title')}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="description">
            Description <span className="req">Required</span>
          </label>
          <textarea
            id="description"
            value={form.description}
            onChange={(e) => updateForm({ description: e.target.value })}
            onBlur={() => touch('description')}
            aria-invalid={errorFor('description') ? 'true' : undefined}
            aria-describedby={describedBy('description')}
            required
          />
          <p className="count">
            {charCount(form.description.trim())}/{DESCRIPTION_MAX}
          </p>
          {errorFor('description') && (
            <p className="inline-error" id="description-error" role="alert">
              {errorFor('description')}
            </p>
          )}
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
              onBlur={() => touch('team_size_target')}
              aria-invalid={errorFor('team_size_target') ? 'true' : undefined}
              aria-describedby={describedBy('team_size_target')}
              required
            />
            <span>people</span>
          </div>
          {errorFor('team_size_target') && (
            <p className="inline-error" id="team_size_target-error" role="alert">
              {errorFor('team_size_target')}
            </p>
          )}
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
            onBlur={() => touch('own_role_id')}
            aria-invalid={errorFor('own_role_id') ? 'true' : undefined}
            aria-describedby={describedBy('own_role_id')}
            required
          >
            <option value="">Choose a role…</option>
            {allRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {errorFor('own_role_id') && (
            <p className="inline-error" id="own_role_id-error" role="alert">
              {errorFor('own_role_id')}
            </p>
          )}
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

        {errorFor('roles_needed') && (
          <p className="inline-error" id="roles_needed-error" role="alert">
            {errorFor('roles_needed')}
          </p>
        )}

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
              <SkillSelect
                label="Skill"
                value={r.skill_id}
                skills={skillsFor(r.role_id)}
                placeholder={r.role_id ? 'Any skill' : 'Pick a role first'}
                disabled={!r.role_id}
                onChange={(skillId) => updateRow(i, { skill_id: skillId })}
              />
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
        <button className="btn" type="submit" disabled={!isValid || submitState === 'saving'}>
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
