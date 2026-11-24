import { Link, useParams } from 'react-router-dom';
import AdvisedTeams from '../components/AdvisedTeams';

// One team you advise, opened from a card on the Advising dashboard (#56).
// Read-only, as on the team page (#54): AdvisedTeams offers nothing but
// stepping down, and the database refuses the rest anyway.
export default function AdvisedTeam() {
  const { projectId } = useParams();
  return (
    <>
      <Link className="advised-back" to="/advising">
        ← All teams you advise
      </Link>
      <AdvisedTeams projectId={projectId} />
    </>
  );
}
