// Issue #35 — leaving a team (runs against the mock API). Jose is on Nicolas's
// "Campus parking tracker" in the fixtures; Nicolas created it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Team from './Team';
import * as client from '../api/client';
import { appSettings, notifications, projects, teamMembers, teams } from '../api/mockData';
import { SessionProvider } from '../auth/SessionContext';

// Spy on leaveTeam but keep the real (mock-mode) implementation, so a test
// can check it isn't called before the student confirms.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, leaveTeam: vi.fn(actual.leaveTeam) };
});

const MEMBER = 'u-jose';
const CREATOR = 'u-nicolas';

// Leaving mutates the shared fixtures; put them back after every test.
let snapshot;
beforeEach(() => {
  snapshot = {
    teamMembers: teamMembers.map((x) => ({ ...x })),
    teams: teams.map((x) => ({ ...x })),
    projects: projects.map((x) => ({ ...x })),
  };
  vi.mocked(client.leaveTeam).mockClear();
});
afterEach(() => {
  teamMembers.splice(0, teamMembers.length, ...snapshot.teamMembers);
  teams.splice(0, teams.length, ...snapshot.teams);
  projects.splice(0, projects.length, ...snapshot.projects);
  notifications.length = 0;
  appSettings.formation_deadline = null;
});

async function renderTeamAs(userId) {
  localStorage.setItem('teamup.mockSessionUserId', userId);
  client.setSessionUserId(userId);
  render(
    <MemoryRouter initialEntries={['/team']}>
      <SessionProvider>
        <Routes>
          <Route path="/team" element={<Team />} />
          <Route path="/browse" element={<h1>Browse page</h1>} />
        </Routes>
      </SessionProvider>
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Your team' });
}

const leaveButton = () => screen.queryByRole('button', { name: 'Leave team' });

describe('leaving', () => {
  test('Leave asks for confirmation before leaving', async () => {
    const user = userEvent.setup();
    await renderTeamAs(MEMBER);

    await user.click(leaveButton());
    expect(screen.getByText('Leave “Campus parking tracker”?')).toBeInTheDocument();
    expect(client.leaveTeam).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(client.leaveTeam).not.toHaveBeenCalled();
    expect(leaveButton()).toBeInTheDocument();

    await user.click(leaveButton());
    await user.click(screen.getByRole('button', { name: 'Yes, leave' }));
    expect(client.leaveTeam).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('heading', { name: 'Browse page' })).toBeInTheDocument();
    expect(teamMembers.some((tm) => tm.user_id === MEMBER)).toBe(false);
  });

  test('Leave button is not shown to the creator', async () => {
    await renderTeamAs(CREATOR);
    expect(leaveButton()).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leave this team' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete team' })).toBeInTheDocument();
  });

  test('the member is told the creator will be notified', async () => {
    await renderTeamAs(MEMBER);
    expect(screen.getByText(/Nicolas Guerra will be notified that you left/)).toBeInTheDocument();
  });
});

describe('formation deadline', () => {
  test('after the deadline the Leave button is gone and the student is pointed to an admin', async () => {
    appSettings.formation_deadline = '2020-01-01T00:00:00Z';
    await renderTeamAs(MEMBER);
    expect(leaveButton()).not.toBeInTheDocument();
    expect(screen.getByText(/ask an admin to take you off the team/)).toBeInTheDocument();
  });

  test('before the deadline the student is warned when rosters lock', async () => {
    appSettings.formation_deadline = '2999-01-01T00:00:00Z';
    await renderTeamAs(MEMBER);
    expect(leaveButton()).toBeInTheDocument();
    expect(screen.getByText(/Rosters lock on/)).toBeInTheDocument();
  });

  test('leaveTeam() itself refuses after the deadline', async () => {
    appSettings.formation_deadline = '2020-01-01T00:00:00Z';
    client.setSessionUserId(MEMBER);
    await expect(client.leaveTeam()).rejects.toThrow(/formation deadline has passed/);
    expect(teamMembers.some((tm) => tm.user_id === MEMBER)).toBe(true);
  });
});

describe('the creator is notified', () => {
  test('after a member leaves, the creator sees who left and can dismiss it', async () => {
    const user = userEvent.setup();
    client.setSessionUserId(MEMBER);
    await client.leaveTeam();

    await renderTeamAs(CREATOR);
    expect(await screen.findByText(/Jose Franco Garza left the team/)).toBeInTheDocument();
    expect(screen.getByText(/Still forming · 1 of 4/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Jose Franco Garza left the team/)).not.toBeInTheDocument();
    await waitFor(() => expect(notifications.every((n) => n.read_at)).toBe(true));
  });
});
