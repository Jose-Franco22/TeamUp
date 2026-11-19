// Issue #54 — the adviser invitations section on the Requests page.
//
// The thing most worth testing here is that it is a *separate* section that
// disappears when empty. It shares a page with join requests, which are a
// different thing with a different consequence, and most students are never
// asked to advise anything — an empty heading on every visit would train
// everyone to ignore the one visit it matters.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdviserInvitations from './AdviserInvitations';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMyAdviserRequests: vi.fn(),
    respondToAdviserRequest: vi.fn(),
  };
});

const INVITE = {
  id: 'ar-1',
  project_id: 'p-degree',
  project_title: 'Degree plan builder',
  project_description: 'Constraint solver that generates a valid path to graduation.',
  owner_id: 'u-alexis',
  owner_name: 'Alexis Covarrubias',
  created_at: '2026-11-04T11:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  client.getMyAdviserRequests.mockResolvedValue([INVITE]);
  client.respondToAdviserRequest.mockResolvedValue({ status: 'accepted' });
});

async function renderSection() {
  render(<AdviserInvitations />);
  await waitFor(() => expect(client.getMyAdviserRequests).toHaveBeenCalled());
}

describe('when nothing is waiting', () => {
  test('the section is not there at all', async () => {
    client.getMyAdviserRequests.mockResolvedValue([]);

    await renderSection();

    expect(screen.queryByRole('heading', { name: 'Adviser invitations' })).not.toBeInTheDocument();
  });

  // One section of somebody else's page: it must not take the join requests
  // down with it.
  test('and a failure to load shows nothing rather than an error', async () => {
    client.getMyAdviserRequests.mockRejectedValue(new Error('PGRST500'));

    await renderSection();

    expect(screen.queryByRole('heading', { name: 'Adviser invitations' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('an invitation waiting', () => {
  test('says what it is, who is asking and what the project is building', async () => {
    await renderSection();

    expect(await screen.findByText('Degree plan builder')).toBeInTheDocument();
    expect(screen.getByText(/Alexis Covarrubias asked you to advise/)).toBeInTheDocument();
    expect(screen.getByText(/Constraint solver/)).toBeInTheDocument();
  });

  // The whole reason this is its own section: somebody reading quickly has
  // to be able to tell it from "can I join your team?".
  test('says advising takes no seat, so it is not read as a join request', async () => {
    await renderSection();

    expect(await screen.findByText(/does not put you on the team/)).toBeInTheDocument();
    expect(screen.getByText(/still be on a team of your own/)).toBeInTheDocument();
  });

  test('accepting answers it and the row goes', async () => {
    const user = userEvent.setup();
    await renderSection();

    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(client.respondToAdviserRequest).toHaveBeenCalledWith('ar-1', true));
    await waitFor(() => expect(screen.queryByText('Degree plan builder')).not.toBeInTheDocument());
  });

  test('declining answers it the other way', async () => {
    const user = userEvent.setup();
    await renderSection();

    await user.click(await screen.findByRole('button', { name: 'Decline' }));

    await waitFor(() => expect(client.respondToAdviserRequest).toHaveBeenCalledWith('ar-1', false));
    await waitFor(() => expect(screen.queryByText('Degree plan builder')).not.toBeInTheDocument());
  });

  test('tells the caller when the server refuses, and keeps the row', async () => {
    const user = userEvent.setup();
    client.respondToAdviserRequest.mockRejectedValue(
      new Error('That adviser request has already been answered')
    );
    await renderSection();

    await user.click(await screen.findByRole('button', { name: 'Accept' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('already been answered');
    expect(screen.getByText('Degree plan builder')).toBeInTheDocument();
  });

  test('answering one leaves the others alone', async () => {
    const user = userEvent.setup();
    client.getMyAdviserRequests.mockResolvedValue([
      INVITE,
      { ...INVITE, id: 'ar-2', project_title: 'Campus parking tracker' },
    ]);
    await renderSection();

    await user.click((await screen.findAllByRole('button', { name: 'Accept' }))[0]);

    await waitFor(() => expect(screen.queryByText('Degree plan builder')).not.toBeInTheDocument());
    expect(screen.getByText('Campus parking tracker')).toBeInTheDocument();
    expect(client.respondToAdviserRequest).toHaveBeenCalledTimes(1);
  });
});
