import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toDocument, detectKind } from '../src/toDocument.mjs';
import { texToText } from '../src/latex.mjs';
import { buildDictionary, findSkills, unmatchedTerms } from '../src/skills.mjs';
import { sectionMap, splitEntries, isHeading } from '../src/sections.mjs';
import { monthsIn } from '../src/evidence.mjs';
import { parseResume, toProfileRows } from '../src/parseResume.mjs';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
const FORMATS = ['sample-resume.txt', 'sample-resume.tex', 'sample-resume.pdf', 'sample-resume.docx'];

// --- the conversion layer ----------------------------------------------------

test('every format produces readable text', async () => {
  for (const name of FORMATS) {
    const doc = await toDocument(fixture(name), { name });
    assert.ok(doc.text.includes('ReactJS'), `${name} lost ReactJS`);
    assert.ok(doc.text.includes('OpenCV'), `${name} lost OpenCV`);
    assert.equal(doc.warnings.length, 0, `${name} warned unexpectedly`);
  }
});

test('the format is detected from the file itself when the name is missing', () => {
  assert.equal(detectKind('', fixture('sample-resume.pdf')), 'pdf');
  assert.equal(detectKind('', fixture('sample-resume.docx')), 'docx');
  assert.equal(detectKind('resume.TEX', Buffer.from('x')), 'tex');
});

test('a PDF with no text layer is reported, not silently empty', async () => {
  const doc = await toDocument(fixture('sample-scanned.pdf'), { name: 'sample-scanned.pdf' });
  assert.equal(doc.text.length, 0);
  assert.match(doc.warnings[0], /scan/i);
});

// --- LaTeX -------------------------------------------------------------------

test('LaTeX markup is stripped, and the preamble and comments go with it', () => {
  const text = texToText(String.raw`\documentclass{article}
\usepackage{hyperref}
% secret comment
\begin{document}
\section{Skills}
\textbf{React} and \href{https://x.test}{OpenCV}
\begin{itemize}\item Built with Jest\end{itemize}
\end{document}`);

  assert.ok(text.includes('React'));
  assert.ok(text.includes('OpenCV'));
  assert.ok(text.includes('Jest'));
  assert.ok(!text.includes('secret comment'));
  assert.ok(!text.includes('usepackage'));
  assert.ok(!text.includes('https://x.test'));
  assert.ok(!/\\[a-z]/.test(text), `commands survived: ${text}`);
});

// --- skills ------------------------------------------------------------------

const dictionary = buildDictionary();
const matchNames = (line, section = 'experience') =>
  findSkills([line], dictionary, { sectionOf: () => section }).map((hit) => hit.name);

test('aliases map resume spellings onto the skills table', () => {
  assert.deepEqual(matchNames('Built in ReactJS'), ['React']);
  assert.deepEqual(matchNames('a Postgres dataset'), ['PostgreSQL']);
  assert.deepEqual(matchNames('random forest in sklearn'), ['scikit-learn']);
  assert.deepEqual(matchNames('Node/Express REST API').sort(), ['Express', 'Node.js']);
});

test('a skill is never matched inside a longer word', () => {
  assert.deepEqual(matchNames('Strong Java background'), []); // not JavaScript
  assert.deepEqual(matchNames('Reviewed PRs on GitHub'), ['Git']); // via the github alias
  assert.deepEqual(matchNames('I know Reactive Programming'), []); // not React
});

test('short ambiguous aliases only count inside a skills list', () => {
  assert.deepEqual(matchNames('JS, SQL, Figma', 'skills').sort(), ['Figma', 'JavaScript']);
  assert.deepEqual(matchNames('it just works', 'experience'), []);
});

test('terms outside the skills table are reported, not dropped', () => {
  const lines = ['SKILLS', 'Java, C++, SQL, Docker, React'];
  const { sectionOf } = sectionMap(lines);
  const unknown = unmatchedTerms(lines, dictionary, sectionOf);
  assert.deepEqual(unknown.sort(), ['C++', 'Docker', 'Java', 'SQL']);
  assert.ok(!unknown.includes('React'));
});

// --- sections and dates ------------------------------------------------------

test('headings are recognised and everything under one belongs to it', () => {
  assert.equal(isHeading('EXPERIENCE'), 'experience');
  assert.equal(isHeading('Technical Skills'), 'skills');
  assert.equal(isHeading('Built a dashboard in React.'), null);

  const lines = ['EXPERIENCE', 'Intern - Jan 2025 - Aug 2025', '- Did a thing', 'SKILLS', 'React'];
  const { sectionOf } = sectionMap(lines);
  assert.equal(sectionOf(2), 'experience');
  assert.equal(sectionOf(4), 'skills');
});

test('bullets stay attached to the dated job above them', () => {
  const lines = ['EXPERIENCE', 'Intern - Jan 2025 - Aug 2025', '', '- Used React', '', '- Used Jest'];
  const { sectionOf } = sectionMap(lines);
  const entries = splitEntries(lines, sectionOf);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].lines.length, 3);
});

test('date ranges become months', () => {
  assert.equal(monthsIn('Jan 2025 - Aug 2025'), 7);
  assert.equal(monthsIn('Sep 2024 - Dec 2024'), 3);
  assert.equal(monthsIn('Jun 2024 - Present', new Date('2025-06-15')), 12);
  assert.equal(monthsIn('no dates at all'), 0);
});

// --- end to end --------------------------------------------------------------

test('all four formats produce the same skills, months and projects', async () => {
  const results = [];
  for (const name of FORMATS) {
    results.push(await parseResume(fixture(name), { name }));
  }

  const shape = (parsed) =>
    parsed.skills
      .map((skill) => `${skill.skill_id}:${skill.months}:${skill.projects}`)
      .sort()
      .join('|');

  for (const parsed of results.slice(1)) {
    assert.equal(shape(parsed), shape(results[0]), `${parsed.kind} disagrees with ${results[0].kind}`);
  }
  assert.equal(results[0].skills.length, 11);
});

test('every quote is really in the resume', async () => {
  const parsed = await parseResume(fixture('sample-resume.txt'), { name: 'sample-resume.txt' });
  const text = fixture('sample-resume.txt').toString('utf8');
  for (const skill of parsed.skills) {
    for (const item of skill.evidence) {
      assert.ok(text.includes(item.quote), `invented quote: ${item.quote}`);
    }
  }
});

test('experience beats the contact line as evidence', async () => {
  const parsed = await parseResume(fixture('sample-resume.txt'), { name: 'sample-resume.txt' });
  const git = parsed.skills.find((skill) => skill.skill_id === 's-git');
  assert.equal(git.evidence[0].section, 'experience');
});

test('nothing is written until the student confirms', async () => {
  const parsed = await parseResume(fixture('sample-resume.txt'), { name: 'sample-resume.txt' });
  const all = toProfileRows(parsed, 'u-jordan');
  const confirmed = toProfileRows(parsed, 'u-jordan', ['s-react', 's-jest']);

  assert.equal(all.length, parsed.skills.length);
  assert.equal(confirmed.length, 2);

  const react = confirmed.find((row) => row.user_skills.skill_id === 's-react');
  assert.deepEqual(react.user_skills, {
    user_id: 'u-jordan',
    skill_id: 's-react',
    source: 'resume',
  });
  assert.equal(react.profile_evidence.months, 7);
  assert.equal(react.profile_evidence.quote.includes('ReactJS'), true);
});
