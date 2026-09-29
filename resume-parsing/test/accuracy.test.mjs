// Accuracy against hand-checked ground truth.
//
// The other test file checks that the parts work. This one checks that the
// whole thing is *right* on real resume styles, and it is the file to extend
// when a resume in the wild parses badly: add it to fixtures/, write down what
// it should produce in expected.json, and fix the parser until this passes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseResume } from '../src/parseResume.mjs';

const at = (file) => fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url));
const { _comment, ...EXPECTED } = JSON.parse(readFileSync(at('expected.json'), 'utf8'));

// Fixed date so "Present" and any relative wording stay stable over time.
const NOW = new Date('2026-09-26T12:00:00Z');

for (const [name, expected] of Object.entries(EXPECTED)) {
  test(`${name}: finds exactly the right skills`, async () => {
    const parsed = await parseResume(readFileSync(at(name)), { name, now: NOW });
    const found = new Set(parsed.skills.map((skill) => skill.skill_id));
    const wanted = new Set(Object.keys(expected.skills));

    const missed = [...wanted].filter((id) => !found.has(id));
    const invented = [...found].filter((id) => !wanted.has(id));

    assert.deepEqual(missed, [], `missed: ${missed.join(', ')}`);
    assert.deepEqual(invented, [], `false positives: ${invented.join(', ')}`);
  });

  test(`${name}: months match what the resume says`, async () => {
    const parsed = await parseResume(readFileSync(at(name)), { name, now: NOW });
    for (const [skillId, months] of Object.entries(expected.skills)) {
      const skill = parsed.skills.find((entry) => entry.skill_id === skillId);
      assert.equal(skill.months, months, `${skillId} in ${name}`);
    }
  });

  if (expected.unknownIncludes.length) {
    test(`${name}: reports terms the skills table is missing`, async () => {
      const parsed = await parseResume(readFileSync(at(name)), { name, now: NOW });
      for (const term of expected.unknownIncludes) {
        assert.ok(parsed.unknownTerms.includes(term), `${term} was not reported for ${name}`);
      }
    });
  }
}

test('every suggestion is backed by a line from the resume', async () => {
  for (const name of Object.keys(EXPECTED)) {
    const raw = readFileSync(at(name));
    const parsed = await parseResume(raw, { name, now: NOW });
    const text = raw.toString('utf8').replace(/\s+/g, ' ');

    for (const skill of parsed.skills) {
      assert.ok(skill.evidence.length > 0, `${skill.name} in ${name} has no evidence`);
      const quote = skill.evidence[0].quote.replace(/…$/, '').replace(/\s+/g, ' ');
      assert.ok(text.includes(quote), `invented quote in ${name}: ${quote}`);
    }
  }
});
