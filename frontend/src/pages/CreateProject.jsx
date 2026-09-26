import { Link, useNavigate } from 'react-router-dom';
import { createProject, getMyTeam, getRoles, getSkills } from '../api/client';
import useAsync from '../components/useAsync';
import ProjectForm from '../components/ProjectForm';
import { Empty, ErrorState, Loading } from '../components/States';

export default function CreateProject() {
  const navigate = useNavigate();
  const teamState = useAsync(getMyTeam, []);
  const skillsState = useAsync(getSkills, []);
  const rolesState = useAsync(getRoles, []);

  if (teamState.loading || skillsState.loading || rolesState.loading) {
    return <Loading label="Loading" />;
  }
  if (teamState.error) return <ErrorState error={teamState.error} onRetry={teamState.reload} />;
  if (skillsState.error) return <ErrorState error={skillsState.error} onRetry={skillsState.reload} />;
  if (rolesState.error) return <ErrorState error={rolesState.error} onRetry={rolesState.reload} />;

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

  async function handleSubmit({ title, description, team_size_target, own_role_id, roles_needed }) {
    await createProject({
      title,
      description,
      team_size_target,
      creator_role_id: own_role_id,
      roles_needed,
    });
    // No project detail page yet — /team already shows this project,
    // since creating it makes you its first member.
    navigate('/team', { replace: true });
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Create a project</h1>
          <p>Start a team and list the roles you still need filled</p>
        </div>
      </div>

      <ProjectForm
        allRoles={rolesState.data || []}
        allSkills={skillsState.data || []}
        memberCount={1}
        onSubmit={handleSubmit}
        submitLabel="Create project"
        savingLabel="Creating…"
        roleFieldHint="What you're taking on yourself. You're the team's first member."
      />
    </>
  );
}
