// Issue #30 — the next-steps checklist on the team page shows only once the
// team is full.
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Team from './Team';
import * as client from '../api/client';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ status: 'authenticated', user: { id: 'u-creator' } }),
}));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMyTeam: vi.fn(),
    getNotifications: vi.fn(),
    getTeamChecklist: vi.fn(),
  };
});

const member = (user_id, name) => ({
  user_id, name, role_id: 'r-backend', role: 'Backend Developer', availability_hours: 10, skills: [],
});

const team = (over = {}) => ({
  id: 'p-1',
  team_id: 't-1',
  creator_id: 'u-creator',
  creator_name: 'Nicolas Guerra',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy from camera feeds.',
  team_size_target: 2,
  member_count: 1,
  status: 'open',
  formed_at: null,
  members: [member('u-creator', 'Nicolas Guerra')],
  roles_needed: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  client.getNotifications.mockResolvedValue([]);
  client.getTeamChecklist.mockResolvedValue([
    { id: 'ns-roster', title: 'Confirm your roster', due_at: null, completed_at: null, completed_by: null, completed_by_name: null },
  ]);
});

async function renderTeam() {
  render(
    <MemoryRouter>
      <Team />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: /Campus parking tracker/ });
}

test('a team still forming has no checklist', async () => {
  client.getMyTeam.mockResolvedValue(team());
  await renderTeam();

  expect(screen.queryByRole('heading', { name: 'Next steps' })).not.toBeInTheDocument();
  expect(screen.queryByText('Confirm your roster')).not.toBeInTheDocument();
  expect(client.getTeamChecklist).not.toHaveBeenCalled();
});

test('a full team sees the checklist', async () => {
  client.getMyTeam.mockResolvedValue(
    team({
      status: 'full',
      member_count: 2,
      formed_at: '2026-10-14T16:00:00Z',
      members: [member('u-creator', 'Nicolas Guerra'), member('u-other', 'Sofia Garza')],
    })
  );
  await renderTeam();

  expect(screen.getByRole('heading', { name: 'Next steps' })).toBeInTheDocument();
  expect(await screen.findByText('Confirm your roster')).toBeInTheDocument();
  expect(client.getTeamChecklist).toHaveBeenCalledWith('t-1');
});
