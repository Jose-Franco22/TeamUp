// Issue #19 — refusing files we cannot read, and two parsing bugs that only
// show up on resumes people actually submit.
//
// parser.test.mjs covers the formats that work. This file covers the ones
// that don't, plus the small-caps headings a PDF produces and the lines in a
// skills section that are not skills.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { toDocument, detectKind, ResumeReadError } from '../src/toDocument.mjs';
import { headingInfo, sectionMap } from '../src/sections.mjs';
import { buildDictionary, unmatchedTerms } from '../src/skills.mjs';
import { parseResume } from '../src/parseResume.mjs';
import { skills as TABLE } from '../../frontend/src/api/mockData.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));
const text = (body) => Buffer.from(body, 'utf8');

// --- formats we refuse -------------------------------------------------------

describe('files that cannot be read', () => {
  test('an image is refused, not decoded as text', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    await assert.rejects(
      () => toDocument(png, { name: 'resume.png' }),
      (error) => {
        assert.ok(error instanceof ResumeReadError, 'wrong error type');
        assert.match(error.message, /can't read \.png files/i);
        assert.match(error.message, /PDF/);
        return true;
      },
    );
  });

  // The one that actually bit: .docx, .xlsx and .pptx are all zip files, so
  // the signature cannot tell them apart. Before this, a spreadsheet went
  // straight to the DOCX reader and came back as nonsense.
  test('a spreadsheet is refused even though it is a zip, like a .docx', async () => {
    const realDocxBytes = fixture('sample-resume.docx');
    await assert.rejects(
      () => toDocument(realDocxBytes, { name: 'budget.xlsx' }),
      /can't read \.xlsx files/i,
    );
    // The same bytes under their own name still read fine.
    const doc = await toDocument(realDocxBytes, { name: 'sample-resume.docx' });
    assert.ok(doc.text.length > 0);
  });

  test('every unsupported extension is refused, and the message names it', async () => {
    for (const name of ['deck.pptx', 'notes.pages', 'photo.jpg', 'archive.zip', 'old.doc']) {
      await assert.rejects(() => toDocument(text('anything'), { name }), ResumeReadError, name);
    }
  });

  test('a file with no extension and binary content is refused', () => {
    assert.equal(detectKind('resume', Buffer.from([0x00, 0x01, 0x02, 0x03])), null);
  });

  test('a file with no extension and plain text is still read', async () => {
    const doc = await toDocument(text('Skills: React, Python. '.repeat(20)), { name: 'resume' });
    assert.equal(doc.kind, 'txt');
    assert.ok(doc.text.includes('React'));
  });
});

// --- small-caps headings -----------------------------------------------------
//
// A heading set in small caps comes out of a PDF with the large first letter
// as its own text item, so "SKILLS" arrives as "S KILLS". Every section
// boundary was being missed on those resumes, which quietly halved what they
// yielded: months and projects both come from knowing which section a line is
// in.

describe('small-caps headings from a PDF', () => {
  test('a split heading is still recognised', () => {
    assert.deepEqual(headingInfo('S KILLS'), { name: 'skills', inline: false });
    assert.deepEqual(headingInfo('P ROJECTS'), { name: 'projects', inline: false });
    assert.equal(headingInfo('P ROFESSIONAL E XPERIENCE').name, 'experience');
  });

  test('a split inline heading keeps its content', () => {
    assert.deepEqual(headingInfo('T ECHNICAL S KILLS: Python, React'), {
      name: 'skills',
      inline: true,
    });
  });

  test('ordinary text with a capital letter before a word is left alone', () => {
    // "A BOUT" would be a false positive; neither of these is a heading.
    assert.equal(headingInfo('Built a REST API for the campus directory'), null);
    assert.equal(headingInfo('Nicolas Guerra'), null);
  });

  // Stitching removes a space, so an all-capitals line of five words that
  // begins with a one-letter word shrinks to four and starts passing the
  // "<= 4 words" test the all-capitals fallback uses. That turned a bullet
  // into a heading, which ended the real section it sat in and sent the
  // months and projects below it to the wrong place — the exact bug the
  // small-caps fix exists to prevent.
  test('an all-capitals sentence does not become a heading once stitched', () => {
    for (const line of [
      'I AM A TEAM LEAD',
      'A GREAT TEAM PLAYER HERE',
      'WORKED AT A BIG COMPANY',
      'I RAN A SMALL TEAM',
    ]) {
      assert.equal(headingInfo(line), null, `"${line}" was read as a heading`);
    }
  });

  test('a genuinely short all-capitals line is still a heading', () => {
    assert.equal(headingInfo('AWARDS').name, 'other');
    assert.equal(headingInfo('VOLUNTEER WORK').name, 'other');
  });

  test('a section it sits in survives an all-capitals bullet', () => {
    const lines = [
      'E XPERIENCE',
      'Research Assistant, Jan 2024 - May 2025',
      'I AM A TEAM LEAD',
      'Built a pipeline with OpenCV.',
    ];
    const { sectionOf } = sectionMap(lines);
    assert.equal(sectionOf(3), 'experience', 'the bullet ended the experience section');
  });

  test('the sections of a small-caps resume are found', () => {
    const lines = [
      'Nicolas Guerra',
      'S KILLS',
      'Python, React, Git',
      'E XPERIENCE',
      'Research Assistant, Jan 2024 - May 2025',
      'Built a pipeline with OpenCV.',
    ];
    const { sectionOf } = sectionMap(lines);
    assert.equal(sectionOf(2), 'skills');
    assert.equal(sectionOf(5), 'experience');
  });

  test('end to end, a small-caps resume yields dated skills', async () => {
    const resume = `Nicolas Guerra
nguerra01@utrgv.edu

S KILLS
Languages: Python, JavaScript
Frameworks: React

P ROFESSIONAL E XPERIENCE
Research Assistant, January 2024 - May 2025
Built a computer vision pipeline with OpenCV and pandas for a camera feed.
Shipped a React dashboard used across the department every week.
`;
    const parsed = await parseResume(text(resume), { name: 'resume.txt' });
    const react = parsed.skills.find((s) => s.skill_id === 's-react');
    assert.ok(react, 'React was not found at all');
    assert.ok(react.months > 0, 'React got no months, so the experience section was missed');
  });
});

