// Issue #30: the checklist a complete team sees, built on the admin's list
// of steps from #42 (whose editor is covered in NextSteps.test.jsx), against
// the mock API.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextStepManager, TeamChecklist, isOverdue } from './NextSteps';
import { formatDue } from './Milestones';
import { adminAssignStudent, setSessionUserId } from '../api/client';
import { nextStepCompletions, nextSteps, notifications, projects, teamMembers, teams } from '../api/mockData';

// t-lab is the fixtures' full team: Omar (owner) and Priya.
const TEAM = 't-lab';
const seeded = nextSteps.map((s) => ({ ...s }));

beforeEach(() => {
  nextSteps.splice(0, nextSteps.length, ...seeded.map((s) => ({ ...s })));
  nextStepCompletions.length = 0;
  setSessionUserId('u-priya');
});
afterEach(() => setSessionUserId(null));

const item = (title) => screen.getByText(title).closest('li');

describe('the team checklist', () => {
  test('lists every item from the admin-managed list', async () => {
    render(<TeamChecklist teamId={TEAM} />);
    await screen.findByText('Confirm your roster');
    for (const s of seeded) expect(screen.getByText(s.title)).toBeInTheDocument();
    expect(screen.getByText(/0 of 4 done/)).toBeInTheDocument();
  });

  test('follows the order the admin set', async () => {
    // Reverse the seeded order, as reorder_next_steps() would.
    nextSteps.forEach((s) => { s.sort_order = seeded.length + 1 - s.sort_order; });
    render(<TeamChecklist teamId={TEAM} />);
    await screen.findByText('Confirm your roster');
    const titles = screen.getAllByRole('checkbox').map((box) => box.closest('label').textContent);
    expect(titles).toEqual(seeded.map((s) => s.title).reverse());
  });

  test('checking an item shows the completer’s name, to the whole team', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TeamChecklist teamId={TEAM} />);
    await screen.findByText('Confirm your roster');

    await user.click(within(item('Confirm your roster')).getByRole('checkbox'));

    expect(await within(item('Confirm your roster')).findByText(/Done by Priya Vale/)).toBeInTheDocument();
    expect(within(item('Confirm your roster')).getByRole('checkbox')).toBeChecked();
    expect(screen.getByText(/1 of 4 done/)).toBeInTheDocument();
    unmount();

    // The owner, opening the page afterwards, sees who did it.
    setSessionUserId('u-omar');
    render(<TeamChecklist teamId={TEAM} />);
    expect(await screen.findByText(/Done by Priya Vale/)).toBeInTheDocument();
  });

  test('any member can undo a checked item', async () => {
    const user = userEvent.setup();
    nextStepCompletions.push({
      team_id: TEAM, step_id: 'ns-repo', completed_by: 'u-priya', completed_at: new Date().toISOString(),
    });
    setSessionUserId('u-omar');
    render(<TeamChecklist teamId={TEAM} />);
    await screen.findByText(/Done by Priya Vale/);

    await user.click(within(item('Create the repo and add your adviser')).getByRole('checkbox'));

    expect(await screen.findByText(/0 of 4 done/)).toBeInTheDocument();
    expect(screen.queryByText(/Done by/)).not.toBeInTheDocument();
  });

  test('items with a due date show it, and overdue items are highlighted', async () => {
    const past = '2026-01-15T17:00:00.000Z';
    const future = '2098-05-01T17:00:00.000Z';
    nextSteps.find((s) => s.id === 'ns-proposal').due_at = past;
    nextSteps.find((s) => s.id === 'ns-meeting').due_at = future;
    render(<TeamChecklist teamId={TEAM} />);
    await screen.findByText('Confirm your roster');

    const proposal = item('Submit your project proposal');
    expect(within(proposal).getByText(new RegExp(`Due ${formatDue(past)}`))).toBeInTheDocument();
    expect(proposal).toHaveClass('overdue');
    expect(within(proposal).getByText('Overdue')).toBeInTheDocument();

    const meeting = item('Schedule your first adviser meeting');
    expect(within(meeting).getByText(new RegExp(`Due ${formatDue(future)}`))).toBeInTheDocument();
    expect(meeting).not.toHaveClass('overdue');
    expect(within(meeting).queryByText('Overdue')).not.toBeInTheDocument();

    // Undated items show no due date.
    expect(within(item('Confirm your roster')).queryByText(/Due/)).not.toBeInTheDocument();
  });

  test('an overdue item stops being highlighted once it’s done', async () => {
    const user = userEvent.setup();
    nextSteps.find((s) => s.id === 'ns-proposal').due_at = '2026-01-15T17:00:00.000Z';
    render(<TeamChecklist teamId={TEAM} />);
    await screen.findByText('Confirm your roster');

    await user.click(within(item('Submit your project proposal')).getByRole('checkbox'));

    await within(item('Submit your project proposal')).findByText(/Done by Priya Vale/);
    expect(item('Submit your project proposal')).not.toHaveClass('overdue');
  });

  test('someone not on the team can’t see it', async () => {
    setSessionUserId('u-adan');
    render(<TeamChecklist teamId={TEAM} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Only members of this team can see its checklist');
  });
});

