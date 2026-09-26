// Matching resume text against the skills table.
//
// The matcher can only ever return a skill_id that already exists in `skills`,
// so it cannot invent anything — the failure mode an LLM has here by design.
// Aliases are the whole trick: the table says "PostgreSQL", resumes say
// "Postgres"; the table says "scikit-learn", resumes say "sklearn".

import { skills } from '../../frontend/src/api/mockData.js';
import { headingInfo } from './sections.mjs';

// A link is not evidence of a skill: github.io in a project URL says nothing
// about whether someone uses Git.
const withoutLinks = (line) => line.replace(/https?:\/\/\S+|\b[\w.-]+\.(io|com|org|net|dev)\/\S*/gi, ' ');

// Lowercase. Matching is case-insensitive.
export const ALIASES = {
  's-react': ['react', 'reactjs', 'react.js'],
  's-js': ['javascript', 'js', 'es6', 'ecmascript'],
  's-figma': ['figma'],
  's-node': ['node.js', 'nodejs', 'node'],
  's-pg': ['postgresql', 'postgres', 'psql', 'postgre'],
  's-express': ['express', 'express.js', 'expressjs'],
  's-python': ['python', 'python3'],
  's-pandas': ['pandas'],
  's-opencv': ['opencv', 'cv2'],
  's-sklearn': ['scikit-learn', 'scikit learn', 'sklearn'],
  's-jest': ['jest'],
  's-git': ['git', 'github', 'gitlab'],
};

// Aliases too short or too common to trust on their own. They only count
// inside a skills list, where "R, Go, C" means languages rather than words.
export const CONTEXT_ONLY = new Set(['r', 'go', 'c', 'js', 'ml', 'ai', 'cv']);

// An alias is one token in the reader's eyes, so it must not match inside a
// longer word: "Java" must not fire on "JavaScript", "Git" must not fire on
// "GitHub". Plus signs and hashes count as part of a name (C++, C#).
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternFor = (alias) =>
  new RegExp(`(?<![A-Za-z0-9#+])${escape(alias)}(?![A-Za-z0-9#+])`, 'gi');

export function buildDictionary({ table = skills, aliases = ALIASES } = {}) {
  const entries = [];
  for (const skill of table) {
    const names = aliases[skill.id] ?? [skill.name.toLowerCase()];
    for (const alias of names) {
      entries.push({
        skill_id: skill.id,
        name: skill.name,
        category: skill.category,
        alias,
        contextOnly: CONTEXT_ONLY.has(alias),
        pattern: patternFor(alias),
      });
    }
  }
  // Longest alias first, so "react.js" wins over "react" on the same text.
  return entries.sort((a, b) => b.alias.length - a.alias.length);
}

// Finds every mention, with the line it came from. A skill found only through a
// context-only alias counts only when it appeared in a skills section.
export function findSkills(lines, dictionary, { sectionOf = () => 'other' } = {}) {
  const hits = [];
  lines.forEach((line, lineNumber) => {
    if (!line) return;
    const section = sectionOf(lineNumber);
    const searchable = withoutLinks(line);
    for (const entry of dictionary) {
      if (entry.contextOnly && section !== 'skills') continue;
      entry.pattern.lastIndex = 0;
      if (!entry.pattern.test(searchable)) continue;
      hits.push({
        skill_id: entry.skill_id,
        name: entry.name,
        category: entry.category,
        alias: entry.alias,
        line,
        lineNumber,
        section,
      });
    }
  });
  return hits;
}

// Words in the skills section that matched nothing. These are the candidates
// for growing the skills table — a resume saying "Docker" is a signal, even
// though no project can ask for it yet.
// Category labels a resume uses to group its skills list. Not skills.
const LABELS =
  /^((technical|core|key|relevant|additional|other|web|data|ml)\s*[&and]*\s*)*(skills?|languages?|tools?|frameworks?|libraries|databases?|technologies|data|other)$/i;

export function unmatchedTerms(lines, dictionary, sectionOf) {
  const found = new Set();

  lines.forEach((line, lineNumber) => {
    if (sectionOf(lineNumber) !== 'skills' || !line) return;

    // A heading on its own line has no terms to collect. A heading sharing its
    // line with content ("Technical Skills: Python, Git") does.
    const heading = headingInfo(line);
    if (heading && !heading.inline) return;

    // Split on the separators a skills list actually uses, the colon after a
    // category label included.
    for (const raw of line.split(/[,;|•·:]| - /)) {
      const term = raw.replace(/^[\s\-*]+|[\s.]+$/g, '').trim();
      if (!term || term.length > 28 || LABELS.test(term)) continue;
      if (term.split(/\s+/).length > 3) continue;

      // "Git/GitHub" is already covered by the git alias, so it is not unknown.
      const alreadyKnown = dictionary.some((entry) => {
        entry.pattern.lastIndex = 0;
        return entry.pattern.test(term);
      });
      if (!alreadyKnown) found.add(term);
    }
  });

  return [...found];
}
