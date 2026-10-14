// Issue #38: the admin's milestone form and the students' banner, against the
// mock API.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { MilestoneBanner, MilestoneManager } from './Milestones';
import { setSessionUserId } from '../api/client';
import { milestones } from '../api/mockData';

beforeEach(() => {
  milestones.length = 0;
  setSessionUserId('u-instructor');
});
afterEach(() => setSessionUserId(null));

test('the form asks for a name and a date before saving', async () => {
  const user = userEvent.setup();
  render(<MilestoneManager />);
  await screen.findByText(/No milestones yet/);

  await user.click(screen.getByRole('button', { name: 'Add milestone' }));
  expect(screen.getByText('Give the milestone a name')).toBeInTheDocument();
  expect(screen.getByText('Pick a due date and time')).toBeInTheDocument();
  expect(milestones).toHaveLength(0);

  await user.type(screen.getByLabelText('Name'), 'x'.repeat(81));
  expect(screen.getByText('Keep the name to 80 characters or fewer')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
});

test('a saved milestone shows in the admin list and in the student banner', async () => {
  const user = userEvent.setup();
  render(<MilestoneManager />);
  await screen.findByText(/No milestones yet/);

  await user.type(screen.getByLabelText('Name'), 'Proposal due');
  await user.type(screen.getByLabelText('Due'), '2999-11-01T12:00');
  await user.click(screen.getByRole('button', { name: 'Add milestone' }));

  expect(await screen.findByRole('status')).toHaveTextContent('Added “Proposal due”.');
  const list = await screen.findByRole('list', { name: 'Milestones' });
  expect(within(list).getByText('Proposal due')).toBeInTheDocument();

  setSessionUserId('u-adan');
  render(<MemoryRouter><MilestoneBanner /></MemoryRouter>);
  const banner = await screen.findByRole('region', { name: 'Upcoming deadlines' });
  expect(within(banner).getByText('Proposal due')).toBeInTheDocument();
});

test('flagging a second milestone as the formation deadline moves the flag', async () => {
  const user = userEvent.setup();
  render(<MilestoneManager />);
  await screen.findByText(/No milestones yet/);

  for (const [name, due] of [['Teams due', '2999-10-01T12:00'], ['Teams due (extended)', '2999-10-08T12:00']]) {
    await user.type(screen.getByLabelText('Name'), name);
    await user.type(screen.getByLabelText('Due'), due);
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Add milestone' }));
    await screen.findByText(name, { selector: 'b' });
  }

  const flagged = screen.getAllByText('Formation deadline');
  expect(flagged).toHaveLength(1);
  expect(flagged[0].closest('li')).toHaveTextContent('Teams due (extended)');
});

test('editing and deleting a milestone', async () => {
  milestones.push({ id: 'ms-1', name: 'Demo day', due_at: '2999-12-01T18:00:00Z', is_formation_deadline: false });
  const user = userEvent.setup();
  render(<MilestoneManager />);

  await user.click(await screen.findByRole('button', { name: 'Edit Demo day' }));
  const name = screen.getByLabelText('Name');
  await user.clear(name);
  await user.type(name, 'Final demo day');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Saved “Final demo day”.')).toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: 'Delete Final demo day' }));
  await user.click(screen.getByRole('button', { name: 'Delete “Final demo day”' }));
  expect(await screen.findByText('Deleted “Final demo day”.')).toBeInTheDocument();
  expect(milestones).toHaveLength(0);
});

test('the banner says when rosters have locked', async () => {
  milestones.push({ id: 'ms-d', name: 'Teams due', due_at: '2020-01-01T00:00:00Z', is_formation_deadline: true });
  setSessionUserId('u-adan');
  render(<MemoryRouter><MilestoneBanner /></MemoryRouter>);
  expect(await screen.findByText(/Team formation closed/)).toHaveTextContent('Rosters are locked');
});

test('with nothing scheduled the banner stays out of the way', async () => {
  setSessionUserId('u-adan');
  render(<MemoryRouter><MilestoneBanner /></MemoryRouter>);
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('region', { name: 'Upcoming deadlines' })).not.toBeInTheDocument();
});