// --- lines in a skills section that are not skills --------------------------
//
// unmatchedTerms feeds the "TeamUp does not have these yet" list, which is
// the shortlist for growing the skills table. Junk in it wastes the team's
// time, so the filtering matters more than it looks.

describe('terms the catalog does not have', () => {
  const dictionary = buildDictionary({ table: TABLE });
  const termsIn = (lines) => unmatchedTerms(lines, dictionary, () => 'skills');

  test('a spoken-languages line is not a skills list', () => {
    assert.deepEqual(termsIn(['Spoken Languages: English (Fluent), Spanish (Native)']), []);
  });

  test('and neither is the same line with no label in front of it', () => {
    assert.deepEqual(termsIn(['English (Fluent), Spanish (Native)']), []);
  });

  // The reason the unlabelled check looks for a proficiency word in
  // brackets rather than anywhere on the line: "Native" is part of real
  // skills, and a looser test would discard the whole line it sits on.
  // ("React Native" itself is absorbed by the React alias, which is
  // separate, long-standing behaviour — Kubernetes is the one that must
  // survive here.)
  test('a skills line mentioning Native is not thrown away', () => {
    assert.ok(termsIn(['React Native, Kubernetes']).includes('Kubernetes'));
    assert.ok(termsIn(['Native app development, Terraform']).includes('Terraform'));
  });

  test('proficiency words are not skills', () => {
    const terms = termsIn(['Skills: Kubernetes (Advanced), Terraform (Intermediate)']);
    assert.ok(terms.includes('Kubernetes'));
    assert.ok(terms.includes('Terraform'));
    for (const word of ['Advanced', 'Intermediate', 'Fluent', 'Proficient']) {
      assert.ok(!terms.includes(word), `"${word}" was suggested as a skill`);
    }
  });

  test('brackets are split, so a nested list is not lost as one long term', () => {
    const terms = termsIn(['Data: Python (NumPy, Polars), pandas']);
    assert.ok(terms.includes('NumPy'));
    assert.ok(terms.includes('Polars'));
    assert.ok(!terms.some((term) => term.includes('(')), 'a bracket survived the split');
  });

  test('category labels are not suggested as skills', () => {
    const terms = termsIn([
      'Programming Languages: Kubernetes',
      'Developer Tools: Terraform',
      'Cloud Platforms: Grafana',
      'Operating Systems: Ubuntu',
      'Version Control: Mercurial',
    ]);
    const labels = [
      'Programming Languages',
      'Developer Tools',
      'Cloud Platforms',
      'Operating Systems',
      'Version Control',
      'Skills',
    ];
    // The real terms still come through; it is only the labels that go.
    assert.ok(terms.includes('Kubernetes'));
    assert.ok(terms.includes('Ubuntu'));
    for (const label of labels) {
      assert.ok(!terms.includes(label), `"${label}" was suggested as a skill`);
    }
  });

  test('skills the catalog already has are never listed as missing', () => {
    assert.deepEqual(termsIn(['Skills: Python, React, Git, Jest']), []);
  });
});
