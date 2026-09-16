// The whole pipeline, in one call.
//
//   file bytes -> toDocument -> sections -> skill matches -> evidence
//
// No model, no network, no upload. The result is a suggestion list: nothing is
// saved until the student confirms it, which is what the Profile page's
// "imported" tag already expects.

import { toDocument } from './toDocument.mjs';
import { sectionMap, splitEntries } from './sections.mjs';
import { buildDictionary, findSkills, unmatchedTerms } from './skills.mjs';
import { collectEvidence, monthsIn } from './evidence.mjs';

export async function parseResume(input, { name = '', dictionary = buildDictionary(), now = new Date() } = {}) {
  const started = Date.now();
  const doc = await toDocument(input, { name });
  const { sectionOf } = sectionMap(doc.lines);
  const entries = splitEntries(doc.lines, sectionOf);

  const hits = findSkills(doc.lines, dictionary, { sectionOf });
  const skills = collectEvidence(hits, entries, { now });
  const unknown = unmatchedTerms(doc.lines, dictionary, sectionOf);

  const warnings = [...doc.warnings];
  if (!skills.length && doc.text.length > 0) {
    warnings.push('No skills from the table appear in this resume.');
  }

  return {
    file: name,
    kind: doc.kind,
    ms: Date.now() - started,
    characters: doc.text.length,
    skills, // suggestions: { skill_id, months, projects, evidence: [{ quote }] }
    unknownTerms: unknown, // candidates for growing the skills table
    warnings,
    // The resume as the parser understood it: one entry per job or project,
    // with the skills found inside it. Enough to rebuild the document.
    structure: entries.map((entry) => ({
      section: entry.section,
      header: entry.header,
      months: monthsIn(entry.header, now) || monthsIn(entry.lines.join(' '), now),
      lines: entry.lines,
      skill_ids: [
        ...new Set(
          hits
            .filter((hit) => hit.lineNumber >= entry.from && hit.lineNumber <= entry.to)
            .map((hit) => hit.skill_id),
        ),
      ],
    })),
  };
}

// What the app would write once the student ticks the boxes: user_skills rows
// plus the evidence the matching engine scores.
export function toProfileRows(parsed, userId, confirmedSkillIds = null) {
  const keep = confirmedSkillIds ? new Set(confirmedSkillIds) : null;
  return parsed.skills
    .filter((skill) => !keep || keep.has(skill.skill_id))
    .map((skill) => ({
      user_skills: { user_id: userId, skill_id: skill.skill_id, source: 'resume' },
      profile_evidence: {
        user_id: userId,
        skill_id: skill.skill_id,
        months: skill.months,
        projects: skill.projects,
        quote: skill.evidence[0]?.quote ?? null,
      },
    }));
}
