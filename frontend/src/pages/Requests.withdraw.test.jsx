// Issue #33 — UI tests for withdrawing a join request (runs against the
// mock API).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Requests from './Requests';
import * as client from '../api/client';
import { joinRequests, notifications } from '../api/mockData';

// Wrap withdrawJoinRequest in a spy that still calls the real (mock-mode)
// implementation, so individual tests can hold it open or force an error.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, withdrawJoinRequest: vi.fn(actual.withdrawJoinRequest) };
});

// Adan has sent three requests: pending to "Campus parking tracker" (jr-1,
// Nicolas's project) and "Degree plan builder" (jr-3), and a declined one to
// "Lab equipment sign-out" (jr-4).
const SEEKER = 'u-adan';
const OWNER = 'u-nicolas';

const snapshot = {};
beforeEach(() => {
  client.setSessionUserId(SEEKER);
  snapshot.joinRequests = joinRequests.map((r) => ({ ...r }));
});
afterEach(() => {
  joinRequests.splice(0, joinRequests.length, ...snapshot.joinRequests);
  notifications.length = 0;
  vi.mocked(client.withdrawJoinRequest).mockClear();
});

async function renderRequests() {
  render(
    <MemoryRouter>
      <Requests />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Requests' });
}

// The "Sent by you" row for a project.
function sentRow(title) {
  return screen.getByText(title).closest('.row');
}

describe('Withdraw button', () => {
  test('appears on my pending requests only', async () => {
    await renderRequests();

    expect(within(sentRow('Campus parking tracker')).getByRole('button', { name: 'Withdraw' })).toBeEnabled();
    expect(within(sentRow('Degree plan builder')).getByRole('button', { name: 'Withdraw' })).toBeEnabled();
    // jr-4 was declined.
    expect(within(sentRow('Lab equipment sign-out')).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  test('is not shown on an accepted request', async () => {
    joinRequests.find((r) => r.id === 'jr-4').status = 'accepted';
    await renderRequests();

    expect(within(sentRow('Lab equipment sign-out')).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  test("is not offered on requests other people sent to the owner's projects", async () => {
    client.setSessionUserId(OWNER);
    await renderRequests();

    const incoming = screen.getByLabelText('Role for Adan Barrera').closest('.row');
    expect(within(incoming).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });
});

describe('withdrawing', () => {
  test('the request shows as Withdrawn and loses its button', async () => {
    const user = userEvent.setup();
    await renderRequests();

    await user.click(within(sentRow('Campus parking tracker')).getByRole('button', { name: 'Withdraw' }));

    const row = sentRow('Campus parking tracker');
    expect(await within(row).findByText(/withdrawn/i)).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(client.withdrawJoinRequest).toHaveBeenCalledWith('jr-1');
    // The other pending request is untouched.
    expect(within(sentRow('Degree plan builder')).getByRole('button', { name: 'Withdraw' })).toBeEnabled();
    // Refreshed in place, never back to the loading screen.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test("a withdrawn request disappears from the owner's list", async () => {
    const user = userEvent.setup();
    await renderRequests();
    await user.click(within(sentRow('Campus parking tracker')).getByRole('button', { name: 'Withdraw' }));
    await within(sentRow('Campus parking tracker')).findByText(/withdrawn/i);
    cleanup();

    client.setSessionUserId(OWNER);
    await renderRequests();

    expect(screen.queryByLabelText('Role for Adan Barrera')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role for Rita Cano')).toBeInTheDocument();
  });

  test('shows a busy state while the call runs', async () => {
    const user = userEvent.setup();
    let settle;
    client.withdrawJoinRequest.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        })
    );
    await renderRequests();

    await user.click(within(sentRow('Campus parking tracker')).getByRole('button', { name: 'Withdraw' }));

    const busy = within(sentRow('Campus parking tracker')).getByRole('button', { name: 'Withdrawing…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    settle.reject(new Error('stop'));
    expect(await within(sentRow('Campus parking tracker')).findByRole('button', { name: 'Withdraw' })).toBeEnabled();
  });

  test("an error from the server is shown on that request's row", async () => {
    const user = userEvent.setup();
    client.withdrawJoinRequest.mockRejectedValueOnce(new Error('Only a pending request can be withdrawn'));
    await renderRequests();

    await user.click(within(sentRow('Campus parking tracker')).getByRole('button', { name: 'Withdraw' }));

    const alert = await within(sentRow('Campus parking tracker')).findByRole('alert');
    expect(alert).toHaveTextContent('Only a pending request can be withdrawn');
    expect(within(sentRow('Degree plan builder')).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('withdrawJoinRequest (mock API)', () => {
  test('only the requester can withdraw, and only while pending', async () => {
    client.setSessionUserId(OWNER);
    await expect(client.withdrawJoinRequest('jr-1')).rejects.toThrow(
      'Only the student who sent this request can withdraw it'
    );

    client.setSessionUserId(SEEKER);
    await expect(client.withdrawJoinRequest('jr-4')).rejects.toThrow('Only a pending request can be withdrawn');
    expect(joinRequests.find((r) => r.id === 'jr-1').status).toBe('pending');
  });

  test('the student can request the same project again after withdrawing', async () => {
    await client.withdrawJoinRequest('jr-1');
    const again = await client.createJoinRequest('p-parking');

    expect(again).toMatchObject({ project_id: 'p-parking', user_id: SEEKER, status: 'pending' });
    expect(joinRequests.find((r) => r.id === 'jr-1').status).toBe('withdrawn');
  });

  test("marks the owner's alert for that request as read", async () => {
    await client.createJoinRequest('p-lab');
    const alert = notifications.find((n) => n.kind === 'join_request' && n.actor_id === SEEKER);
    const request = joinRequests.find((r) => r.project_id === 'p-lab' && r.status === 'pending');

    await client.withdrawJoinRequest(request.id);

    expect(alert.read_at).not.toBeNull();
  });
});
