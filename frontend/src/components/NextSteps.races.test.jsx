// Issue #42 review follow-ups: the two ways the checklist could show a list
// that isn't what the server has. Both need control over when a reply comes
// back, so the client is mocked here rather than driven through the mock API.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../api/client', async (importOriginal) => ({
  ...(await importOriginal()),
  getNextSteps: vi.fn(),
  saveNextStep: vi.fn(),
  reorderNextSteps: vi.fn(),
  deleteNextStep: vi.fn(),
}));

const { getNextSteps, reorderNextSteps, saveNextStep } = await import('../api/client');
const { NextStepManager } = await import('./NextSteps');

const step = (id, title, order) => ({ id, title, due_at: null, sort_order: order });
const A = step('ns-1', 'Pick a topic', 1);
const B = step('ns-2', 'Submit the proposal', 2);
const C = step('ns-3', 'Book a demo slot', 3);

const shown = () =>
  within(screen.getByRole('list', { name: 'Next steps' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('b').textContent);

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

test('a slow reorder reply does not undo a step added while it was in flight', async () => {
  const user = userEvent.setup();
  // The reorder is still on its way when the add lands, and it answers with
  // the list as it was before the insert.
  let settleReorder;
  reorderNextSteps.mockReturnValue(new Promise((resolve) => { settleReorder = resolve; }));
  getNextSteps
    .mockResolvedValueOnce([A, B])          // first paint
    .mockResolvedValue([B, A, C]);          // refresh after the add
  saveNextStep.mockResolvedValue(C);

  render(<NextStepManager />);
  await waitFor(() => expect(shown()).toEqual(['Pick a topic', 'Submit the proposal']));

  await user.click(screen.getByRole('button', { name: 'Move Pick a topic down' }));
  expect(reorderNextSteps).toHaveBeenCalled();

  await user.type(screen.getByLabelText('Step'), 'Book a demo slot');
  await user.click(screen.getByRole('button', { name: 'Add step' }));
  await screen.findByText('Added “Book a demo slot”.');
  expect(shown()).toEqual(['Submit the proposal', 'Pick a topic', 'Book a demo slot']);

  // The reorder finally answers, with the pre-insert list.
  settleReorder([B, A]);
  await new Promise((r) => setTimeout(r, 0));

  expect(shown()).toEqual(['Submit the proposal', 'Pick a topic', 'Book a demo slot']);
});

test('a refresh that fails after a successful save keeps the list and says it is stale', async () => {
  const user = userEvent.setup();
  getNextSteps
    .mockResolvedValueOnce([A, B])
    .mockRejectedValue(new Error('Failed to fetch'));
  saveNextStep.mockResolvedValue(C);

  render(<NextStepManager />);
  await waitFor(() => expect(shown()).toEqual(['Pick a topic', 'Submit the proposal']));

  await user.type(screen.getByLabelText('Step'), 'Book a demo slot');
  await user.click(screen.getByRole('button', { name: 'Add step' }));

  expect(await screen.findByText('Added “Book a demo slot”.')).toBeInTheDocument();
  // The list is still there rather than replaced by the fetch error...
  expect(shown()).toEqual(['Pick a topic', 'Submit the proposal']);
  expect(screen.queryByText('Failed to fetch')).toBeNull();
  // ...and the reader is told it is out of date.
  expect(screen.getByText(/couldn’t be refreshed/)).toBeInTheDocument();
});
