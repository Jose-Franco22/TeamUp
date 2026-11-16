import { NextStepManager } from '../components/NextSteps';

// The next-steps checklist (issue #42), on its own admin tab.
export default function AdminNextSteps() {
  return (
    <>
      <div className="head">
        <div>
          <h1>Next steps</h1>
          <p>The checklist every team sees once it's complete. Progress shows on the Admin tab.</p>
        </div>
      </div>
      <NextStepManager />
    </>
  );
}
