import { useState } from 'react';
import { BAND_LABELS } from '../lib/matching/fit';
import { judgeIsAvailable, requestVerdict } from '../lib/matching/judge';
import FitRing from './FitRing';

// The score the Browse list is ordered by, shown on the card that earned it.
//
// `fit` is whatever scoreFit() returned, or null when there is nobody to score
// — a guest, or a profile that failed to load. Each of those renders nothing
// rather than a zero: an absent score and a bad score are different things,
// and "0" reads as a verdict.
//
// The button asks the LLM (lib/matching/judge.js) for a second opinion on this
// one project. When it answers, **its** number is the one in the ring: the
// point system can only compare skill names, and the model has read what the
// project is actually building. The jury's score stays underneath as the
// number it started from, and comes back if the review fails.
export default function FitChip({ fit, project, student }) {
  const [state, setState] = useState('idle'); // 'idle' | 'asking' | 'done' | message
  const [verdict, setVerdict] = useState(null);

  if (!fit) return null;

  // The page already tells a student with no skills what to do about it; one
  // prompt is enough, repeated on every card is nagging.
  if (fit.status === 'no-skills') return null;

  if (fit.status === 'no-open-roles') {
    return <p className="fit fit-none">{fit.reasons[0]}</p>;
  }

  // Asking about a project nothing matches wastes a call on an answer the
  // point system is already sure of.
  const worthAsking = fit.points > 0 && Boolean(project) && Boolean(student) && judgeIsAvailable();

  async function askTheJudge() {
    setState('asking');
    const result = await requestVerdict({ project, student, fit });
    if (result.ok) {
      setVerdict(result.verdict);
      setState('done');
    } else {
      // The score is still on screen, so this is a note, not an error state.
      setState(result.message);
    }
  }

  const shown = verdict ?? fit;
  const label = BAND_LABELS[shown.band] ?? shown.band;
  const reviewed = Boolean(verdict);

  return (
    <div className={`fit fit-${shown.band}`}>
      <div className="fit-head">
        <FitRing
          points={shown.points}
          band={shown.band}
          source={reviewed ? 'ai' : 'jury'}
          // The verdict lives here rather than as another paragraph: the card
          // is already dense, but a number that disagrees with the reasons
          // below it should be able to explain itself on hover.
          title={reviewed ? shown.verdict : undefined}
        />
        <div className="fit-head-text">
          <p className="fit-band">{label}</p>
          {reviewed ? (
            <p className="fit-source">AI review · point score was {fit.points}</p>
          ) : (
            <p className="fit-source">Point score</p>
          )}
        </div>
      </div>

      {/* Two reasons, not all of them: the best role and whatever comes
          next — usually the roles you also cover, or the ones you don't. The
          rest belong on the project page, where there is room for them. */}
      {fit.reasons.slice(0, 2).map((reason) => (
        <p className="fit-why" key={reason}>
          {reason}
        </p>
      ))}

      {worthAsking && !reviewed && (
        <div className="fit-actions">
          <button className="btn ghost small" onClick={askTheJudge} disabled={state === 'asking'}>
            {state === 'asking' ? 'Reviewing…' : 'Get AI verdict'}
          </button>
          {state !== 'idle' && state !== 'asking' && (
            <span className="fit-note" role="status">
              {state}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
