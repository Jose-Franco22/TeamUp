// Stage 1, second half: search for the best candidate teams.
//
// Checking every combination doesn't scale — 24 students for 3 seats is 2,024
// teams, and a real cohort with 4 seats is far worse. So this builds teams one
// member at a time and keeps only the best partial teams at each step (a beam
// search). The result is a short list the judge can actually read.

import { scoreTeam } from './scoring.mjs';

const teamKey = (members) =>
  members
    .map((m) => m.id)
    .sort()
    .join('+');

// Ties break on the team key so two runs on the same data agree.
const byScore = (a, b) => b.score.total - a.score.total || a.key.localeCompare(b.key);

export function shortlistTeams({
  project,
  candidates,
  slots,
  skillById,
  seats,
  limit = 5,
  beamWidth = 12,
}) {
  const teamSize = Math.min(seats, candidates.length);
  if (teamSize <= 0 || candidates.length === 0) return [];

  let partials = [{ members: [], key: '', score: null }];

  for (let depth = 0; depth < teamSize; depth++) {
    const next = new Map();

    for (const partial of partials) {
      for (const candidate of candidates) {
        if (partial.members.some((m) => m.id === candidate.id)) continue;

        const members = [...partial.members, candidate];
        const key = teamKey(members);
        if (next.has(key)) continue; // same team, different order

        next.set(key, {
          key,
          members,
          score: scoreTeam({ project, candidates: members, slots, skillById, seats }),
        });
      }
    }

    partials = [...next.values()].sort(byScore).slice(0, beamWidth);
  }

  return partials.slice(0, limit).map((team, index) => ({
    id: `T${index + 1}`,
    members: team.members,
    score: team.score,
  }));
}
