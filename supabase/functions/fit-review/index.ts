// The LLM half of the matching engine: a second opinion on one student's fit
// for one project (the jury/judge design in the team notes).
//
// The deterministic point system (frontend/src/lib/matching/fit.js) scores
// instantly in the browser and is what every card shows. This is the optional
// stage after it: the student presses a button on one project, and Gemini
// reads the project's description — the one thing the point system cannot —
// and returns its own score.
//
// Why it is an Edge Function and not a fetch from the browser: Vite inlines
// every VITE_* variable into the public bundle, so a browser-side call would
// publish the API key to anyone who opens devtools. The key only ever lives
// here.
//
// Secrets (supabase secrets set ...):
//   GEMINI_API_KEY   from https://aistudio.google.com/apikey
//   GEMINI_MODEL     optional, defaults to gemini-3.5-flash-lite
//
// Deploy:
//   supabase functions deploy fit-review
//
// Until it is deployed the app falls back to the jury's score, so nothing
// breaks by not having it.
import { buildPrompt, parseVerdict, RESPONSE_SCHEMA } from './prompt.js';

// Measured against the real prompt on 2026-10-14, three representative
// students, same key:
//   gemini-3.1-flash-lite   1.6-3.3 s
//   gemini-3.5-flash-lite  11-17 s   (identical scores, no thinking tokens)
// Both agreed on every case, so the faster one is the default. Override with
// the GEMINI_MODEL secret if that changes.
const DEFAULT_MODEL = 'gemini-3.1-flash-lite';
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Generous against the 1.6-3.3 s the default model measured, because a
// slower model set through GEMINI_MODEL should still fit — gemini-3.5-flash-lite
// took up to 17 s on the same prompt. Past this the call is abandoned and the
// caller shows the jury's score, which is always already on screen.
const TIMEOUT_MS = 20000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  // Supabase verifies the caller's JWT before this runs, so reaching here
  // means a signed-in user. Nothing here is per-user anyway: the payload is
  // already anonymous and no row is read or written.
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    // A deliberate, readable answer rather than a 500. The app treats it the
    // same as any other failure — show the jury — but the message says why,
    // which matters when the function is deployed before the secret is set.
    return json({ error: 'not_configured', message: 'GEMINI_API_KEY is not set' }, 503);
  }

  const payload = await req.json().catch(() => null);
  if (!payload?.project || !payload?.student || !payload?.jury) {
    return json({ error: 'bad_request', message: 'project, student and jury are required' }, 400);
  }

  const model = Deno.env.get('GEMINI_MODEL') || DEFAULT_MODEL;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}/${model}:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildPrompt(payload) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          // Deterministic: the same student on the same project should not
          // get a different number because they pressed the button twice.
          temperature: 0,
          // Two sentences and the surrounding JSON. Low enough to keep the
          // call quick, high enough that the structure is never cut off
          // mid-object — a truncated body would be unparseable rather than
          // merely short.
          maxOutputTokens: 400,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      // 429 is the free tier's rate limit and is the one worth naming, so the
      // caller can say "try again in a minute" rather than "something failed".
      const error = response.status === 429 ? 'rate_limited' : 'upstream_error';
      return json({ error, status: response.status, message: detail.slice(0, 200) }, 502);
    }

    const body = await response.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: 'empty_reply' }, 502);

    const verdict = parseVerdict(JSON.parse(text));
    if (!verdict) return json({ error: 'unusable_reply' }, 502);

    return json(verdict);
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    return json(
      { error: aborted ? 'timeout' : 'unreachable', message: String((error as Error)?.message ?? error) },
      502,
    );
  } finally {
    clearTimeout(timer);
  }
});
