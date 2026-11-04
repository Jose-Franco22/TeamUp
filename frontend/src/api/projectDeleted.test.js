// Issue #25, the criterion that shipped unbuilt: when a creator deletes a
// project, everyone still waiting on a request is told.
//
// Mirrors supabase/32_notify_on_project_delete.sql; the pgTAP cases in
// supabase/tests/delete_team.test.sql are the real boundary. This is here so
// mock mode behaves the same way, because that is what every component test
// and the demo actually run against.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createJoinRequest, deleteTeam, respondToRequest, setSessionUserId } from './client';
import { joinRequests, notifications, projects, teamMembers, teams } from './mockData';

const CREATOR = 'u-nicolas'; // creator of p-parking in the fixtures
const PROJECT = 'p-parking';

const snapshot = {};
const noticesFor = (userId, kind) =>
  notifications.filter((n) => n.user_id === userId && n.kind === kind);

beforeEach(() => {
  // These tests delete fixture rows, so the arrays are restored afterwards
  // rather than left shorter for whatever runs next.
  snapshot.projects = [...projects];
  snapshot.teams = [...teams];
  snapshot.teamMembers = [...teamMembers];
  snapshot.joinRequests = [...joinRequests];
  notifications.length = 0;
});

afterEach(() => {
  projects.length = 0; projects.push(...snapshot.projects);
  teams.length = 0; teams.push(...snapshot.teams);
  teamMembers.length = 0; teamMembers.push(...snapshot.teamMembers);
  joinRequests.length = 0; joinRequests.push(...snapshot.joinRequests);
  notifications.length = 0;
  setSessionUserId(null);
});

// The fixture project has other members, which delete_team refuses. Strip it
// back to the creator alone, the only state in which deleting is allowed.
function aloneOnTheProject() {
  const team = teams.find((t) => t.project_id === PROJECT);
  for (let i = teamMembers.length - 1; i >= 0; i -= 1) {
    if (teamMembers[i].team_id === team.id && teamMembers[i].user_id !== CREATOR) {
      teamMembers.splice(i, 1);
    }
  }
  return team;
}

async function requestToJoin(userId) {
  setSessionUserId(userId);
  const request = await createJoinRequest(PROJECT);
  setSessionUserId(CREATOR);
  return request;
}

describe('deleting a project tells the people waiting', () => {
  test('each pending requester gets one notification', async () => {
    const team = aloneOnTheProject();
    await requestToJoin('u-sofia');
    await requestToJoin('u-marcus');

    await deleteTeam(team.id);

    expect(noticesFor('u-sofia', 'project_removed')).toHaveLength(1);
    expect(noticesFor('u-marcus', 'project_removed')).toHaveLength(1);
  });

  // The reason the title is copied rather than referenced: in the database a
  // project_id would cascade this row away with the project.
  test('the notification carries the project name, not a link to it', async () => {
    const team = aloneOnTheProject();
    await requestToJoin('u-sofia');
    const title = projects.find((p) => p.id === PROJECT).title;

    await deleteTeam(team.id);

    const [notice] = noticesFor('u-sofia', 'project_removed');
    expect(notice.project_title).toBe(title);
    expect(notice.project_id).toBeUndefined();
    expect(notice.actor_id).toBe(CREATOR);
  });

  test('it outlives the project and the request it was about', async () => {
    const team = aloneOnTheProject();
    const request = await requestToJoin('u-sofia');

    await deleteTeam(team.id);

    expect(projects.find((p) => p.id === PROJECT)).toBeUndefined();
    expect(joinRequests.find((r) => r.id === request.id)).toBeUndefined();
    expect(noticesFor('u-sofia', 'project_removed')).toHaveLength(1);
  });

  test('somebody already turned down is not told twice', async () => {
    const team = aloneOnTheProject();
    const request = await requestToJoin('u-sofia');
    await respondToRequest(request.id, 'declined');

    await deleteTeam(team.id);

    expect(noticesFor('u-sofia', 'project_removed')).toHaveLength(0);
  });

  test('a project nobody asked about tells nobody', async () => {
    // The other tests get signed in by requestToJoin(); this one never calls it.
    setSessionUserId(CREATOR);
    const team = aloneOnTheProject();
    for (let i = joinRequests.length - 1; i >= 0; i -= 1) {
      if (joinRequests[i].project_id === PROJECT) joinRequests.splice(i, 1);
    }

    await deleteTeam(team.id);

    expect(notifications.filter((n) => n.kind === 'project_removed')).toHaveLength(0);
  });

  test('a refused delete tells nobody — nothing happened', async () => {
    const team = teams.find((t) => t.project_id === PROJECT); // other members still on it
    await requestToJoin('u-sofia');

    await expect(deleteTeam(team.id)).rejects.toThrow(/Remove everyone else/);

    expect(notifications.filter((n) => n.kind === 'project_removed')).toHaveLength(0);
    expect(projects.find((p) => p.id === PROJECT)).toBeTruthy();
  });
});
