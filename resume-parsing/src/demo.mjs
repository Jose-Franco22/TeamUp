// Parses the sample resumes and prints what came out of each format.
//
//   node src/demo.mjs                        every file in fixtures/
//   node src/demo.mjs path/to/resume.pdf     your own file, stays on your machine
//
// Results go to out/, which is gitignored: parsed resumes are personal data.

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseResume, toProfileRows } from './parseResume.mjs';

const args = process.argv.slice(2);
const fixturesDir = new URL('../fixtures/', import.meta.url);

const files = args.length
  ? args
  : readdirSync(fixturesDir)
      .filter((file) => /\.(pdf|docx|tex|txt)$/i.test(file))
      .map((file) => fileURLToPath(new URL(file, fixturesDir)));

const runs = [];
for (const path of files) {
  const name = basename(path);
  const parsed = await parseResume(readFileSync(path), { name });
  runs.push(parsed);

  console.log(`\n${'='.repeat(62)}\n${name}  [${parsed.kind}]  ${parsed.characters} chars in ${parsed.ms} ms`);
  for (const warning of parsed.warnings) console.log(`  ! ${warning}`);
  if (!parsed.skills.length) continue;

  console.log(`  ${parsed.skills.length} skills found:`);
  for (const skill of parsed.skills) {
    const months = skill.months ? `${skill.months} months` : 'no dates';
    const projects = skill.projects ? `, ${skill.projects} project(s)` : '';
    console.log(`    ${skill.name.padEnd(13)} ${months}${projects}  (matched "${skill.matchedAs.join('", "')}")`);
    console.log(`      "${skill.evidence[0]?.quote ?? ''}"`);
  }
  if (parsed.unknownTerms.length) {
    console.log(`  not in the skills table: ${parsed.unknownTerms.join(', ')}`);
  }
}

// What would actually be written if the student confirmed everything.
const first = runs.find((run) => run.skills.length);
if (first) {
  const rows = toProfileRows(first, 'u-example');
  console.log(`\n${rows.length} rows would be written on confirm, for example:`);
  console.log(`  ${JSON.stringify(rows[0].user_skills)}`);
  console.log(`  ${JSON.stringify(rows[0].profile_evidence)}`);
}

const outDir = new URL('../out/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(new URL(`parse-${stamp}.json`, outDir), JSON.stringify(runs, null, 2) + '\n');
console.log(`\nWrote out/parse-${stamp}.json (gitignored)`);
