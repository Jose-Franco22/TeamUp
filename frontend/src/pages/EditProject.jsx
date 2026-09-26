import { Link, useNavigate, useParams } from 'react-router-dom';
import { getProject, getRoles, getSkills, updateProject } from '../api/client';
import { useSession } from '../auth/SessionContext';
import useAsync from '../components/useAsync';
import ProjectForm from '../components/ProjectForm';
import { Empty, ErrorState, Loading } from '../components/States';

export default function EditProject() {
  const { id } = useParams();
  const { user } = useSession();
  const navigate = useNavigate();

  const projectState = useAsync(() => getProject(id), [id]);
  const skillsState = useAsync(getSkills, []);
  const rolesState = useAsync(getRoles, []);

  if (projectState.loading || skillsState.loading || rolesState.loading) {
    return <Loading label="Loading project" />;
  }
  if (projectState.error) {
    return <ErrorState error={projectState.error} onRetry={projectState.reload} />;
  }
  if (skillsState.error) return <ErrorState error={skillsState.error} onRetry={skillsState.reload} />;
  if (rolesState.error) return <ErrorState error={rolesState.error} onRetry={rolesState.reload} />;

  const project = projectState.data;

  // Same shape as CreateProject's "already on a team" guard: state the rule
  // up front rather than letting the save fail. update_project() re-checks
  // it server-side regardless.
  if (project.creator_id !== user?.id) {
    return (
      <Empty title="You can't edit this project.">
        <p>
          Only the person who created a project can change it. See{' '}
          <Link to="/browse">open projects</Link>.
        </p>
      </Empty>
    );
  }

  const myRole = project.members.find((m) => m.user_id === user.id);

  async function handleSubmit(values) {
    const updated = await updateProject(project.id, values);
    // Keep the form on the page with its "Saved" note, but make sure a
    // reload or a later navigation reads the new values.
    projectState.setData(updated);
  }

  return (
    <>
      <div className="head">
        <div>
          <h1>Edit project</h1>
          <p>Change the description, the team size target, or the roles you're recruiting for</p>
        </div>
      </div>

      <ProjectForm
        key={project.id}
        allRoles={rolesState.data || []}
        allSkills={skillsState.data || []}
        memberCount={project.member_count}
        initial={{
          title: project.title,
          description: project.description,
          team_size_target: project.team_size_target,
          own_role_id: myRole?.role_id ?? '',
          roles_needed: project.roles_needed,
        }}
        onSubmit={handleSubmit}
        submitLabel="Save changes"
        savingLabel="Saving…"
        savedLabel="Saved"
        roleFieldHint="What you're taking on yourself."
      >
        <button type="button" className="btn quiet" onClick={() => navigate('/team')}>
          Back to your team
        </button>
      </ProjectForm>
    </>
  );
}
