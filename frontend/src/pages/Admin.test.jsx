// Issue #37: teams, unplaced students, summary counts and empty states.
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Admin from './Admin';
import { getAdminActions, getAdminDashboard } from '../api/client';
import { DASHBOARD, EMPTY_DASHBOARD } from '../test/adminFixtures';

vi.mock('../api/client', () => ({
  getAdminDashboard: vi.fn(),
  getAdminActions: vi.fn(),
}));

beforeEach(() => {
  getAdminDashboard.mockReset().mockResolvedValue(DASHBOARD);
  getAdminActions.mockResolvedValue([]);
});

function renderAdmin() {
  render(<MemoryRouter><Admin /></MemoryRouter>);
}

test('renders all teams with their member roles, filled seats and statuses', async () => {
  renderAdmin();
  const teams = await screen.findByRole('table', { name: 'All teams' });
  const openRow = within(teams).getByRole('link', { name: 'Campus parking tracker' }).closest('tr');
  expect(within(openRow).getByText('Backend Developer')).toBeInTheDocument();
  expect(within(openRow).getByText('1 of 4')).toBeInTheDocument();
  expect(within(openRow).getByText('open')).toBeInTheDocument();
  expect(within(openRow).getByRole('link', { name: 'Nicolas Guerra' })).toHaveAttribute('href', '/admin/students/owner');
  const fullRow = within(teams).getByRole('link', { name: 'Lab equipment sign-out' }).closest('tr');
  expect(within(fullRow).getByText('2 of 2')).toBeInTheDocument();
  expect(within(fullRow).getByText('full')).toBeInTheDocument();
  expect(within(fullRow).getByRole('link', { name: 'Priya Vale' })).toBeInTheDocument();
});

test('shows summary counts and unplaced students with and without pending requests', async () => {
  renderAdmin();
  const unplaced = await screen.findByRole('table', { name: 'Unplaced students' });
  expect(screen.getByText('Teams formed').nextElementSibling).toHaveTextContent('1');
  expect(screen.getByText('Teams still open').nextElementSibling).toHaveTextContent('1');
  expect(screen.getByText('Students unplaced').nextElementSibling).toHaveTextContent('2');
  const adanRow = within(unplaced).getByRole('link', { name: 'Adan Barrera' }).closest('tr');
  expect(within(adanRow).getByText('abarrera01@utrgv.edu')).toBeInTheDocument();
  expect(within(adanRow).getByRole('link', { name: 'Campus parking tracker' })).toHaveAttribute('href', '/admin/teams/team-open');
  const ritaRow = within(unplaced).getByRole('link', { name: 'Rita Cano' }).closest('tr');
  expect(within(ritaRow).getByText('No pending requests')).toBeInTheDocument();
});

test('both empty lists render with zero summary counts', async () => {
  getAdminDashboard.mockResolvedValue(EMPTY_DASHBOARD);
  renderAdmin();
  expect(await screen.findByText('No teams yet.')).toBeInTheDocument();
  expect(screen.getByText('No unplaced students.')).toBeInTheDocument();
  expect(screen.getByText('Students unplaced').nextElementSibling).toHaveTextContent('0');
});

test('teams still render when no students are unplaced', async () => {
  getAdminDashboard.mockResolvedValue({ ...DASHBOARD, unplaced_students: [], summary: { ...DASHBOARD.summary, unplaced_students: 0 } });
  renderAdmin();
  expect(await screen.findByRole('table', { name: 'All teams' })).toBeInTheDocument();
  expect(screen.getByText('No unplaced students.')).toBeInTheDocument();
});

test('unplaced students still render before the first team is created', async () => {
  getAdminDashboard.mockResolvedValue({ ...DASHBOARD, teams: [], summary: { ...DASHBOARD.summary, formed_teams: 0, open_teams: 0 } });
  renderAdmin();
  expect(await screen.findByText('No teams yet.')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Unplaced students' })).toBeInTheDocument();
});

test('a refused server check hides dashboard data and offers retry', async () => {
  getAdminDashboard.mockRejectedValueOnce(new Error('Admin access required'));
  renderAdmin();
  expect(await screen.findByRole('alert')).toHaveTextContent('Admin access required');
  expect(screen.queryByRole('heading', { name: 'Administration' })).not.toBeInTheDocument();
  expect(screen.queryByText('Adan Barrera')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
});

test('refresh reloads the counts and lists', async () => {
  renderAdmin();
  await screen.findByRole('table', { name: 'All teams' });
  getAdminDashboard.mockResolvedValueOnce(EMPTY_DASHBOARD);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('No teams yet.')).toBeInTheDocument();
  expect(screen.getByText('Teams formed').nextElementSibling).toHaveTextContent('0');
});
