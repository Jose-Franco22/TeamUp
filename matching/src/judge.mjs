// Stage 2, the judge: the LLM reads the jury's short list and picks a winner.
//
// Three rules keep this honest:
//   1. It only ever reorders the short list. Team ids are an enum in the
//      schema, so the model cannot invent a team or add a student.
//   2. It never sees names, emails or ids — only "Student A, React, 14 months".
//   3. If there is no API key, or the call fails or is rate limited, the
//      jury's order stands and the verdict says so.
//
// One call per project, not per student, so the free tier's 15 requests a
// minute is never the bottleneck.

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

// Stable letters per student across the whole short list, so "Student A" means
// the same person in every team the judge compares.
function anonymize(shortlist) {
  const labels = new Map();
  for (const team of shortlist) {
    for (const member of team.members) {
      if (!labels.has(member.id)) {
        labels.set(member.id, `Student ${String.fromCharCode(65 + labels.size)}`);
      }
    }
  }
  return labels;
}

function digest(shortlist, labels, skillById) {
  return shortlist.map((team) => ({
    team_id: team.id,
    jury_points: team.score.points,
    jury_parts: Object.fromEntries(
      Object.entries(team.score.parts).map(([k, v]) => [k, Number(v.toFixed(2))]),
    ),
    roles_uncovered: team.score.unfilledSlots,
    members: team.members.map((member) => ({
      label: labels.get(member.id),
      hours_per_week: member.availability_hours,
      skills: Object.entries(member.skills).map(
        ([skillId, evidence]) =>
          `${skillById[skillId].name} (${evidence.months} months, ${evidence.projects} projects)`,
      ),
      assigned_role:
        team.score.assignments.find((a) => a.student.id === member.id)?.slot.skill_name ?? null,
    })),
  }));
}

function schemaFor(teamIds) {
  return {
    type: 'object',
    properties: {
      best_team_id: { type: 'string', enum: teamIds },
      ranking: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            team_id: { type: 'string', enum: teamIds },
            why: { type: 'string' },
          },
          required: ['team_id', 'why'],
        },
      },
      risks: { type: 'array', items: { type: 'string' } },
    },
    required: ['best_team_id', 'ranking'],
  };
}

// The judge may disagree with the points, but it has to say why.
function promptFor(project, teams) {
  return `You are helping pick a senior project team.

Project: ${project.title}
What it is: ${project.description}
Roles still open: ${project.roles.map((r) => `${r.skill_name} x${r.quantity_needed}`).join(', ')}
Seats left: ${project.seatsOpen}

A scoring system already ranked these candidate teams. Higher jury_points ranked
higher. Review them as a hiring committee would: consider whether the evidence
behind each skill is convincing, whether the team's hours per week are workable
together, and whether any role is left uncovered.

Rank every team from best to worst. You may disagree with the points, but say
why in one sentence per team. Use only the team ids given.

${JSON.stringify(teams, null, 2)}`;
}

export async function judgeShortlist({
  project,
  shortlist,
  skillById,
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite',
  fetchImpl = fetch,
}) {
  const juryOrder = shortlist.map((team, index) => ({
    team_id: team.id,
    why: `Jury rank ${index + 1}, ${team.score.points} points`,
  }));
  const fallback = (reason) => ({
    source: 'jury-only',
    reason,
    best_team_id: shortlist[0]?.id ?? null,
    ranking: juryOrder,
    risks: [],
  });

  if (!shortlist.length) return fallback('no teams to judge');
  if (!apiKey) return fallback('GEMINI_API_KEY not set');

  const labels = anonymize(shortlist);
  const teamIds = shortlist.map((t) => t.id);
  // Shuffle so the judge cannot simply agree with whatever came first.
  const shuffled = digest(shortlist, labels, skillById).sort((a, b) =>
    a.team_id.localeCompare(b.team_id),
  );
  shuffled.reverse();

  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptFor(project, shuffled) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseJsonSchema: schemaFor(teamIds),
        },
      }),
    });
  } catch (err) {
    return fallback(`request failed: ${err.message}`);
  }

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (body.error?.message ?? '').split('\n')[0];
    return fallback(`HTTP ${response.status}: ${message}`);
  }

  const text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  let verdict;
  try {
    verdict = JSON.parse(text);
  } catch {
    return fallback('model returned something that is not JSON');
  }

  // Trust nothing: keep only known team ids, drop duplicates, and append any
  // team the model forgot in the jury's order.
  const seen = new Set();
  const ranking = (verdict.ranking ?? [])
    .filter((row) => teamIds.includes(row?.team_id) && !seen.has(row.team_id) && seen.add(row.team_id))
    .map((row) => ({ team_id: row.team_id, why: String(row.why ?? '').slice(0, 300) }));
  for (const row of juryOrder) {
    if (!seen.has(row.team_id)) ranking.push(row);
  }

  const best = teamIds.includes(verdict.best_team_id) ? verdict.best_team_id : ranking[0].team_id;

  return {
    source: 'llm-judge',
    model,
    best_team_id: best,
    ranking,
    risks: Array.isArray(verdict.risks) ? verdict.risks.slice(0, 5).map(String) : [],
    agreed_with_jury: best === shortlist[0].id,
    tokens: {
      in: body.usageMetadata?.promptTokenCount,
      out: body.usageMetadata?.candidatesTokenCount,
    },
  };
}
