// What the fit-review function asks Gemini, kept free of Deno and network
// code so `node --test` can check it (prompt.test.js). index.ts does the I/O.
//
// Two things this file is responsible for, and they are the reasons it is
// separate from the request handling at all:
//
//   1. **Nothing personal goes to Google.** The free tier's terms forbid
//      sending personal information, and a student's name, email or id adds
//      nothing to a judgement about skills. buildPrompt() takes only the
//      shapes below, and a test asserts no identifier survives into the text.
//   2. **The reply is constrained.** `band` is an enum and `points` is an
//      integer, so the model answers in the app's vocabulary or not at all.

export const BANDS = ['strong', 'partial', 'long-shot'];

// The response schema Gemini is held to. `band` as an enum is what stops a
// fourth answer appearing; everything downstream can switch on three cases.
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    points: { type: 'integer' },
    band: { type: 'string', enum: BANDS },
    verdict: { type: 'string' },
  },
  required: ['points', 'band', 'verdict'],
};

const bullet = (line) => `- ${line}`;

// "React (14 months, 3 projects)" — evidence is what separates a real claim
// from a ticked box, and it is the part the point system can only weigh
// crudely.
function describeSkill(skill) {
  const facts = [];
  if (skill.months > 0) facts.push(`${skill.months} months`);
  if (skill.projects > 0) facts.push(`${skill.projects} project${skill.projects === 1 ? '' : 's'}`);
  return facts.length ? `${skill.name} (${facts.join(', ')})` : `${skill.name} (listed, no detail given)`;
}

function describeRole(role) {
  const skill = role.skill_name ? ` — wants ${role.skill_name}` : ' — no specific skill named';
  const quantity = role.quantity_needed > 1 ? ` ×${role.quantity_needed}` : '';
  return `${role.role_name}${skill}${quantity}`;
}

/**
 * Build the prompt text.
 *
 * Takes only anonymised material:
 *   project  { title, description, roles_needed[], avg_availability_hours }
 *   student  { skills: [{ name, months, projects }], availability_hours }
 *   jury     { points, band, parts, reasons[] }  — what the point system said
 *
 * The jury's working is included on purpose. The model is not being asked to
 * score from scratch: it is being asked whether a transparent, deterministic
 * score missed something a human reader would notice — a description that
 * says "computer vision" where the role only lists Python, say. Telling it
 * what the number was built from is what makes disagreement meaningful
 * rather than noise.
 */
export function buildPrompt({ project, student, jury }) {
  const roles = (project.roles_needed || []).filter((r) => r && (r.role_name || r.skill_name));
  const skills = (student.skills || []).filter((s) => s && s.name);

  const parts = Object.entries(jury.parts || {})
    .map(([name, value]) => `${name} ${Number(value).toFixed(2)}`)
    .join(', ');

  return [
    'You are reviewing how well one student fits one student-run university project.',
    '',
    'THE PROJECT',
    `Title: ${project.title}`,
    `What it is building: ${project.description || '(no description given)'}`,
    'Roles still open:',
    ...(roles.length ? roles.map((r) => bullet(describeRole(r))) : [bullet('none listed')]),
    `The team currently averages ${project.avg_availability_hours || 'an unknown number of'} hours a week.`,
    '',
    'THE STUDENT (anonymous — no name or contact details are available to you)',
    'Skills they have listed, with the evidence behind each:',
    ...(skills.length ? skills.map((s) => bullet(describeSkill(s))) : [bullet('none listed')]),
    `They can give ${student.availability_hours ?? 'an unstated number of'} hours a week.`,
    '',
    'WHAT A DETERMINISTIC POINT SYSTEM ALREADY CONCLUDED',
    `Score: ${jury.points}/100 (${jury.band})`,
    `Components, each 0-1: ${parts || '(none)'}`,
    'Its stated reasons:',
    ...((jury.reasons || []).length ? jury.reasons.map(bullet) : [bullet('(none)')]),
    '',
    'YOUR TASK',
    'Give your own score from 0 to 100 and a band.',
    'The point system can only compare skill names. You can read the description,',
    'so weigh things it cannot: whether the work actually needs what this student',
    'has, whether a listed skill is relevant in practice, and whether the hours',
    'are workable. Agree with it where it is right.',
    '',
    'Bands: 70-100 strong, 40-69 partial, 0-39 long shot. Keep them consistent',
    'with the number you give.',
    '',
    'The verdict is at most two sentences — never three. Address the student',
    'directly, plainly and specifically, naming the role or skill you mean.',
    'Never discourage them from applying: a long shot is still worth a try if',
    'they explain why they are interested.',
  ].join('\n');
}

/**
 * Check a reply before the app trusts it.
 *
 * The schema makes a malformed shape unlikely, not impossible — a truncated
 * response, a proxy returning an error page, or a future model version can
 * all produce something else. Returns the cleaned verdict, or null, and the
 * caller falls back to the jury on null.
 */
export function parseVerdict(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const points = Number(raw.points);
  if (!Number.isFinite(points)) return null;

  const band = String(raw.band || '').toLowerCase();
  if (!BANDS.includes(band)) return null;

  const verdict = String(raw.verdict || '').trim();
  if (!verdict) return null;

  return {
    // Clamped rather than rejected: a model that says 105 meant "very high",
    // and throwing the whole reply away over it would be worse than rounding.
    points: Math.max(0, Math.min(100, Math.round(points))),
    band,
    // Long enough for two sentences; anything beyond that is the model
    // ignoring the brief, and the card has no room for it.
    verdict: verdict.length > 400 ? `${verdict.slice(0, 397)}...` : verdict,
  };
}
