// Splitting a resume into sections and entries.
//
// Where a skill appears changes what it means: "Python" under Experience with
// a date range is worth more than "Python" in a comma-separated skills list.
// The point system in matching/ scores months and project counts, so this is
// where those come from.

const HEADINGS = [
  ['experience', /^(work|professional|relevant)?\s*experience$|^employment$|^work history$/i],
  ['projects', /^(personal |academic |selected )?projects?$/i],
  ['skills', /^(technical )?skills?$|^technologies$|^tech stack$|^competencies$/i],
  ['education', /^education$|^academics?$/i],
  ['summary', /^(professional |career )?summary$|^objective$|^profile$/i],
  ['other', /^(certifications?|awards?|activities|interests|publications|leadership|involvement)$/i],
];

const BULLET = /^\s*[-*•·o]\s+/;

// A heading is short, has no sentence punctuation, and either matches a known
// section name or is written in capitals the way resume headings usually are.
export function isHeading(line) {
  const text = line.trim().replace(/[:•]+$/, '');
  if (!text || text.length > 40 || /[.,;]$/.test(text)) return null;
  for (const [name, pattern] of HEADINGS) {
    if (pattern.test(text)) return name;
  }
  // Capitals alone are not enough: "GPA 3.92" and "NASA 2025" are content.
  const looksLikeHeading =
    text === text.toUpperCase() && /[A-Z]{3}/.test(text) && !/\d/.test(text) && text.split(/\s+/).length <= 4;
  return looksLikeHeading ? 'other' : null;
}

// Maps every line to the section it sits under.
export function sectionMap(lines) {
  const sections = [];
  let current = 'header';
  lines.forEach((line, index) => {
    const heading = isHeading(line);
    if (heading) current = heading;
    sections[index] = current;
  });
  return {
    sections,
    sectionOf: (index) => sections[index] ?? 'other',
  };
}

// An entry is one job or one project: a header line plus everything under it.
//
// The only reliable marker of a new entry is a date. Bullet characters are not:
// many PDFs draw them outside the text layer, so bullets arrive as plain lines
// and splitting on those detaches them from the job they describe.
export function splitEntries(lines, sectionOf) {
  const entries = [];
  let current = null;

  lines.forEach((line, index) => {
    const section = sectionOf(index);
    if (isHeading(line)) {
      current = null;
      return;
    }
    // A blank line is layout, not structure. DOCX puts one between every
    // paragraph, and treating those as breaks detaches bullets from the dated
    // header they belong to.
    if (!line) return;
    const isBullet = BULLET.test(line);
    const hasDate = /\b(19|20)\d{2}\b|\b(present|current)\b/i.test(line);
    const startsEntry = !isBullet && hasDate;

    if (startsEntry || !current) {
      current = { section, header: line, lines: [line], from: index, to: index };
      entries.push(current);
    } else {
      current.lines.push(line);
      current.to = index;
    }
  });

  return entries;
}
