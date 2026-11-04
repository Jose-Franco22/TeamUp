// BAND_LABELS is no longer needed here: the band is rendered by the caller.

// The score as a ring: the number inside, the arc filled in proportion, the
// colour from the band.
//
// An SVG rather than a CSS conic-gradient so it animates and prints the same
// everywhere, and so the value is in the DOM as text for a screen reader
// rather than being implied by a painted shape.
const SIZE = 56;
const STROKE = 5;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function FitRing({ points, band, title, source = 'jury' }) {
  const safe = Math.max(0, Math.min(100, Number(points) || 0));
  const filled = (safe / 100) * CIRCUMFERENCE;


  return (
    <div className={`fit-ring fit-ring-${band || 'none'}`} title={title || undefined}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
        {/* The track: the 100 the score is a fraction of. */}
        <circle className="ring-track" cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} strokeWidth={STROKE} fill="none" />
        {/* The value. Rotated so it starts at twelve o'clock rather than
            three, which is where people read a dial from. */}
        <circle
          className="ring-value"
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          strokeWidth={STROKE}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRCUMFERENCE - filled}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      </svg>
      {/* The number is real text on top of the ring, so it is selectable and
          readable aloud; the ring itself is decoration. */}
      <span className="ring-number">{safe}</span>
      {/* Only what the number alone doesn't say. The band is visible text
          right beside this, so repeating it here would both announce it
          twice and make it ambiguous to anything matching on the page. */}
      <span className="sr-only"> out of 100{source === 'ai' ? ', reviewed by AI' : ''}</span>
    </div>
  );
}
