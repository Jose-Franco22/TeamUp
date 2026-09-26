// Turning mentions into the evidence the point system scores.
//
// matching/ asks two questions about every skill: how many months has this
// person used it, and how many projects has it appeared in. Both come from
// where the skill was mentioned, never from a model.

import * as chrono from 'chrono-node';

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.44;
const MAX_MONTHS = 72; // six years; anything longer is a parsing mistake

// Students date things by semester, which no date parser understands. Roughly
// when each one runs, so "Fall 2024 - Spring 2025" is an academic year rather
// than nothing at all.
const SEASONS = {
  spring: (year) => [new Date(year, 0, 15), new Date(year, 4, 15)],
  summer: (year) => [new Date(year, 4, 25), new Date(year, 7, 20)],
  fall: (year) => [new Date(year, 7, 25), new Date(year, 11, 15)],
  autumn: (year) => [new Date(year, 7, 25), new Date(year, 11, 15)],
  winter: (year) => [new Date(year, 11, 1), new Date(year + 1, 0, 15)],
};

function semesterMonths(text) {
  const found = [...text.matchAll(/\b(spring|summer|fall|autumn|winter)\s+((?:19|20)\d{2})\b/gi)];
  if (!found.length) return 0;

  const spans = found.map(([, season, year]) => SEASONS[season.toLowerCase()](Number(year)));
  const start = Math.min(...spans.map(([from]) => from.getTime()));
  const end = Math.max(...spans.map(([, to]) => to.getTime()));
  const months = Math.round((end - start) / MS_PER_MONTH);
  return months > 0 && months <= MAX_MONTHS ? months : 0;
}

// "Jan 2025 - Aug 2025", "05/2023 - 08/2023", "Sep 2024 - Present", and
// "Fall 2024 - Spring 2025".
export function monthsIn(text, now = new Date()) {
  // A season name beats the date parser, which reads "Fall 2024" as a bare year.
  const bySemester = semesterMonths(text);
  if (bySemester) return bySemester;

  const results = chrono.parse(text, now, { forwardDate: false });
  let longest = 0;

  for (const result of results) {
    const start = result.start?.date?.();
    if (!start) continue;

    let end = result.end?.date?.();
    if (!end && /\b(present|current|now|ongoing)\b/i.test(text)) end = now;
    if (!end) continue;

    const months = Math.round((end - start) / MS_PER_MONTH);
    if (months > 0 && months <= MAX_MONTHS) longest = Math.max(longest, months);
  }
  return longest;
}

// Long bullets get cut at a word, not mid-word.
function shorten(line, limit = 160) {
  if (line.length <= limit) return line;
  const cut = line.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(' ')).trimEnd()}…`;
}

// One row per skill, shaped the way profile_evidence would store it.
export function collectEvidence(hits, entries, { now = new Date() } = {}) {
  const monthsByEntry = entries.map((entry) => monthsIn(entry.header, now) || monthsIn(entry.lines.join(' '), now));

  const bySkill = new Map();
  for (const hit of hits) {
    const entryIndex = entries.findIndex((entry) => hit.lineNumber >= entry.from && hit.lineNumber <= entry.to);
    const entry = entries[entryIndex];

    const record = bySkill.get(hit.skill_id) ?? {
      skill_id: hit.skill_id,
      name: hit.name,
      category: hit.category,
      source: 'resume',
      months: 0,
      projects: 0,
      aliases: new Set(),
      sections: new Set(),
      evidence: [],
      countedEntries: new Set(),
    };

    record.aliases.add(hit.alias);
    record.sections.add(hit.section);

    // Quote the line the skill was found on, so the student can check it and
    // the app can show why a skill was suggested.
    if (!record.evidence.some((e) => e.quote === hit.line)) {
      record.evidence.push({ quote: shorten(hit.line), section: hit.section });
    }

    if (entry && !record.countedEntries.has(entryIndex)) {
      record.countedEntries.add(entryIndex);
      if (entry.section === 'projects') record.projects += 1;
      record.months += monthsByEntry[entryIndex] ?? 0;
    }

    bySkill.set(hit.skill_id, record);
  }

  // "Built a dashboard in ReactJS" is better evidence than a GitHub link in the
  // contact line, so quotes from real work come first.
  const QUOTE_RANK = { experience: 0, projects: 1, skills: 2, education: 3, other: 4, header: 5 };

  return [...bySkill.values()]
    .map(({ aliases, sections, countedEntries, ...rest }) => ({
      ...rest,
      months: Math.min(rest.months, MAX_MONTHS),
      matchedAs: [...aliases],
      foundIn: [...sections],
      evidence: rest.evidence
        .sort((a, b) => (QUOTE_RANK[a.section] ?? 9) - (QUOTE_RANK[b.section] ?? 9))
        .slice(0, 3),
    }))
    .sort((a, b) => b.months - a.months || a.name.localeCompare(b.name));
}
