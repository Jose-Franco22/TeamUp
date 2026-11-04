import { MilestoneManager } from '../components/Milestones';

// The class schedule (issue #38), on its own admin tab.
export default function AdminMilestones() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Deadlines and milestones</h1>
          <p>Students see upcoming milestones in a banner on every page.</p>
        </div>
      </div>
      <MilestoneManager />
    </>
  );
}
