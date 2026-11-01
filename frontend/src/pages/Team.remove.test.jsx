// Issue #29 — removing a member (runs against the mock API). Jose is on
// Nicolas's "Campus parking tracker" in the fixtures; Nicolas created it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Team from './Team';
import * as client from '../api/client';
import { setFormationDeadline, notifications, projects, teamMembers, teams } from '../api/mockData';
import { SessionProvider } from '../auth/SessionContext';

// Spy on removeMember but keep the real (mock-mode) implementation, so a
// test can check it isn't called before the creator confirms.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, removeMember: vi.fn(actual.removeMember) };
});

const MEMBER = 'u-jose';
const CREATOR = 'u-nicolas';
const ADMIN = 'u-instructor';

// Removing mutates the shared fixtures; put them back after every test.
let snapshot;
beforeEach(() => {
  snapshot = {
    teamMembers: teamMembers.map((x) => ({ ...x })),
    teams: teams.map((x) => ({ ...x })),
    projects: projects.map((x) => ({ ...x })),
  };
  vi.mocked(client.removeMember).mockClear();
});
afterEach(() => {
  teamMembers.splice(0, teamMembers.length, ...snapshot.teamMembers);
  teams.splice(0, teams.length, ...snapshot.teams);
  projects.splice(0, projects.length, ...snapshot.projects);
  notifications.length = 0;
  setFormationDeadline(null);
});

async function renderTeamAs(userId, heading = 'Your team') {
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
  await screen.findByRole('heading', { name: heading });
}

const removeButtons = () => screen.queryAllByRole('button', { name: 'Remove' });
// The roster row, not "Created by" in the summary card.
const memberRow = (name) =>
  screen.getAllByText(name).map((el) => el.closest('.row')).find(Boolean);

describe('removing', () => {
  test('Remove asks for confirmation before removing', async () => {
    const user = userEvent.setup();
    await renderTeamAs(CREATOR);

    await user.click(removeButtons()[0]);
    expect(screen.getByRole('button', { name: 'Remove Jose' })).toBeInTheDocument();
    expect(client.removeMember).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(client.removeMember).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Remove Jose' })).not.toBeInTheDocument();

    await user.click(removeButtons()[0]);
    await user.click(screen.getByRole('button', { name: 'Remove Jose' }));
    expect(client.removeMember).toHaveBeenCalledWith(MEMBER);
    await waitFor(() => expect(screen.queryByText('Jose Franco Garza')).not.toBeInTheDocument());
    expect(teamMembers.some((tm) => tm.user_id === MEMBER)).toBe(false);
  });

  test('Remove buttons only appear for the creator, and not on the creator\'s own row', async () => {
    await renderTeamAs(CREATOR);
    const rosterSize = teamMembers.filter((tm) => tm.team_id === 't-parking').length;
    expect(removeButtons()).toHaveLength(rosterSize - 1);
    expect(memberRow('Nicolas Guerra')).not.toContainElement(removeButtons()[0]);
    expect(memberRow('Jose Franco Garza')).toContainElement(removeButtons()[0]);
  });

  test('a member who is not the creator sees no Remove buttons', async () => {
    await renderTeamAs(MEMBER);
    expect(removeButtons()).toHaveLength(0);
  });

  test('a refused removal shows why and keeps the member on screen', async () => {
    const user = userEvent.setup();
    vi.mocked(client.removeMember).mockRejectedValueOnce(new Error('Only the project creator can remove a member'));
    await renderTeamAs(CREATOR);

    await user.click(removeButtons()[0]);
    await user.click(screen.getByRole('button', { name: 'Remove Jose' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the project creator can remove a member');
    expect(screen.getByText('Jose Franco Garza')).toBeInTheDocument();
  });
});

describe('formation deadline', () => {
  test('after the deadline the creator gets no Remove buttons and is pointed to an admin', async () => {
    setFormationDeadline('2020-01-01T00:00:00Z');
    await renderTeamAs(CREATOR);
    expect(removeButtons()).toHaveLength(0);
    expect(screen.getByText(/To remove a member, ask an admin/)).toBeInTheDocument();
  });

  test('removeMember() itself refuses the creator after the deadline', async () => {
    setFormationDeadline('2020-01-01T00:00:00Z');
    client.setSessionUserId(CREATOR);
    await expect(client.removeMember(MEMBER)).rejects.toThrow(/formation deadline has passed/);
    expect(teamMembers.some((tm) => tm.user_id === MEMBER)).toBe(true);
  });

  test('an admin can still remove after the deadline, and the creator is told', async () => {
    setFormationDeadline('2020-01-01T00:00:00Z');
    client.setSessionUserId(ADMIN);
    await client.removeMember(MEMBER);
    expect(teamMembers.some((tm) => tm.user_id === MEMBER)).toBe(false);
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: MEMBER, kind: 'member_removed', by_admin: true }),
        expect.objectContaining({ user_id: CREATOR, kind: 'member_left', actor_id: MEMBER, by_admin: true }),
      ])
    );
  });
});

describe('the removed student is notified', () => {
  test('they see who removed them from which project, and can dismiss it', async () => {
    const user = userEvent.setup();
    client.setSessionUserId(CREATOR);
    await client.removeMember(MEMBER);

    await renderTeamAs(MEMBER, 'You were removed from a team');
    expect(
      screen.getByText(/Nicolas Guerra removed you from “Campus parking tracker”/)
    ).toBeInTheDocument();
    expect(screen.getByText('You are not on a team yet.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/removed you from/)).not.toBeInTheDocument();
    await waitFor(() => expect(notifications.every((n) => n.read_at)).toBe(true));
  });

  test('the creator who removed them is not sent a notice about it', async () => {
    client.setSessionUserId(CREATOR);
    await client.removeMember(MEMBER);
    expect(notifications.filter((n) => n.user_id === CREATOR)).toHaveLength(0);
  });
});
