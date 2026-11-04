// Issue #42: the admin's next-steps checklist, against the mock API.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextStepManager } from './NextSteps';
import { reorderNextSteps, saveNextStep, setSessionUserId } from '../api/client';
import { nextStepCompletions, nextSteps } from '../api/mockData';

beforeEach(() => {
  nextSteps.length = 0;
  nextStepCompletions.length = 0;
  setSessionUserId('u-instructor');
});
afterEach(() => setSessionUserId(null));

const seed = (...titles) =>
  titles.forEach((title, i) => nextSteps.push({ id: `ns-${i + 1}`, title, due_at: null, sort_order: i + 1 }));

const shownOrder = () =>
  within(screen.getByRole('list', { name: 'Next steps' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('b').textContent);

test('empty item text is rejected, and nothing is saved', async () => {
  const user = userEvent.setup();
  render(<NextStepManager />);
  await screen.findByText(/No next steps yet/);

  await user.click(screen.getByRole('button', { name: 'Add step' }));
  expect(screen.getByText('Write what teams need to do')).toBeInTheDocument();
  expect(screen.getByLabelText('Step')).toHaveAttribute('aria-invalid', 'true');

  await user.type(screen.getByLabelText('Step'), '    ');
  await user.click(screen.getByRole('button', { name: 'Add step' }));
  expect(screen.getByText('Write what teams need to do')).toBeInTheDocument();
  expect(nextSteps).toHaveLength(0);
});

test('an admin adds steps, with or without a due date, and they show in order', async () => {
  const user = userEvent.setup();
  render(<NextStepManager />);
  await screen.findByText(/No next steps yet/);

  await user.type(screen.getByLabelText('Step'), '  Confirm the roster  ');
  await user.click(screen.getByRole('button', { name: 'Add step' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Added “Confirm the roster”.');

  await user.type(screen.getByLabelText('Step'), 'Submit the proposal');
  await user.type(screen.getByLabelText(/Due/), '2098-11-07T23:59');
  await user.click(screen.getByRole('button', { name: 'Add step' }));
  await screen.findByText('Submit the proposal', { selector: 'b' });

  expect(shownOrder()).toEqual(['Confirm the roster', 'Submit the proposal']);
  const [first, second] = within(screen.getByRole('list', { name: 'Next steps' })).getAllByRole('listitem');
  expect(first).toHaveTextContent('No due date');
  expect(second).toHaveTextContent(/Due .*2098/);
  expect(nextSteps.map((s) => s.sort_order)).toEqual([1, 2]);
});

test('reordering updates the order shown, and the order is saved', async () => {
  seed('Confirm the roster', 'Create the repo', 'Schedule the first adviser meeting');
  const user = userEvent.setup();
  render(<NextStepManager />);
  await screen.findByRole('list', { name: 'Next steps' });

  expect(screen.getByRole('button', { name: 'Move Confirm the roster up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Schedule the first adviser meeting down' })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: 'Move Schedule the first adviser meeting up' }));
  expect(shownOrder()).toEqual(['Confirm the roster', 'Schedule the first adviser meeting', 'Create the repo']);

  // Every move button is disabled while a move is saving.
  const down = screen.getByRole('button', { name: 'Move Confirm the roster down' });
  await waitFor(() => expect(down).toBeEnabled());
  await user.click(down);
  expect(shownOrder()).toEqual(['Schedule the first adviser meeting', 'Confirm the roster', 'Create the repo']);

  // Once the server answers, the stored order matches what's shown.
  await expect.poll(() =>
    nextSteps.slice().sort((a, b) => a.sort_order - b.sort_order).map((s) => s.title)
  ).toEqual(['Schedule the first adviser meeting', 'Confirm the roster', 'Create the repo']);
});

test('a reorder from a stale list is refused, and the list reloads', async () => {
  seed('Confirm the roster', 'Create the repo');
  const user = userEvent.setup();
  render(<NextStepManager />);
  await screen.findByRole('list', { name: 'Next steps' });

  // Another admin adds a step after this list loaded.
  nextSteps.push({ id: 'ns-late', title: 'Submit the proposal', due_at: null, sort_order: 3 });
  await user.click(screen.getByRole('button', { name: 'Move Create the repo up' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('The list has changed since it was loaded');
  await screen.findByText('Submit the proposal', { selector: 'b' });
  expect(shownOrder()).toEqual(['Confirm the roster', 'Create the repo', 'Submit the proposal']);
});

test('editing and deleting a step', async () => {
  seed('Demo day prep', 'Submit the proposal');
  nextStepCompletions.push({ team_id: 't-lab', step_id: 'ns-1', completed_by: 'u-adan', completed_at: '2026-10-20T00:00:00Z' });
  const user = userEvent.setup();
  render(<NextStepManager />);

  await user.click(await screen.findByRole('button', { name: 'Edit Demo day prep' }));
  const title = screen.getByLabelText('Step');
  await user.clear(title);
  await user.type(title, 'Prepare for demo day');
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Saved “Prepare for demo day”.')).toBeInTheDocument();

  await user.click(await screen.findByRole('button', { name: 'Delete Prepare for demo day' }));
  await user.click(screen.getByRole('button', { name: 'Delete “Prepare for demo day”' }));
  expect(await screen.findByText('Deleted “Prepare for demo day”.')).toBeInTheDocument();
  expect(shownOrder()).toEqual(['Submit the proposal']);
  expect(nextSteps.map((s) => s.sort_order)).toEqual([1]);
  expect(nextStepCompletions).toHaveLength(0);
});

test('HTML typed into a step is shown as plain text, never run', async () => {
  const payload = `<img src=x onerror="window.__pwned=1">`;
  seed(payload);
  render(<NextStepManager />);
  const list = await screen.findByRole('list', { name: 'Next steps' });
  expect(within(list).getByText(payload)).toBeInTheDocument();
  expect(document.querySelector('img, script')).toBeNull();
  expect(window.__pwned).toBeUndefined();
});

test('students can\'t change the checklist', async () => {
  seed('Confirm the roster', 'Create the repo');
  setSessionUserId('u-adan');
  await expect(saveNextStep({ title: 'Sneaky' })).rejects.toThrow('Admin access required');
  await expect(reorderNextSteps(['ns-2', 'ns-1'])).rejects.toThrow('Admin access required');
  expect(nextSteps.map((s) => s.title)).toEqual(['Confirm the roster', 'Create the repo']);
});
