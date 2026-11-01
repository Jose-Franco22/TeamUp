import { MilestoneManager } from '../components/Milestones';
import { NextStepManager } from '../components/NextSteps';

// The class schedule (issue #38), on its own admin tab, with the checklist
// teams get once they're full (issue #30).
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

      <div className="head">
        <div>
          <h2>Next steps for complete teams</h2>
          <p>Every team sees this checklist once its roster is full. Any member can check items off.</p>
        </div>
      </div>
      <NextStepManager />
    </>
  );
}
