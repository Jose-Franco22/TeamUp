import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../api/client';
import { useSession } from '../auth/SessionContext';
import ResumeImport from './ResumeImport';
import SkillPicker from './SkillPicker';

// First-sign-in walkthrough. Shown over whatever page the student landed on
// until they finish or skip it. It opens on a choice — create a team or join
// one (#52) — and then shows only that path's steps. Both paths start with
// skills, done in place (added right here) so the tour is the first step of
// the process rather than a description of it. Join ends on /browse, Create
// on /projects/new; skipping from anywhere lands on /browse. The choice only
// picks which steps to show: nothing is saved, so the student can still
// create or join from the normal pages afterward.

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

const SKILLS = { title: 'List your skills', body: SkillsStep };

const PATHS = {
  join: {
    steps: [
      SKILLS,
      {
        title: 'Browse open projects',
        body: () => (
          <p className="desc">
            The Browse page lists every open project, what it's building, and which roles it still
            needs. Roles that match one of your skills are highlighted, so you can see where you fit
            at a glance.
          </p>
        ),
      },
      {
        title: 'Request to join',
        body: () => (
          <p className="desc">
            Found one that needs what you have? Send a request with a short message — the project's
            creator accepts or declines it, and you'll see the answer under Requests. You can only be
            on one team at a time.
          </p>
        ),
      },
    ],
    finish: { label: 'Browse projects', to: '/browse' },
  },
  create: {
    steps: [
      SKILLS,
      {
        title: 'Post your project',
        body: () => (
          <p className="desc">
            Describe what you're building, pick your own role, and list the roles you still need.
            Students browsing projects see which of your open roles match their skills.
          </p>
        ),
      },
      {
        title: 'Review join requests',
        body: () => (
          <p className="desc">
            Students ask to join with a short message. Review each one under Requests and accept or
            decline it. Your team forms once the roster reaches its target size, and you can only be
            on one team at a time.
          </p>
        ),
      },
    ],
    finish: { label: 'Create your project', to: '/projects/new' },
  },
};

function ChoiceScreen({ onChoose }) {
  return (
    <>
      <div className="tour-choices">
        <button type="button" className="tour-choice" onClick={() => onChoose('create')}>
          <b>Create a team</b>
          <span>Post your own project and recruit the roles it needs.</span>
        </button>
        <button type="button" className="tour-choice" onClick={() => onChoose('join')}>
          <b>Join a team</b>
          <span>Find an open project that needs your skills and ask to join it.</span>
        </button>
      </div>
      <p className="note">
        This only picks which steps we show you. You can still create or join a team from the menu
        afterward.
      </p>
    </>
  );
}

export default function Walkthrough() {
  const { user, completeOnboarding } = useSession();
  const navigate = useNavigate();
  // null is the choice screen; otherwise 'join' or 'create'.
  const [path, setPath] = useState(null);
  const [step, setStep] = useState(0);
  const dialogRef = useRef(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, [path, step]);

  // Skipping, Escape, or finishing a path all end the tour.
  function finish(to = '/browse') {
    completeOnboarding();
    navigate(to);
  }

  function choose(next) {
    setPath(next);
    setStep(0);
  }

  // Back from a path's first step returns to the choice screen.
  function back() {
    if (step === 0) setPath(null);
    else setStep(step - 1);
  }

  const firstName = user.name.split(' ')[0];
  const steps = path ? PATHS[path].steps : null;
  const last = steps && step === steps.length - 1;
  const { title, body: Body } = steps ? steps[step] : {};

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
        {steps ? (
          <>
            <ol className="tour-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
              {steps.map((s, i) => (
                <li key={s.title} className={i === step ? 'on' : i < step ? 'done' : undefined}>
                  <span className="step-num">{i + 1}</span>
                  <span className="tour-progress-label">{s.title}</span>
                </li>
              ))}
            </ol>
            <h2 id="tour-title">{title}</h2>
            <Body />
          </>
        ) : (
          <>
            <p className="tour-hello">Welcome to TeamUp, {firstName}.</p>
            <h2 id="tour-title">Are you creating a team or joining one?</h2>
            <ChoiceScreen onChoose={choose} />
          </>
        )}

        <div className="tour-foot">
          <button className="btn quiet" onClick={() => finish()}>
            Skip tour
          </button>
          {steps && (
            <button className="btn ghost" onClick={back}>
              Back
            </button>
          )}
          {steps && !last && (
            <button className="btn" onClick={() => setStep(step + 1)}>
              Next
            </button>
          )}
          {last && (
            <button className="btn" onClick={() => finish(PATHS[path].finish.to)}>
              {PATHS[path].finish.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
