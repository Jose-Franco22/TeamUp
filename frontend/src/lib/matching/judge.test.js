// The LLM half of the matching engine, client side.
//
// Two things this file is really testing, and neither is "does it work":
//
//   1. **Nothing personal is sent.** The free tier's terms forbid personal
//      information, and a name adds nothing to a skills judgement. The
//      payload is built field by field precisely so a new column on `users`
//      cannot leak into it, and that is asserted here against a student and
//      project carrying every identifier the app has.
//   2. **Every failure degrades to the jury.** The student already has a
//      score on screen. No key, not deployed, rate limited, offline, slow,
//      or a reply we can't read — all of them have to resolve, not throw,
//      or a working page looks broken.
import { describe, expect, test, vi } from 'vitest';
import { buildPayload, judgeIsAvailable, judgeUnavailableMessage, requestVerdict } from './judge';

const ENV = {
  VITE_SUPABASE_URL: 'https://example.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key-for-tests',
};

// Deliberately carries every identifier the real objects have, so the
// anonymity test is meaningful rather than tautological.
const PROJECT = {
  id: 'p-parking',
  creator_id: 'u-nicolas',
  creator_name: 'Nicolas Guerra',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy from camera feeds.',
  avg_availability_hours: 12,
  team_size_target: 4,
  member_count: 2,
  members: [{ user_id: 'u-jose', name: 'Jose Franco Garza', role: 'Data / ML' }],
  roles_needed: [
    {
      role_id: 'r-frontend',
      role_name: 'Frontend Developer',
      skill_id: 's-react',
      skill_name: 'React',
      category: 'Frontend',
      quantity_needed: 2,
    },
  ],
};

const STUDENT = {
  id: 'u-sofia',
  name: 'Sofia Garza',
  email: 'sgarza02@utrgv.edu',
  github_url: 'https://github.com/sofiagarza',
  bio: 'Frontend, a lot of CSS.',
  availability_hours: 14,
  skills: [{ id: 's-react', name: 'React', category: 'Frontend', source: 'resume' }],
  evidence: { 's-react': { months: 14, projects: 3 } },
};

const FIT = {
  status: 'ok',
  points: 86,
  band: 'strong',
  parts: { primaryFit: 1, scarcity: 0.5, depth: 1, hoursFit: 0.9, extraCoverage: 0.5 },
  reasons: ['You cover Frontend Developer (React) — 14 months, 3 projects behind it.'],
};

const ok = (body) => ({ ok: true, json: async () => body });
const fail = (status, body) => ({ ok: false, status, json: async () => body });

// --- what gets sent -------------------------------------------------------

describe('the payload', () => {
  test('carries the project, the skills with their evidence, and the jury working', () => {
    const payload = buildPayload({ project: PROJECT, student: STUDENT, fit: FIT });

    expect(payload.project.title).toBe('Campus parking tracker');
    expect(payload.project.roles_needed).toEqual([
      { role_name: 'Frontend Developer', skill_name: 'React', quantity_needed: 2 },
    ]);
    expect(payload.student.skills).toEqual([{ name: 'React', months: 14, projects: 3 }]);
    expect(payload.student.availability_hours).toBe(14);
    expect(payload.jury).toEqual({
      points: 86,
      band: 'strong',
      parts: FIT.parts,
      reasons: FIT.reasons,
    });
  });

  test('carries no name, email, id or link — anywhere in it', () => {
    const serialised = JSON.stringify(buildPayload({ project: PROJECT, student: STUDENT, fit: FIT }));

    for (const secret of [
      'Sofia Garza',
      'sgarza02@utrgv.edu',
      'github.com/sofiagarza',
      'u-sofia',
      'Nicolas Guerra',
      'u-nicolas',
      'Jose Franco Garza',
      'u-jose',
      'p-parking',
      's-react',
      'r-frontend',
    ]) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret);
    }
  });

  test('a skill with no evidence is sent as zeros, not dropped', () => {
    const payload = buildPayload({
      project: PROJECT,
      student: { ...STUDENT, evidence: {} },
      fit: FIT,
    });
    expect(payload.student.skills).toEqual([{ name: 'React', months: 0, projects: 0 }]);
  });

  test('a role with no skill pinned to it still goes, so the model knows it is open', () => {
    const payload = buildPayload({
      project: { ...PROJECT, roles_needed: [{ role_name: 'Project Manager', skill_name: null, quantity_needed: 1 }] },
      student: STUDENT,
      fit: FIT,
    });
    expect(payload.project.roles_needed[0]).toEqual({
      role_name: 'Project Manager',
      skill_name: null,
      quantity_needed: 1,
    });
  });
});

