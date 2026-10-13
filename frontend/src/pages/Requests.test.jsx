// Issue #28 — UI tests for accepting/declining join requests (runs against
// the mock API).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Requests from './Requests';
import * as client from '../api/client';
import { joinRequests, notifications, projects, teamMembers, teams } from '../api/mockData';

// Wrap respondToRequest in a spy that still calls the real (mock-mode)
// implementation, so individual tests can hold it open or force an error.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, respondToRequest: vi.fn(actual.respondToRequest) };
});

// Nicolas owns "Campus parking tracker", which has two pending requests:
// Adan Barrera (jr-1) and Rita Cano (jr-2).
const OWNER = 'u-nicolas';

// Accepting mutates the shared mock tables; put them back after each test.
const snapshot = {};
beforeEach(() => {
  client.setSessionUserId(OWNER);
  snapshot.joinRequests = joinRequests.map((r) => ({ ...r }));
  snapshot.teamMembers = teamMembers.map((m) => ({ ...m }));
  snapshot.projects = projects.map((p) => ({ ...p }));
  snapshot.teams = teams.map((t) => ({ ...t }));
});
afterEach(() => {
  const restore = (arr, saved) => arr.splice(0, arr.length, ...saved);
  restore(joinRequests, snapshot.joinRequests);
  restore(teamMembers, snapshot.teamMembers);
  restore(projects, snapshot.projects);
  restore(teams, snapshot.teams);
  notifications.length = 0;
  vi.mocked(client.respondToRequest).mockClear();
});

async function renderRequests() {
  render(
    <MemoryRouter>
      <Requests />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Requests' });
}

// The incoming row for a student, found from their role select.
function rowFor(name) {
  return screen.getByLabelText(`Role for ${name}`).closest('.row');
}

// A respondToRequest that stays pending until the test settles it.
function holdResponse() {
  let settle;
  client.respondToRequest.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        settle = { resolve, reject };
      })
  );
  return () => settle;
}

describe('busy state', () => {
  test('Accept shows a busy state while the call runs', async () => {
    const user = userEvent.setup();
    const settle = holdResponse();
    await renderRequests();
    const row = rowFor('Adan Barrera');

    await user.click(within(row).getByRole('button', { name: 'Accept' }));

    const accepting = within(row).getByRole('button', { name: 'Accepting…' });
    expect(accepting).toBeDisabled();
    expect(accepting).toHaveAttribute('aria-busy', 'true');
    expect(within(row).getByRole('button', { name: 'Decline' })).toBeDisabled();
    expect(within(row).getByLabelText('Role for Adan Barrera')).toBeDisabled();
    // Other rows stay usable.
    expect(within(rowFor('Rita Cano')).getByRole('button', { name: 'Accept' })).toBeEnabled();

    settle().reject(new Error('stop'));
    expect(await within(row).findByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  test('Decline shows a busy state while the call runs', async () => {
    const user = userEvent.setup();
    const settle = holdResponse();
    await renderRequests();
    const row = rowFor('Rita Cano');

    await user.click(within(row).getByRole('button', { name: 'Decline' }));

    const declining = within(row).getByRole('button', { name: 'Declining…' });
    expect(declining).toBeDisabled();
    expect(declining).toHaveAttribute('aria-busy', 'true');
    expect(within(row).getByRole('button', { name: 'Accept' })).toBeDisabled();

    settle().reject(new Error('stop'));
    expect(await within(row).findByRole('button', { name: 'Decline' })).toBeEnabled();
  });
});

describe('server errors', () => {
  test("an error from the server is shown on that request's row", async () => {
    const user = userEvent.setup();
    client.respondToRequest.mockRejectedValueOnce(new Error('This team is already full'));
    await renderRequests();

    await user.click(within(rowFor('Adan Barrera')).getByRole('button', { name: 'Accept' }));

    const alert = await within(rowFor('Adan Barrera')).findByRole('alert');
    expect(alert).toHaveTextContent('This team is already full');
    // Only on that row, and the row can be retried.
    expect(within(rowFor('Rita Cano')).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(rowFor('Adan Barrera')).getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  test('the error clears when the owner tries again', async () => {
    const user = userEvent.setup();
    client.respondToRequest.mockRejectedValueOnce(new Error('Network down'));
    await renderRequests();

    await user.click(within(rowFor('Rita Cano')).getByRole('button', { name: 'Decline' }));
    await within(rowFor('Rita Cano')).findByText('Network down');

    await user.click(within(rowFor('Rita Cano')).getByRole('button', { name: 'Decline' }));
    expect(screen.queryByText('Network down')).not.toBeInTheDocument();
    // Let the retry finish so it can't land in the next test's data.
    await waitFor(() => expect(screen.queryByLabelText('Role for Rita Cano')).not.toBeInTheDocument());
  });
});

describe('list updates', () => {
  test('accepting removes the request from the list, with the chosen role', async () => {
    const user = userEvent.setup();
    await renderRequests();

    await user.selectOptions(screen.getByLabelText('Role for Adan Barrera'), 'r-design');
    await user.click(within(rowFor('Adan Barrera')).getByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(screen.queryByLabelText('Role for Adan Barrera')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Role for Rita Cano')).toBeInTheDocument();
    expect(client.respondToRequest).toHaveBeenCalledWith('jr-1', 'accepted', 'r-design');
    expect(teamMembers).toContainEqual({ team_id: 't-parking', user_id: 'u-adan', role_id: 'r-design' });
    expect(notifications).toEqual([
      expect.objectContaining({
        user_id: 'u-adan',
        kind: 'request_accepted',
        project_id: 'p-parking',
        actor_id: 'u-nicolas',
      }),
    ]);
    // The page refreshed in place; it never fell back to the loading screen.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('declining removes the request from the list', async () => {
    const user = userEvent.setup();
    await renderRequests();

    await user.click(within(rowFor('Rita Cano')).getByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(screen.queryByLabelText('Role for Rita Cano')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Role for Adan Barrera')).toBeInTheDocument();
    expect(client.respondToRequest).toHaveBeenCalledWith('jr-2', 'declined', undefined);
  });
});
