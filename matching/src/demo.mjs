// Run the recommender against the fixtures and print what it found.
//
//   node src/demo.mjs                        every open project, jury only
//   node src/demo.mjs --project p-parking    one project
//   node src/demo.mjs --judge                also ask Gemini to review
//   node src/demo.mjs --no-cohort            only the students in mockData
//
// Results are written to out/, which is gitignored: recommendations about
// people are run output, not something to commit.

import { mkdirSync, writeFileSync } from 'node:fs';
import { loadWorld } from './data.mjs';
import { recommendTeams } from './recommend.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const value = (name, fallback) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 && argv[at + 1] ? argv[at + 1] : fallback;
};

const options = {
  includeCohort: !flag('no-cohort'),
  useJudge: flag('judge'),
  limit: Number(value('limit', 5)),
};

const world = loadWorld({ includeCohort: options.includeCohort });
const wanted = value('project', null);
const targets = wanted ? [world.projectById[wanted]] : world.projects;
if (wanted && !targets[0]) {
  console.error(`No project ${wanted}. Try: ${world.projects.map((p) => p.id).join(', ')}`);
  process.exit(1);
}

const pool = world.students.filter((s) => !s.onTeam).length;
console.log(
  `${world.students.length} students loaded, ${pool} unteamed` +
    (options.includeCohort ? ' (includes the synthetic test cohort)' : ' (mockData only)'),
);

const runs = [];
for (const project of targets) {
  const result = await recommendTeams(project.id, { ...options, world });
  runs.push(result);

  console.log(`\n${'='.repeat(64)}\n${project.title}  [${project.id}]`);
  if (result.skipped) {
    console.log(`  skipped: ${result.skipped}`);
    continue;
  }
  console.log(
    `  ${result.project.seats_open} seat(s) open · roles: ${result.project.roles_open.join(', ') || '(none listed)'} · pool: ${result.pool_size}`,
  );

  for (const team of result.shortlist) {
    const winner = team.id === result.verdict.best_team_id ? ' <- pick' : '';
    const parts = Object.entries(team.parts)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(' · ');
    console.log(`\n  ${team.id}  ${team.points} pts${winner}`);
    console.log(`    ${parts}`);
    for (const member of team.members) {
      console.log(
        `    ${member.name} (${member.hours_per_week} hrs/wk) -> ${member.assigned_role ?? 'no role covered'}`,
      );
    }
    for (const reason of team.why) console.log(`    · ${reason}`);
  }

  console.log(`\n  verdict: ${result.verdict.source}`);
  if (result.verdict.reason) console.log(`    ${result.verdict.reason}`);
  for (const row of result.verdict.ranking) {
    console.log(`    ${row.team_id}: ${row.why}`);
  }
  for (const risk of result.verdict.risks ?? []) console.log(`    risk: ${risk}`);
}

const outDir = new URL('../out/', import.meta.url);
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const file = new URL(`run-${stamp}.json`, outDir);
writeFileSync(file, JSON.stringify({ options, runs }, null, 2) + '\n');
console.log(`\nWrote ${runs.length} run(s) to out/run-${stamp}.json (gitignored)`);
