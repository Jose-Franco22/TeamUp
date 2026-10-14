// Demo branch: joining is instant. joinProject() must leave the mock tables
// as an accepted request would — the request row, the roster seat, the
// released role — with no approval step and no notification.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as client from './client';
import { joinRequests, notifications, projectRolesNeeded, teamMembers } from './mockData';

const snapshot = {};
beforeEach(() => {
  snapshot.joinRequests = joinRequests.map((r) => ({ ...r }));
  snapshot.teamMembers = teamMembers.map((m) => ({ ...m }));
  snapshot.projectRolesNeeded = projectRolesNeeded.map((n) => ({ ...n }));
  snapshot.notifications = notifications.map((n) => ({ ...n }));
});
afterEach(() => {
  joinRequests.splice(0, joinRequests.length, ...snapshot.joinRequests);
  teamMembers.splice(0, teamMembers.length, ...snapshot.teamMembers);
  projectRolesNeeded.splice(0, projectRolesNeeded.length, ...snapshot.projectRolesNeeded);
  notifications.splice(0, notifications.length, ...snapshot.notifications);
  client.setSessionUserId(null);
});

describe('joinProject (demo)', () => {
  test('seats the student in an open role and records an accepted request', async () => {
    client.setSessionUserId('u-sofia');
    const notified = notifications.length;
    const row = await client.joinProject('p-parking');

    expect(row).toMatchObject({ project_id: 'p-parking', user_id: 'u-sofia', status: 'accepted' });
    const seat = teamMembers.find((m) => m.user_id === 'u-sofia');
    expect(seat).toMatchObject({ team_id: 't-parking' });
    const before = snapshot.projectRolesNeeded.find(
      (n) => n.project_id === 'p-parking' && n.role_id === seat.role_id
    );
    const after = projectRolesNeeded.find(
      (n) => n.project_id === 'p-parking' && n.role_id === seat.role_id
    );
    expect(after.quantity_needed).toBe(before.quantity_needed - 1);
    expect(notifications).toHaveLength(notified);
  });

  test('refuses a second team and your own project', async () => {
    client.setSessionUserId('u-sofia');
    await client.joinProject('p-parking');
    await expect(client.joinProject('p-degree')).rejects.toThrow(/already on a team/);

    client.setSessionUserId('u-nicolas');
    await expect(client.joinProject('p-parking')).rejects.toThrow(/your own project/);
  });
});
