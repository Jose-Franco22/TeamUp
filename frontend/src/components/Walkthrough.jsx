import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api/client';
import { useSession } from '../auth/SessionContext';
import ResumeImport from './ResumeImport';
import SkillPicker from './SkillPicker';

// First-sign-in walkthrough. Shown over whatever page the student landed on
// until they finish or skip it. Step 1 is done in place (skills are added
// right here) so the tour is the first step of the process rather than a
// description of it. Step 2 ends it with the student's choice: join
// someone else's team from Browse, or start their own. Skipping lands on
// /browse.

function SkillsStep() {
  const [skills, setSkills] = useState(null);

  useEffect(() => {
    getCurrentUser().then((u) => setSkills(u.skills || []), () => setSkills([]));
  }, []);

  function onChange(user) {
    setSkills(user.skills || []);
  }

  return (
    <>
      <p className="desc">
        Teams are matched to you on these. Pick them from the list, or import them from your resume
        — the file is read in your browser and never uploaded.
      </p>
      {skills && skills.length > 0 ? (
        <div className="tags">
          {skills.map((s) => (
            <span className="tag" key={s.id}>
              {s.name}
              {s.source === 'resume' && <em>imported</em>}
            </span>
          ))}
        </div>
      ) : (
        <p className="tour-empty">{skills ? 'No skills yet.' : 'Loading your skills…'}</p>
      )}
      <div className="foot">
        <SkillPicker mySkills={skills || []} onAdded={onChange} />
        <ResumeImport mySkills={skills || []} onImported={onChange} />
      </div>
      <p className="note">You can change these any time from Your profile.</p>
    </>
  );
}

const STEPS = [
  {
    title: 'List your skills',
    body: SkillsStep,
  },
  {
    title: 'Find your team',
    body: ChoiceStep,
  },
];

function ChoiceStep({ onChoose }) {
  return (
    <>
      <p className="desc">
        Join a project someone else started, or start your own and recruit for it. You can only be
        on one team at a time, and you can change your mind until you join or create one.
      </p>
      <div className="tour-choices">
        <button type="button" className="tour-choice" onClick={() => onChoose('/browse')}>
          <b>Browse projects</b>
          <span>
            See every open project and the roles it still needs. Roles that match your skills are
            highlighted — click Join team to get on the roster.
          </span>
        </button>
        <button type="button" className="tour-choice" onClick={() => onChoose('/projects/new')}>
          <b>Create a project</b>
          <span>
            Post your idea, pick your own role, and list who you're looking for. Your team forms
            once the roster reaches its target size.
          </span>
        </button>
      </div>
    </>
  );
}

export default function Walkthrough() {
  const { user, completeOnboarding } = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [step]);

  // Skipping, Escape, or picking where to go all end the tour.
  function finish(to = '/browse') {
    completeOnboarding();
    navigate(to);
  }

  const { title, body: Body } = STEPS[step];
  const last = step === STEPS.length - 1;
  const firstName = user.name.split(' ')[0];

  return (
    <div className="tour-backdrop">
      <div
        className="tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        ref={dialogRef}
        // Escape inside the skill search closes the search, not the tour.
        onKeyDown={(e) => e.key === 'Escape' && !e.target.closest('.picker') && finish()}
      >
        {step === 0 && <p className="tour-hello">Welcome to TeamUp, {firstName}. Here's how to get on a team.</p>}

        <ol className="tour-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
          {STEPS.map((s, i) => (
            <li key={s.title} className={i === step ? 'on' : i < step ? 'done' : undefined}>
              <span className="step-num">{i + 1}</span>
              <span className="tour-progress-label">{s.title}</span>
            </li>
          ))}
        </ol>

        <h2 id="tour-title">{title}</h2>
        <Body onChoose={finish} />

        <div className="tour-foot">
          <button className="btn quiet" onClick={() => finish()}>
            Skip tour
          </button>
          {step > 0 && (
            <button className="btn ghost" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          {/* The last step's choices are its way forward, so it has no Next. */}
          {!last && (
            <button className="btn" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
