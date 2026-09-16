import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eligibleCandidates, loadWorld, openSlots } from '../src/data.mjs';
import { shortlistTeams } from '../src/shortlist.mjs';
import { judgeShortlist } from '../src/judge.mjs';
import { recommendTeams } from '../src/recommend.mjs';

const world = loadWorld();
const parking = world.projectById['p-parking'];

const buildShortlist = (limit = 5) =>
  shortlistTeams({
    project: parking,
    candidates: eligibleCandidates(world, parking),
    slots: openSlots(parking),
    skillById: world.skillById,
    seats: parking.seatsOpen,
    limit,
  });

test('candidates exclude anyone already on a team and the creator', () => {
  const candidates = eligibleCandidates(world, parking);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((c) => !c.onTeam));
  assert.ok(!candidates.some((c) => c.id === parking.creator_id));
});

test('a shortlisted team fills exactly the open seats, with no repeats', () => {
  const shortlist = buildShortlist();
  assert.ok(shortlist.length > 0 && shortlist.length <= 5);
  for (const team of shortlist) {
    assert.equal(team.members.length, parking.seatsOpen);
    assert.equal(new Set(team.members.map((m) => m.id)).size, team.members.length);
  }
});

test('teams come back best first', () => {
  const points = buildShortlist().map((t) => t.score.points);
  assert.deepEqual(points, [...points].sort((a, b) => b - a));
});

test('the same data always produces the same shortlist', () => {
  const first = buildShortlist().map((t) => t.members.map((m) => m.id).join('+'));
  const second = buildShortlist().map((t) => t.members.map((m) => m.id).join('+'));
  assert.deepEqual(first, second);
});

test('a full project gets no recommendations', async () => {
  const result = await recommendTeams('p-lab', { world });
  assert.equal(result.skipped, 'project is full');
  assert.deepEqual(result.shortlist, []);
});

test('every recommendation carries a reason', async () => {
  const result = await recommendTeams('p-parking', { world });
  assert.ok(result.shortlist.length > 0);
  for (const team of result.shortlist) {
    assert.ok(team.why.length > 0);
    assert.ok(team.why.every((line) => typeof line === 'string' && line.length > 0));
  }
});

test('without an API key the jury has the final word', async () => {
  const shortlist = buildShortlist();
  const verdict = await judgeShortlist({
    project: parking,
    shortlist,
    skillById: world.skillById,
    apiKey: '',
  });
  assert.equal(verdict.source, 'jury-only');
  assert.equal(verdict.best_team_id, shortlist[0].id);
});

test('a rate-limited judge falls back to the jury instead of failing', async () => {
  const shortlist = buildShortlist();
  const verdict = await judgeShortlist({
    project: parking,
    shortlist,
    skillById: world.skillById,
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Quota exceeded' } }),
    }),
  });
  assert.equal(verdict.source, 'jury-only');
  assert.match(verdict.reason, /429/);
  assert.equal(verdict.best_team_id, shortlist[0].id);
});

test('the judge may reorder the shortlist', async () => {
  const shortlist = buildShortlist();
  const second = shortlist[1].id;
  const verdict = await judgeShortlist({
    project: parking,
    shortlist,
    skillById: world.skillById,
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    best_team_id: second,
                    ranking: [{ team_id: second, why: 'steadier hours' }],
                    risks: ['one role rests on a single person'],
                  }),
                },
              ],
            },
          },
        ],
      }),
    }),
  });

  assert.equal(verdict.source, 'llm-judge');
  assert.equal(verdict.best_team_id, second);
  assert.equal(verdict.agreed_with_jury, false);
  // Teams the model left out are still ranked, in the jury's order.
  assert.equal(verdict.ranking.length, shortlist.length);
  assert.equal(verdict.risks.length, 1);
});

test('the judge cannot invent a team that was not shortlisted', async () => {
  const shortlist = buildShortlist();
  const verdict = await judgeShortlist({
    project: parking,
    shortlist,
    skillById: world.skillById,
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    best_team_id: 'T99',
                    ranking: [{ team_id: 'T99', why: 'made up' }],
                  }),
                },
              ],
            },
          },
        ],
      }),
    }),
  });

  const ids = verdict.ranking.map((r) => r.team_id);
  assert.ok(!ids.includes('T99'));
  assert.ok(shortlist.map((t) => t.id).includes(verdict.best_team_id));
});

test('the judge never sees names or ids', async () => {
  const shortlist = buildShortlist();
  let sentBody = '';
  await judgeShortlist({
    project: parking,
    shortlist,
    skillById: world.skillById,
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      sentBody = options.body;
      return { ok: true, status: 200, json: async () => ({}) };
    },
  });

  for (const team of shortlist) {
    for (const member of team.members) {
      assert.ok(!sentBody.includes(member.name), `leaked name ${member.name}`);
      assert.ok(!sentBody.includes(member.id), `leaked id ${member.id}`);
    }
  }
  assert.match(sentBody, /Student A/);
});
