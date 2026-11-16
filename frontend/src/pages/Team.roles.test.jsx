// The project owner edits teammates' roles from the Team page
// (runs against the mock API). Jose is on Nicolas's "Campus parking
// tracker" as Data; Nicolas created it.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Team from './Team';
import * as client from '../api/client';
import { projectRolesNeeded, teamMembers } from '../api/mockData';
import { SessionProvider } from '../auth/SessionContext';

const MEMBER = 'u-jose';
const CREATOR = 'u-nicolas';

let snapshot;
beforeEach(() => {
  snapshot = {
    teamMembers: teamMembers.map((x) => ({ ...x })),
    projectRolesNeeded: projectRolesNeeded.map((x) => ({ ...x })),
  };
});
afterEach(() => {
  teamMembers.splice(0, teamMembers.length, ...snapshot.teamMembers);
  projectRolesNeeded.splice(0, projectRolesNeeded.length, ...snapshot.projectRolesNeeded);
});

async function renderTeamAs(userId) {
  localStorage.setItem('teamup.mockSessionUserId', userId);
  client.setSessionUserId(userId);
  render(
    <MemoryRouter initialEntries={['/team']}>
      <SessionProvider>
        <Routes>
          <Route path="/team" element={<Team />} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Your team' });
}

const joseName = () => teamMembers.find((m) => m.user_id === MEMBER) && 'Jose';

describe('editing roles', () => {
  const open = (roleId) =>
    projectRolesNeeded.find((n) => n.project_id === 'p-parking' && n.role_id === roleId).quantity_needed;

  test('the owner changes a teammate role between two listed roles, and the open seats swap', async () => {
    // Jose starts in Frontend, a role the project recruits for.
    teamMembers.find((m) => m.user_id === MEMBER).role_id = 'r-frontend';
    const user = userEvent.setup();
    await renderTeamAs(CREATOR);
    const select = await screen.findByRole('combobox', { name: new RegExp(`role for ${joseName()}`, 'i') });
    const frontend = open('r-frontend');
    const design = open('r-design');

    await user.selectOptions(select, 'r-design');

    await waitFor(() =>
      expect(teamMembers.find((m) => m.user_id === MEMBER).role_id).toBe('r-design')
    );
    expect(select).toHaveValue('r-design');
    expect(open('r-frontend')).toBe(frontend + 1);
    expect(open('r-design')).toBe(design - 1);
  });

  test('moving from a role the project never listed leaves the open seats alone', async () => {
    // Jose is in Data, which p-parking doesn't recruit for: there is no seat
    // to give back, so none is taken either.
    const user = userEvent.setup();
    await renderTeamAs(CREATOR);
    const select = await screen.findByRole('combobox', { name: new RegExp(`role for ${joseName()}`, 'i') });
    const frontend = open('r-frontend');

    await user.selectOptions(select, 'r-frontend');

    await waitFor(() =>
      expect(teamMembers.find((m) => m.user_id === MEMBER).role_id).toBe('r-frontend')
    );
    expect(open('r-frontend')).toBe(frontend);
  });

  test('the owner can change their own role too', async () => {
    await renderTeamAs(CREATOR);
    expect(await screen.findAllByRole('combobox', { name: /role for/i })).toHaveLength(
      teamMembers.filter((m) => m.team_id === 't-parking').length
    );
  });

  test('a member who is not the owner sees roles as plain text', async () => {
    await renderTeamAs(MEMBER);
    await waitFor(() => expect(screen.queryByRole('combobox', { name: /role for/i })).not.toBeInTheDocument());
  });
});

describe('setMemberRole (demo)', () => {
  test('only the project creator can change roles', async () => {
    client.setSessionUserId(MEMBER);
    await expect(client.setMemberRole(CREATOR, 'r-pm')).rejects.toThrow(/only the project creator/i);
  });
});
