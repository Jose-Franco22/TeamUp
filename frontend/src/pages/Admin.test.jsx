// Issue #37: teams, unplaced students, summary counts and empty states.
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Admin from './Admin';
import { getAdminActions, getAdminDashboard } from '../api/client';
import { DASHBOARD, EMPTY_DASHBOARD, FULL_TEAM, OPEN_TEAM } from '../test/adminFixtures';

vi.mock('../api/client', () => ({
  getAdminDashboard: vi.fn(),
  getAdminActions: vi.fn(),
  // The Semester panel and Past semesters (#61), which this page now holds.
  getSemesterClosePreview: vi.fn(async () => ({
    semester_id: 'sem-fall-2026', name: 'Fall 2026', starts_on: '2026-08-24', ends_on: '2026-12-12',
    teams: 2, students: 3, pending_join_requests: 1, pending_adviser_requests: 0, adviser_links: 1,
  })),
  getPastSemesters: vi.fn(async () => []),
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

test('shows each team\'s progress through the next-steps checklist (#42)', async () => {
  getAdminDashboard.mockReset().mockResolvedValue({
    ...DASHBOARD,
    teams: DASHBOARD.teams.map((t) => ({
      ...t,
      next_steps: t.status === 'full' ? { done: 2, total: 5 } : { done: 0, total: 5 },
    })),
  });
  renderAdmin();
  const teams = await screen.findByRole('table', { name: 'All teams' });
  expect(within(teams).getByRole('columnheader', { name: 'Next steps' })).toBeInTheDocument();
  const fullRow = within(teams).getByRole('link', { name: 'Lab equipment sign-out' }).closest('tr');
  expect(within(fullRow).getByText('2 of 5 done')).toBeInTheDocument();
  // An open team hasn't started: the cell says when it will, not "open" again.
  const openRow = within(teams).getByRole('link', { name: 'Campus parking tracker' }).closest('tr');
  expect(within(openRow).getByText('Starts when the team is full')).toBeInTheDocument();
  expect(within(openRow).getByText('—')).toHaveAttribute('aria-hidden', 'true');
  expect(within(openRow).queryByText('Not complete yet')).not.toBeInTheDocument();
});

test('an open team that already has checklist progress still shows it', async () => {
  getAdminDashboard.mockReset().mockResolvedValue({ ...DASHBOARD, teams: [{ ...OPEN_TEAM, next_steps: { done: 2, total: 5 } }] });
  renderAdmin();
  const teams = await screen.findByRole('table', { name: 'All teams' });
  expect(within(teams).getByText('2 of 5 done')).toBeInTheDocument();
  expect(within(teams).queryByText('Starts when the team is full')).not.toBeInTheDocument();
});

test('a team that has finished the checklist is marked done, and an empty checklist says so', async () => {
  const [first] = DASHBOARD.teams.filter((t) => t.status === 'full');
  getAdminDashboard.mockReset().mockResolvedValue({ ...DASHBOARD, teams: [{ ...first, next_steps: { done: 3, total: 3 } }] });
  renderAdmin();
  expect(await screen.findByText('3 of 3 done')).toHaveClass('done');

  getAdminDashboard.mockReset().mockResolvedValue({ ...DASHBOARD, teams: [{ ...first, next_steps: { done: 0, total: 0 } }] });
  render(<MemoryRouter><Admin /></MemoryRouter>);
  expect(await screen.findByText('No checklist yet')).toBeInTheDocument();
});

// ---------- the teams table: sorting, filtering, empty states ----------

// Four teams whose orders differ by every sort key. The server sends them
// by title, as admin_dashboard() does.
const ALPHA = { ...FULL_TEAM, id: 'alpha', title: 'Alpha', team_size_target: 3, member_count: 3, next_steps: { done: 4, total: 5 } };
const BRAVO = { ...OPEN_TEAM, id: 'bravo', title: 'Bravo', team_size_target: 4, member_count: 3, next_steps: { done: 0, total: 5 } };
const CHARLIE = { ...OPEN_TEAM, id: 'charlie', title: 'Charlie', team_size_target: 4, member_count: 1, next_steps: { done: 0, total: 5 } };
const DELTA = { ...FULL_TEAM, id: 'delta', title: 'Delta', team_size_target: 2, member_count: 2, next_steps: { done: 1, total: 5 } };
const SORTABLE = { ...DASHBOARD, teams: [ALPHA, BRAVO, CHARLIE, DELTA], summary: { formed_teams: 2, open_teams: 2, unplaced_students: 2 } };

async function renderTeams(dashboard = SORTABLE) {
  getAdminDashboard.mockReset().mockResolvedValue(dashboard);
  renderAdmin();
  await screen.findByRole('table', { name: 'All teams' });
  return userEvent.setup();
}
const order = () => within(screen.getByRole('table', { name: 'All teams' })).getAllByRole('rowheader').map((th) => th.textContent);
const header = (name) => screen.getByRole('columnheader', { name });
const arrow = (name) => header(name).querySelector('svg').dataset.direction;

test('by default the teams needing attention come first', async () => {
  await renderTeams();
  // Open teams, emptiest first; then full teams, least checklist progress first.
  expect(order()).toEqual(['Charlie', 'Bravo', 'Delta', 'Alpha']);
  expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveDisplayValue('Needs attention first');
  for (const name of ['Team', 'Seats filled', 'Status', 'Next steps']) expect(header(name)).not.toHaveAttribute('aria-sort');
});

test('clicking a column title sorts ascending, clicking again sorts descending, and the arrow shows which', async () => {
  const user = await renderTeams();
  await user.click(screen.getByRole('button', { name: 'Team' }));
  expect(order()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  expect(header('Team')).toHaveAttribute('aria-sort', 'ascending');
  expect(arrow('Team')).toBe('asc');

  await user.click(screen.getByRole('button', { name: 'Team' }));
  expect(order()).toEqual(['Delta', 'Charlie', 'Bravo', 'Alpha']);
  expect(header('Team')).toHaveAttribute('aria-sort', 'descending');
  expect(arrow('Team')).toBe('desc');
  expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveDisplayValue('Team, Z to A');
});

test('seats filled sorts by how full each team is, not by head count', async () => {
  const user = await renderTeams();
  await user.click(screen.getByRole('button', { name: 'Seats filled' }));
  expect(order()).toEqual(['Charlie', 'Bravo', 'Delta', 'Alpha']);
  await user.click(screen.getByRole('button', { name: 'Seats filled' }));
  expect(order()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
  expect(header('Seats filled')).toHaveAttribute('aria-sort', 'descending');
  expect(arrow('Team')).toBe('none');
});

test('status sorts open teams first, then full ones first', async () => {
  const user = await renderTeams();
  await user.click(screen.getByRole('button', { name: 'Status' }));
  expect(order()).toEqual(['Bravo', 'Charlie', 'Alpha', 'Delta']);
  await user.click(screen.getByRole('button', { name: 'Status' }));
  expect(order()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
});

test('next steps sorts by checklist progress, with teams that have not started last either way', async () => {
  const user = await renderTeams();
  await user.click(screen.getByRole('button', { name: 'Next steps' }));
  expect(order()).toEqual(['Delta', 'Alpha', 'Bravo', 'Charlie']);
  await user.click(screen.getByRole('button', { name: 'Next steps' }));
  expect(order()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
});

test('the toolbar sort sets the same order as the column titles', async () => {
  const user = await renderTeams();
  await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'Seats filled, most first');
  expect(order()).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie']);
  expect(header('Seats filled')).toHaveAttribute('aria-sort', 'descending');
});

test('the status filter narrows the list, shows a removable chip, and removing it restores the list', async () => {
  const user = await renderTeams();
  expect(screen.getByText('Showing all 4 teams')).toBeInTheDocument();

  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'full');
  expect(order()).toEqual(['Delta', 'Alpha']);
  expect(screen.getByText('Status: full')).toBeInTheDocument();
  expect(screen.getByText('Showing 2 of 4 teams')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Remove filter: status full' }));
  expect(order()).toEqual(['Charlie', 'Bravo', 'Delta', 'Alpha']);
  expect(screen.queryByText('Status: full')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
  expect(screen.getByText('Showing all 4 teams')).toBeInTheDocument();
});

test('filtering keeps the chosen sort', async () => {
  const user = await renderTeams();
  await user.click(screen.getByRole('button', { name: 'Team' }));
  await user.click(screen.getByRole('button', { name: 'Team' }));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'open');
  expect(order()).toEqual(['Charlie', 'Bravo']);
});

test('a filter that matches nothing gets its own empty state, which clears the filter', async () => {
  const user = await renderTeams({ ...DASHBOARD, teams: [OPEN_TEAM] });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'full');
  expect(screen.getByText('No teams match this filter.')).toBeInTheDocument();
  expect(screen.queryByText('No teams yet.')).not.toBeInTheDocument();
  expect(screen.queryByRole('table', { name: 'All teams' })).not.toBeInTheDocument();
  expect(screen.getByText('Showing 0 of 1 team')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Clear filter' }));
  expect(order()).toEqual(['Campus parking tracker']);
  expect(screen.queryByText('No teams match this filter.')).not.toBeInTheDocument();
});

test('with no teams at all there is nothing to filter: the first-run empty state, no toolbar', async () => {
  getAdminDashboard.mockResolvedValue(EMPTY_DASHBOARD);
  renderAdmin();
  expect(await screen.findByText('No teams yet.')).toBeInTheDocument();
  expect(screen.queryByText('No teams match this filter.')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Status' })).not.toBeInTheDocument();
});

test('"Students unplaced" links to the unplaced students table further down', async () => {
  renderAdmin();
  const link = await screen.findByRole('link', { name: /students unplaced/i });
  expect(link).toHaveTextContent('2');
  expect(link).toHaveAttribute('href', '#unplaced-heading');
  const target = document.getElementById(link.getAttribute('href').slice(1));
  expect(target).toHaveTextContent('Unplaced students');
  expect(screen.getByRole('table', { name: 'Unplaced students' })).toHaveAttribute('aria-labelledby', target.id);
});
