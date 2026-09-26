// The parsing pipeline, with no file reading in it.
//
//   document -> sections -> skill matches -> evidence
//
// Readers differ between the browser and Node; everything after them is this
// file, shared by both.

import { sectionMap, splitEntries } from './sections.js';
import { buildDictionary, findSkills, unmatchedTerms } from './skills.js';
import { collectEvidence, monthsIn } from './evidence.js';

export function parseDocument(doc, { table, dictionary, now = new Date() } = {}) {
  const started = Date.now();
  const words = dictionary ?? buildDictionary({ table });

  if (!words.length) {
    return {
      kind: doc.kind,
      ms: 0,
      characters: doc.text.length,
      skills: [],
      unknownTerms: [],
      structure: [],
      // The live database starts with an empty skills table, so this is a real
      // state, not a theoretical one.
      warnings: [...doc.warnings, 'No skills are set up yet, so nothing can be matched.'],
    };
  }

  const { sectionOf } = sectionMap(doc.lines);
  const entries = splitEntries(doc.lines, sectionOf);
  const hits = findSkills(doc.lines, words, { sectionOf });
  const skills = collectEvidence(hits, entries, { now });

  const warnings = [...doc.warnings];
  if (!skills.length && doc.text.length > 0) {
    warnings.push('No skills from the list appear in this resume.');
  }

  return {
    kind: doc.kind,
    ms: Date.now() - started,
    characters: doc.text.length,
    skills, // { skill_id, name, months, projects, evidence: [{ quote, section }] }
    unknownTerms: unmatchedTerms(doc.lines, words, sectionOf),
    warnings,
    // The resume as the parser understood it: one entry per job or project,
    // with the skills found inside it.
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

// What the app writes once the student confirms. Evidence (months, projects,
// the quote) has nowhere to live in the schema yet, so only the user_skills
// rows are saved today; the rest rides along for when that table exists.
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
