// The prompt the fit-review function sends, and the reply it will accept.
// Run with `node --test supabase/functions/`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, RESPONSE_SCHEMA, buildPrompt, parseVerdict } from './prompt.js';

const payload = {
  project: {
    title: 'Campus parking tracker',
    description: 'Live lot occupancy estimated from existing camera feeds.',
    avg_availability_hours: 12,
    roles_needed: [
      { role_name: 'Frontend Developer', skill_name: 'React', quantity_needed: 2 },
      { role_name: 'Project Manager', skill_name: null, quantity_needed: 1 },
    ],
  },
  student: {
    availability_hours: 14,
    skills: [
      { name: 'React', months: 14, projects: 3 },
      { name: 'Figma', months: 0, projects: 0 },
    ],
  },
  jury: {
    points: 86,
    band: 'strong',
    parts: { primaryFit: 1, scarcity: 0.5, depth: 1, hoursFit: 0.9, extraCoverage: 0.5 },
    reasons: ['You cover Frontend Developer (React) — 14 months, 3 projects behind it.'],
  },
};

describe('buildPrompt', () => {
  test('describes the project, including what it is building', () => {
    const text = buildPrompt(payload);
    assert.match(text, /Campus parking tracker/);
    assert.match(text, /camera feeds/);
  });

  test('lists the open roles, including one with no skill pinned to it', () => {
    const text = buildPrompt(payload);
    assert.match(text, /Frontend Developer — wants React ×2/);
    assert.match(text, /Project Manager — no specific skill named/);
  });

  test('gives the evidence behind each skill, and says when there is none', () => {
    const text = buildPrompt(payload);
    assert.match(text, /React \(14 months, 3 projects\)/);
    assert.match(text, /Figma \(listed, no detail given\)/);
  });

  test('hands over the jury working, so disagreement is informed', () => {
    const text = buildPrompt(payload);
    assert.match(text, /86\/100 \(strong\)/);
    assert.match(text, /primaryFit 1\.00/);
    assert.match(text, /You cover Frontend Developer/);
  });

  test('states the band boundaries, so the band matches the number', () => {
    assert.match(buildPrompt(payload), /70-100 strong, 40-69 partial, 0-39 long shot/);
  });

  test('tells it never to discourage applying', () => {
    assert.match(buildPrompt(payload), /Never discourage/);
  });

  // The free tier's terms forbid personal information, and none of it helps
  // judge a skills match.
  test('says the student is anonymous and carries nothing identifying', () => {
    const text = buildPrompt(payload);
    assert.match(text, /anonymous/i);
    assert.ok(!/@/.test(text), 'an email address reached the prompt');
  });

  test('an empty project or student does not throw', () => {
    const bare = {
      project: { title: 'Thing', description: '', roles_needed: [], avg_availability_hours: 0 },
      student: { skills: [], availability_hours: null },
      jury: { points: 0, band: 'long-shot', parts: {}, reasons: [] },
    };
    const text = buildPrompt(bare);
    assert.match(text, /none listed/);
    assert.match(text, /no description given/);
  });
});

describe('RESPONSE_SCHEMA', () => {
  test('constrains the band to the three the app knows', () => {
    assert.deepEqual(RESPONSE_SCHEMA.properties.band.enum, BANDS);
    assert.deepEqual(BANDS, ['strong', 'partial', 'long-shot']);
  });

  test('requires a score, a band and a verdict', () => {
    assert.deepEqual(RESPONSE_SCHEMA.required, ['points', 'band', 'verdict']);
    assert.equal(RESPONSE_SCHEMA.properties.points.type, 'integer');
  });
});

describe('parseVerdict', () => {
  test('accepts a well-formed reply', () => {
    assert.deepEqual(parseVerdict({ points: 72, band: 'strong', verdict: 'Good fit.' }), {
      points: 72,
      band: 'strong',
      verdict: 'Good fit.',
    });
  });

  test('accepts a band in the wrong case', () => {
    assert.equal(parseVerdict({ points: 50, band: 'Partial', verdict: 'ok' }).band, 'partial');
  });

  // A model that says 105 meant "very high". Throwing the reply away over it
  // would be worse than rounding it in.
  test('clamps a score outside 0-100 rather than rejecting it', () => {
    assert.equal(parseVerdict({ points: 140, band: 'strong', verdict: 'x' }).points, 100);
    assert.equal(parseVerdict({ points: -20, band: 'long-shot', verdict: 'x' }).points, 0);
  });

  test('rounds a fractional score', () => {
    assert.equal(parseVerdict({ points: 72.6, band: 'strong', verdict: 'x' }).points, 73);
  });

  test('cuts a verdict that ignored the brief', () => {
    const long = parseVerdict({ points: 50, band: 'partial', verdict: 'x'.repeat(900) });
    assert.equal(long.verdict.length, 400);
    assert.ok(long.verdict.endsWith('...'));
  });

  test('refuses anything it cannot trust', () => {
    for (const bad of [
      null,
      undefined,
      'a string',
      {},
      { points: 50, band: 'excellent', verdict: 'x' }, // not one of the three
      { points: 'fifty', band: 'strong', verdict: 'x' },
      { band: 'strong', verdict: 'x' },
      { points: 50, band: 'strong' }, // no verdict
      { points: 50, band: 'strong', verdict: '   ' },
    ]) {
      assert.equal(parseVerdict(bad), null, `accepted ${JSON.stringify(bad)}`);
    }
  });
});
