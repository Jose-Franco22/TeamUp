// The two stages, wired together:
//
//   evidence  ->  jury (points)  ->  judge (LLM review)
//   fixtures      shortlistTeams     judgeShortlist
//
// The jury always runs and always produces an answer. The judge only reorders
// what the jury found, and the whole thing still works without it.

import { loadWorld, eligibleCandidates, openSlots } from './data.mjs';
import { explain } from './scoring.mjs';
import { shortlistTeams } from './shortlist.mjs';
import { judgeShortlist } from './judge.mjs';

export async function recommendTeams(
  projectId,
  { includeCohort = true, limit = 5, beamWidth = 12, useJudge = false, world = null } = {},
) {
  const loaded = world ?? loadWorld({ includeCohort });
  const project = loaded.projectById[projectId];
  if (!project) throw new Error(`No project ${projectId}`);

  const reasonsToStop =
    project.status !== 'open'
      ? `project is ${project.status}`
      : project.seatsOpen === 0
        ? 'no seats left'
        : null;

  const candidates = eligibleCandidates(loaded, project);
  const slots = openSlots(project);

  const shortlist = reasonsToStop
    ? []
    : shortlistTeams({
        project,
        candidates,
        slots,
        skillById: loaded.skillById,
        seats: project.seatsOpen,
        limit,
        beamWidth,
      });

  const verdict =
    useJudge && shortlist.length
      ? await judgeShortlist({ project, shortlist, skillById: loaded.skillById })
      : {
          source: 'jury-only',
          reason: reasonsToStop ?? (useJudge ? 'nothing to judge' : 'judge not requested'),
          best_team_id: shortlist[0]?.id ?? null,
          ranking: shortlist.map((t, i) => ({
            team_id: t.id,
            why: `Jury rank ${i + 1}, ${t.score.points} points`,
          })),
          risks: [],
        };

  return {
    generated_at: new Date().toISOString(),
    project: {
      id: project.id,
      title: project.title,
      status: project.status,
      seats_open: project.seatsOpen,
      roles_open: slots.map((s) => s.skill_name),
      members: project.members.map((m) => ({ name: m.name, role: m.role })),
    },
    skipped: reasonsToStop,
    pool_size: candidates.length,
    shortlist: shortlist.map((team) => ({
      id: team.id,
      points: team.score.points,
      parts: team.score.parts,
      roles_uncovered: team.score.unfilledSlots,
      members: team.members.map((m) => ({
        id: m.id,
        name: m.name,
        hours_per_week: m.availability_hours,
        assigned_role:
          team.score.assignments.find((a) => a.student.id === m.id)?.slot.skill_name ?? null,
      })),
      why: explain(team.score, loaded.skillById),
    })),
    verdict,
  };
}
