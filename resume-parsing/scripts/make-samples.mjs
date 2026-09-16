// Writes the same fictional resume as .txt, .tex, .pdf and .docx, so the
// parser can be tested on every format it claims to support.
//
//   node scripts/make-samples.mjs
//
// The person is invented. Real resumes are personal data and never belong in
// a repository.

import { writeFileSync } from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { Document, Packer, Paragraph } from 'docx';

const out = (file) => new URL(`../fixtures/${file}`, import.meta.url);

const LINES = [
  'Jordan Rivera',
  'jordan.rivera@example.com | github.com/example-jordan',
  '',
  'EDUCATION',
  'B.S. Computer Science, expected May 2027',
  '',
  'EXPERIENCE',
  'Web Development Intern, Example Corp - Jan 2025 - Aug 2025',
  '- Built an internal dashboard in ReactJS backed by a Node/Express REST API',
  '- Wrote unit tests with Jest and reviewed pull requests on GitHub',
  '- Containerized two services with Docker',
  '',
  'Undergraduate Research Assistant, Vision Lab - Sep 2024 - Dec 2024',
  '- Counted cars in campus camera footage using OpenCV and Python',
  '',
  'PROJECTS',
  'Traffic Counter, Spring 2025 - OpenCV and Python pipeline over campus camera footage',
  'Grade Predictor, Fall 2024 - random forest in sklearn on a Postgres dataset',
  '',
  'SKILLS',
  'Java, C++, JS, SQL, Figma, Docker',
];

writeFileSync(out('sample-resume.txt'), LINES.join('\n') + '\n');

// --- LaTeX: the markup a real .tex resume carries ----------------------------
const tex = `\\documentclass[letterpaper,11pt]{article}
\\usepackage[margin=0.75in]{geometry}
\\usepackage{hyperref}
% a comment that must not survive parsing
\\begin{document}

\\textbf{\\Large Jordan Rivera} \\\\
\\href{mailto:jordan.rivera@example.com}{jordan.rivera@example.com} $\\cdot$ \\href{https://github.com/example-jordan}{github.com/example-jordan}

\\section{Education}
B.S. Computer Science, expected May 2027

\\section{Experience}
\\textbf{Web Development Intern}, Example Corp \\hfill Jan 2025 - Aug 2025
\\begin{itemize}
  \\item Built an internal dashboard in \\textbf{ReactJS} backed by a Node/Express REST API
  \\item Wrote unit tests with Jest and reviewed pull requests on GitHub
  \\item Containerized two services with Docker
\\end{itemize}

\\textbf{Undergraduate Research Assistant}, Vision Lab \\hfill Sep 2024 - Dec 2024
\\begin{itemize}
  \\item Counted cars in campus camera footage using OpenCV and Python
\\end{itemize}

\\section{Projects}
\\textbf{Traffic Counter}, Spring 2025 - OpenCV and Python pipeline over campus camera footage \\\\
\\textbf{Grade Predictor}, Fall 2024 - random forest in sklearn on a Postgres dataset

\\section{Skills}
Java, C++, JS, SQL, Figma, Docker

\\end{document}
`;
writeFileSync(out('sample-resume.tex'), tex);

// --- PDF ---------------------------------------------------------------------
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
let page = pdf.addPage([612, 792]);
let y = 740;
for (const line of LINES) {
  if (y < 60) {
    page = pdf.addPage([612, 792]);
    y = 740;
  }
  if (line) {
    const heading = line === line.toUpperCase() && line.length < 30;
    page.drawText(line, { x: 56, y, size: heading ? 12 : 10.5, font: heading ? bold : font });
  }
  y -= line ? 16 : 10;
}
writeFileSync(out('sample-resume.pdf'), await pdf.save());

// --- DOCX --------------------------------------------------------------------
const docx = new Document({
  sections: [{ children: LINES.map((line) => new Paragraph({ text: line })) }],
});
writeFileSync(out('sample-resume.docx'), await Packer.toBuffer(docx));

// --- A scan: a PDF with no text layer, to prove the warning fires ------------
const scanned = await PDFDocument.create();
scanned.addPage([612, 792]);
writeFileSync(out('sample-scanned.pdf'), await scanned.save());

console.log('Wrote sample-resume.{txt,tex,pdf,docx} and sample-scanned.pdf to fixtures/');
