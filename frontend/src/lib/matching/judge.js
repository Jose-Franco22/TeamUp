// Stage two of the matching engine: asking an LLM for a second opinion.
//
// Stage one (fit.js) scores instantly, offline, and is what every Browse card
// shows. This is what happens when a student presses the button on one
// project: the jury's working is sent to the fit-review Edge Function, Gemini
// reads the project description — the thing a skill-id comparison cannot —
// and answers with its own score.
//
// Three properties this has to keep:
//
//   1. **The key never reaches the browser.** The call goes to our own Edge
//      Function; only it has GEMINI_API_KEY. See supabase/functions/fit-review/.
//   2. **Nothing personal is sent.** No name, email or user id goes into the
//      payload, because the free tier's terms forbid it and none of it helps
//      judge a skills match. There is a test asserting this.
//   3. **Every failure degrades to the jury.** No key, not deployed, rate
//      limited, offline, slow, nonsense reply — the student still sees the
//      deterministic score. The button is an addition, never a dependency.

const FUNCTION_PATH = '/functions/v1/fit-review';

// Longer than the function's own 20s budget, so its considered answer — a
// timeout reported as JSON, with a sentence for the student — wins over this
// blunter one. This is only the backstop for the function itself being
// unreachable rather than slow.
const CLIENT_TIMEOUT_MS = 25000;

// One sentence per failure, written for a student rather than a log. The
// score is still on screen in every one of these cases, so the tone is "this
// extra thing didn't happen", not "something broke".
const MESSAGES = {
  not_configured: 'The AI review isn’t set up yet, so this is the point score.',
  rate_limited: 'The AI review is busy right now — try again in a minute.',
  timeout: 'The AI review took too long, so this is the point score.',
  unreachable: 'Couldn’t reach the AI review, so this is the point score.',
  unusable_reply: 'The AI review came back unreadable, so this is the point score.',
  empty_reply: 'The AI review came back empty, so this is the point score.',
  upstream_error: 'The AI review is unavailable, so this is the point score.',
  bad_request: 'The AI review couldn’t read this project, so this is the point score.',
};

export const judgeUnavailableMessage = (reason) => MESSAGES[reason] ?? MESSAGES.upstream_error;

// Both are needed to reach the function. They are absent in a plain mock-mode
// checkout, which is why the button asks this before offering itself.
export function judgeIsAvailable(env = import.meta.env) {
  return Boolean(env?.VITE_SUPABASE_URL && env?.VITE_SUPABASE_ANON_KEY);
}

/**
 * The payload, built so that it *cannot* carry an identifier.
 *
 * Rather than passing the student and project objects through and trusting
 * nobody adds a name to them later, each field is copied out by hand. A new
 * field on `users` cannot leak into the prompt by accident, because nothing
 * here spreads an object.
 */
export function buildPayload({ project, student, fit }) {
  const evidence = student?.evidence || {};
  return {
    project: {
      title: project.title,
      description: project.description,
      avg_availability_hours: project.avg_availability_hours,
      roles_needed: (project.roles_needed || []).map((role) => ({
        role_name: role.role_name,
        skill_name: role.skill_name,
        quantity_needed: role.quantity_needed,
      })),
    },
    student: {
      availability_hours: student.availability_hours,
      skills: (student.skills || []).map((skill) => ({
        name: skill.name,
        months: evidence[skill.id]?.months ?? 0,
        projects: evidence[skill.id]?.projects ?? 0,
      })),
    },
    jury: {
      points: fit.points,
      band: fit.band,
      parts: fit.parts,
      reasons: fit.reasons,
    },
  };
}

/**
 * Ask for a verdict.
 *
 * Always resolves — never throws — because the caller already has a score to
 * show and a rejected promise would only make a working page look broken.
 *
 *   { ok: true,  verdict: { points, band, verdict } }
 *   { ok: false, reason, message }
 */
export async function requestVerdict({ project, student, fit }, { env = import.meta.env, fetchImpl } = {}) {
  if (!judgeIsAvailable(env)) {
    return { ok: false, reason: 'not_configured', message: MESSAGES.not_configured };
  }

  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

  try {
    const response = await doFetch(`${env.VITE_SUPABASE_URL}${FUNCTION_PATH}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        // The anon key is public by design; RLS is the real boundary, and
        // this function reads no rows at all.
        Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
        apikey: env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify(buildPayload({ project, student, fit })),
    });

    const body = await response.json().catch(() => null);

    if (!response.ok) {
      const reason = body?.error ?? 'upstream_error';
      return { ok: false, reason, message: judgeUnavailableMessage(reason) };
    }
    if (!body || typeof body.points !== 'number' || !body.band) {
      return { ok: false, reason: 'unusable_reply', message: MESSAGES.unusable_reply };
    }

    return { ok: true, verdict: { points: body.points, band: body.band, verdict: body.verdict ?? '' } };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    const reason = aborted ? 'timeout' : 'unreachable';
    return { ok: false, reason, message: MESSAGES[reason] };
  } finally {
    clearTimeout(timer);
  }
}
