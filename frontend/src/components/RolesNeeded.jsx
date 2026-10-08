// Renders project_roles_needed. Each entry is a role, an optional skill
// pinned to that role, and how many of them are wanted. `skill_name` is
// null when the creator listed a role without naming a skill for it.
export default function RolesNeeded({ roles, mySkillIds = [] }) {
  if (!roles || roles.length === 0) {
    return (
      <div className="roles">
        <span className="role none">No open roles</span>
      </div>
    );
  }

  return (
    <div className="roles">
      {roles.map((r) => {
        const matches = r.skill_id && mySkillIds.includes(r.skill_id);
        return (
          <span key={r.role_id} className={matches ? 'role match' : 'role'}>
            {r.role_name}
            {r.skill_name && <em className="skill">{r.skill_name}</em>}
            {r.quantity_needed > 1 && <em className="qty">&times;{r.quantity_needed}</em>}
          </span>
        );
      })}
    </div>
  );
}
