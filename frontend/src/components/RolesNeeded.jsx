// Renders project_roles_needed. Each entry is a skill plus quantity_needed.
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
        const matches = mySkillIds.includes(r.skill_id);
        return (
          <span key={r.skill_id} className={matches ? 'role match' : 'role'}>
            {r.skill_name}
            {r.quantity_needed > 1 && <em className="qty">&times;{r.quantity_needed}</em>}
          </span>
        );
      })}
    </div>
  );
}