test('isOverdue: past due and not done', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  expect(isOverdue({ due_at: '2026-05-31T00:00:00Z', completed_at: null }, now)).toBe(true);
  expect(isOverdue({ due_at: '2026-06-02T00:00:00Z', completed_at: null }, now)).toBe(false);
  expect(isOverdue({ due_at: '2026-05-31T00:00:00Z', completed_at: '2026-05-30T00:00:00Z' }, now)).toBe(false);
  expect(isOverdue({ due_at: null, completed_at: null }, now)).toBe(false);
});

// The mock stands in for the trigger in 34_next_steps.sql.
test('when the last seat fills, every member gets a "team complete" notification', async () => {
  const snapshot = {
    projects: projects.map((p) => ({ ...p })),
    teams: teams.map((t) => ({ ...t })),
    teamMembers: teamMembers.map((tm) => ({ ...tm })),
    notifications: notifications.length,
  };
  try {
    // Omar's team has room for one more once its target goes up to 3.
    const project = projects.find((p) => p.id === 'p-lab');
    project.team_size_target = 3;
    project.status = 'open';
    setSessionUserId('u-instructor');
    await adminAssignStudent('u-sofia', TEAM, 'r-frontend');

    const sent = notifications.slice(snapshot.notifications).filter((n) => n.kind === 'team_complete');
    expect(sent.map((n) => n.user_id).sort()).toEqual(['u-omar', 'u-priya', 'u-sofia']);
    expect(sent.every((n) => n.project_id === 'p-lab' && n.by_admin)).toBe(true);
  } finally {
    projects.splice(0, projects.length, ...snapshot.projects);
    teams.splice(0, teams.length, ...snapshot.teams);
    teamMembers.splice(0, teamMembers.length, ...snapshot.teamMembers);
    notifications.length = snapshot.notifications;
  }
});

describe('the admin’s list', () => {
  beforeEach(() => setSessionUserId('u-instructor'));

  test('an added step with a due date shows on a team’s checklist', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NextStepManager />);
    await screen.findByText('Confirm your roster');

    await user.type(screen.getByLabelText('Step'), 'Book a demo slot');
    await user.type(screen.getByLabelText(/Due/), '2098-05-01T12:00');
    await user.click(screen.getByRole('button', { name: 'Add step' }));

    expect(await screen.findByText('Added “Book a demo slot”.')).toBeInTheDocument();
    unmount();

    setSessionUserId('u-priya');
    render(<TeamChecklist teamId={TEAM} />);
    const added = (await screen.findByText('Book a demo slot')).closest('li');
    expect(within(added).getByText(/^Due /)).toBeInTheDocument();
  });
});
