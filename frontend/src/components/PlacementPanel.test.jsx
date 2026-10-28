// Issue #39: the admin's assign / move / remove controls on a student's page.
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlacementPanel from './PlacementPanel';
import { adminAssignStudent, adminMoveStudent, getAdminDashboard, getRoles, removeMember } from '../api/client';
import { DASHBOARD, OPEN_TEAM, UNPLACED_STUDENT } from '../test/adminFixtures';

vi.mock('../api/client', () => ({
  adminAssignStudent: vi.fn(),
  adminMoveStudent: vi.fn(),
  getAdminDashboard: vi.fn(),
  getRoles: vi.fn(),
  removeMember: vi.fn(),
}));

const ROLES = [
  { id: 'backend', name: 'Backend Developer' },
  { id: 'frontend', name: 'Frontend Developer' },
];
const SECOND_OPEN = { ...OPEN_TEAM, id: 'team-two', title: 'Degree planner', member_count: 2, team_size_target: 3, roles_needed: [] };
const PLACED = {
  ...UNPLACED_STUDENT,
  membership: { team_id: 'team-open', project_id: 'project-open', project_title: 'Campus parking tracker', role_id: 'frontend', role_name: 'Frontend Developer' },
};

beforeEach(() => {
  getAdminDashboard.mockResolvedValue({ ...DASHBOARD, teams: [...DASHBOARD.teams, SECOND_OPEN] });
  getRoles.mockResolvedValue(ROLES);
});

test('the assign form lists only teams with an open seat', async () => {
  render(<PlacementPanel student={UNPLACED_STUDENT} />);
  const select = await screen.findByLabelText('Team');
  const options = within(select).getAllByRole('option').map((o) => o.textContent);
  expect(options).toEqual(['Choose a team…', 'Campus parking tracker (1 of 4)', 'Degree planner (2 of 3)']);
  expect(options.join()).not.toContain('Lab equipment sign-out');
});

test('picking a team suggests the role it is recruiting, and assigning confirms', async () => {
  const onChanged = vi.fn();
  adminAssignStudent.mockResolvedValue({});
  const user = userEvent.setup();
  render(<PlacementPanel student={UNPLACED_STUDENT} onChanged={onChanged} />);

  await user.selectOptions(await screen.findByLabelText('Team'), 'team-open');
  expect(screen.getByLabelText('Role')).toHaveValue('frontend');
  await user.click(screen.getByRole('button', { name: 'Assign Adan' }));

  expect(adminAssignStudent).toHaveBeenCalledWith('adan', 'team-open', 'frontend');
  expect(await screen.findByRole('status')).toHaveTextContent('Placed Adan Barrera on “Campus parking tracker”.');
  expect(onChanged).toHaveBeenCalled();
});

test('a refused assignment shows the reason', async () => {
  adminAssignStudent.mockRejectedValue(new Error('This team is already full'));
  const user = userEvent.setup();
  render(<PlacementPanel student={UNPLACED_STUDENT} />);

  await user.selectOptions(await screen.findByLabelText('Team'), 'team-two');
  await user.selectOptions(screen.getByLabelText('Role'), 'backend');
  await user.click(screen.getByRole('button', { name: 'Assign Adan' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('This team is already full');
});

test('a placed student can be moved, but not onto the team they are on', async () => {
  adminMoveStudent.mockResolvedValue({});
  const user = userEvent.setup();
  render(<PlacementPanel student={PLACED} />);

  const select = await screen.findByLabelText('Team');
  expect(within(select).queryByText(/Campus parking tracker/)).not.toBeInTheDocument();
  await user.selectOptions(select, 'team-two');
  await user.selectOptions(screen.getByLabelText('Role'), 'backend');
  await user.click(screen.getByRole('button', { name: 'Move Adan' }));

  expect(adminMoveStudent).toHaveBeenCalledWith('adan', 'team-two', 'backend');
  expect(await screen.findByRole('status')).toHaveTextContent('Moved Adan Barrera to “Degree planner”.');
});

test('removing asks first, then confirms', async () => {
  removeMember.mockResolvedValue();
  const user = userEvent.setup();
  render(<PlacementPanel student={PLACED} />);

  await user.click(await screen.findByRole('button', { name: 'Remove from team' }));
  expect(removeMember).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Remove from “Campus parking tracker”' }));

  expect(removeMember).toHaveBeenCalledWith('adan');
  expect(await screen.findByRole('status')).toHaveTextContent('Took Adan Barrera off “Campus parking tracker”.');
});

test('a project creator gets no move or remove controls', async () => {
  const creator = { ...PLACED, id: 'owner', name: 'Nicolas Guerra' };
  render(<PlacementPanel student={creator} />);
  expect(await screen.findByText(/can't be moved or removed/)).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