// --- availability ---------------------------------------------------------

describe('judgeIsAvailable', () => {
  test('needs both the url and the key', () => {
    expect(judgeIsAvailable(ENV)).toBe(true);
    expect(judgeIsAvailable({ VITE_SUPABASE_URL: ENV.VITE_SUPABASE_URL })).toBe(false);
    expect(judgeIsAvailable({ VITE_SUPABASE_ANON_KEY: 'k' })).toBe(false);
    expect(judgeIsAvailable({})).toBe(false);
    // null, not undefined: undefined falls back to import.meta.env, which a
    // local .env fills in.
    expect(judgeIsAvailable(null)).toBe(false);
  });
});

// --- the happy path -------------------------------------------------------

describe('a verdict comes back', () => {
  test('is returned, and the call went to our own function, not to Google', async () => {
    const fetchImpl = vi.fn(async () => ok({ points: 72, band: 'strong', verdict: 'Good fit for the React role.' }));
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });

    expect(result).toEqual({
      ok: true,
      verdict: { points: 72, band: 'strong', verdict: 'Good fit for the React role.' },
    });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.supabase.co/functions/v1/fit-review');
    expect(url).not.toContain('googleapis.com');
    expect(options.method).toBe('POST');
    // The key that matters never leaves the server; only the public anon key
    // is used here, and it authorises nothing this function reads.
    expect(JSON.stringify(options)).not.toMatch(/AIza/);
  });

  test('a verdict with no sentence still scores', async () => {
    const fetchImpl = vi.fn(async () => ok({ points: 30, band: 'long-shot' }));
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.verdict).toEqual({ points: 30, band: 'long-shot', verdict: '' });
  });

  // The whole point of stage two: it is allowed to disagree with stage one.
  test('the model may score far below the jury, and that is passed through', async () => {
    const fetchImpl = vi.fn(async () => ok({ points: 12, band: 'long-shot', verdict: 'Not what they need.' }));
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result.verdict.points).toBe(12);
    expect(FIT.points).toBe(86);
  });
});

// --- every way it can fail ------------------------------------------------

describe('when the review cannot be had', () => {
  test('no Supabase config: it never calls out at all', async () => {
    const fetchImpl = vi.fn();
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: {}, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test.each([
    ['the key is not set on the server', 503, { error: 'not_configured' }, 'not_configured'],
    ['the free tier rate limit', 429, { error: 'rate_limited' }, 'rate_limited'],
    ['the model returned nothing', 502, { error: 'empty_reply' }, 'empty_reply'],
    ['the reply could not be used', 502, { error: 'unusable_reply' }, 'unusable_reply'],
    ['the function is not deployed', 404, null, 'upstream_error'],
    ['something else upstream', 500, { error: 'upstream_error' }, 'upstream_error'],
  ])('%s is reported, not thrown', async (_label, status, body, reason) => {
    const fetchImpl = vi.fn(async () => fail(status, body));
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(reason);
    expect(result.message).toBeTruthy();
  });

  test('the network being down is reported, not thrown', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  test('an abort is reported as a timeout', async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    });
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
  });

  test.each([
    ['a missing score', { band: 'strong', verdict: 'ok' }],
    ['a score that is not a number', { points: 'lots', band: 'strong' }],
    ['a missing band', { points: 50 }],
    ['nothing at all', null],
  ])('a 200 with %s is refused rather than shown', async (_label, body) => {
    const fetchImpl = vi.fn(async () => ok(body));
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: 'unusable_reply' });
  });

  test('a body that is not JSON at all is refused', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));
    const result = await requestVerdict({ project: PROJECT, student: STUDENT, fit: FIT }, { env: ENV, fetchImpl });
    expect(result).toMatchObject({ ok: false, reason: 'unusable_reply' });
  });

  test('every failure has a sentence a student could read', () => {
    for (const reason of [
      'not_configured',
      'rate_limited',
      'timeout',
      'unreachable',
      'unusable_reply',
      'empty_reply',
      'upstream_error',
      'bad_request',
      'something unheard of',
    ]) {
      const message = judgeUnavailableMessage(reason);
      expect(message).toBeTruthy();
      // No codes, no jargon — the score is still on screen, so these are
      // notes rather than errors.
      expect(message).not.toMatch(/undefined|\[object|Error:/);
    }
  });
});
