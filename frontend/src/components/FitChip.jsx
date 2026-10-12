import { BAND_LABELS } from '../lib/matching/fit';

// The score the Browse list is ordered by, shown on the card that earned it.
//
// `fit` is whatever scoreFit() returned, or null when there is nobody to score
// — a guest, or a profile that failed to load. Each of those renders nothing
// rather than a zero: an absent score and a bad score are different things,
// and "0" reads as a verdict.
export default function FitChip({ fit }) {
  if (!fit) return null;

  // The page already tells a student with no skills what to do about it; one
  // prompt is enough, repeated on every card is nagging.
  if (fit.status === 'no-skills') return null;

  if (fit.status === 'no-open-roles') {
    return <p className="fit fit-none">{fit.reasons[0]}</p>;
  }

  const label = BAND_LABELS[fit.band] ?? fit.band;

  return (
    <div className={`fit fit-${fit.band}`}>
      <p className="fit-score">
        <strong>{fit.points}</strong>
        <span className="fit-band"> {label}</span>
      </p>
      {/* Two reasons, not all of them: the best role and whatever comes
          next — usually the roles you also cover, or the ones you don't. The
          rest belong on the project page, where there is room for them. */}
      {fit.reasons.slice(0, 2).map((reason) => (
        <p className="fit-why" key={reason}>
          {reason}
        </p>
      ))}
    </div>
  );
}
