// Issue #53 — the adviser panel on the team page.
//
// Two things this file is really about. One: the four states (nobody asked,
// pending, accepted, declined) each have to read as themselves, because
// "Adviser: Dana" and "Dana was asked and hasn't answered" mean very
// different things to a team. Two: only the owner gets a control. Everyone
// else sees the same states and can change none of them — the server refuses
// them anyway, so what is under test here is that the app does not offer a
// button that is going to fail.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdviserPanel from './AdviserPanel';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProjectAdviser: vi.fn(),
    searchAdvisers: vi.fn(),
    inviteAdviser: vi.fn(),
    cancelAdviserRequest: vi.fn(),
    removeAdviser: vi.fn(),
  };
});

const DANA = {
  status: 'accepted',
  adviser_id: 'u-dana',
  adviser_name: 'Dana Kim',
  adviser_email: 'dkim01@utrgv.edu',
  created_at: '2026-09-02T15:00:00Z',
  responded_at: '2026-09-03T09:30:00Z',
};
const SOFIA = { id: 'u-sofia', name: 'Sofia Garza', email: 'sgarza02@utrgv.edu' };

beforeEach(() => {
  vi.clearAllMocks();
  client.getProjectAdviser.mockResolvedValue(null);
  client.searchAdvisers.mockResolvedValue([]);
  client.inviteAdviser.mockResolvedValue({ status: 'pending' });
  client.cancelAdviserRequest.mockResolvedValue(undefined);
  client.removeAdviser.mockResolvedValue(undefined);
});

async function renderPanel({ isOwner = true } = {}) {
  render(<AdviserPanel projectId="p-parking" isOwner={isOwner} />);
  // The heading is there from the first paint; waiting for the loading state
  // to go is what makes the assertions below about settled state.
  await waitFor(() => expect(screen.queryByText('Loading the adviser…')).not.toBeInTheDocument());
  return screen.getByRole('region', { name: 'Adviser' });
}

const panel = () => screen.getByRole('region', { name: 'Adviser' });

// --- the four states ------------------------------------------------------

describe('what each state says', () => {
  test('nobody asked: the owner is told an adviser takes no seat', async () => {
    await renderPanel();

    expect(screen.getByText(/Nobody is advising this project yet/)).toBeInTheDocument();
    expect(screen.getByText(/takes no seat on the roster/)).toBeInTheDocument();
    expect(screen.getByLabelText('Search by name or email')).toBeInTheDocument();
  });

  test('accepted: the name, and that they are advising it', async () => {
    client.getProjectAdviser.mockResolvedValue(DANA);

    await renderPanel();

    expect(screen.getByText('Dana Kim')).toBeInTheDocument();
    expect(screen.getByText(/Advising this project/)).toBeInTheDocument();
    // The owner gets the email, so they can reach them outside the app.
    expect(screen.getByText(/dkim01@utrgv.edu/)).toBeInTheDocument();
  });

  test('pending: who was asked, and that no answer has come back', async () => {
    client.getProjectAdviser.mockResolvedValue({
      ...DANA,
      status: 'pending',
      responded_at: null,
    });

    await renderPanel();

    expect(screen.getByText('Dana Kim')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText(/has not answered yet/)).toBeInTheDocument();
  });

  test('declined: the answer stays on screen, rather than the panel emptying', async () => {
    client.getProjectAdviser.mockResolvedValue({ ...DANA, status: 'declined' });

    await renderPanel();

    expect(screen.getByText('Dana Kim')).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText(/Turned down the invitation/)).toBeInTheDocument();
  });
});

// --- only the owner gets a control ---------------------------------------

describe('a member who is not the owner', () => {
  test('sees the adviser but no way to change it', async () => {
    client.getProjectAdviser.mockResolvedValue({ ...DANA, adviser_email: null });

    await renderPanel({ isOwner: false });

    expect(screen.getByText('Dana Kim')).toBeInTheDocument();
    expect(within(panel()).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByLabelText('Search by name or email')).not.toBeInTheDocument();
  });

  test('is not offered a search box when there is no adviser either', async () => {
    await renderPanel({ isOwner: false });

    expect(screen.getByText('Nobody is advising this project yet.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search by name or email')).not.toBeInTheDocument();
    expect(within(panel()).queryAllByRole('button')).toEqual([]);
  });

  test('cannot cancel a pending invitation', async () => {
    client.getProjectAdviser.mockResolvedValue({ ...DANA, status: 'pending', adviser_email: null });

    await renderPanel({ isOwner: false });

    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Cancel request/ })).not.toBeInTheDocument();
  });
});

// --- searching and asking -------------------------------------------------

describe('asking somebody', () => {
  test('a search of one character is not sent at all', async () => {
    const user = userEvent.setup();
    await renderPanel();

    await user.type(screen.getByLabelText('Search by name or email'), 'S');

    expect(screen.getByText('Type at least 2 characters.')).toBeInTheDocument();
    expect(client.searchAdvisers).not.toHaveBeenCalled();
  });

  test('typing a name searches once the typing stops, and the result can be asked', async () => {
    const user = userEvent.setup();
    client.searchAdvisers.mockResolvedValue([SOFIA]);
    await renderPanel();

    await user.type(screen.getByLabelText('Search by name or email'), 'Sofia');

    expect(await screen.findByText('Sofia Garza')).toBeInTheDocument();
    expect(screen.getByText('sgarza02@utrgv.edu')).toBeInTheDocument();
    // Debounced: the five keystrokes are one request, not five.
    expect(client.searchAdvisers).toHaveBeenCalledTimes(1);
    expect(client.searchAdvisers).toHaveBeenCalledWith('p-parking', 'Sofia');

    // Asking re-reads the panel, so what it shows next is the server's answer
    // and not a guess made here.
    client.getProjectAdviser.mockResolvedValue({
      status: 'pending',
      adviser_id: 'u-sofia',
      adviser_name: 'Sofia Garza',
      adviser_email: 'sgarza02@utrgv.edu',
      created_at: '2026-11-16T10:00:00Z',
      responded_at: null,
    });
    await user.click(screen.getByRole('button', { name: 'Ask to advise' }));

    await waitFor(() => expect(screen.getByText('Pending')).toBeInTheDocument());
    expect(client.inviteAdviser).toHaveBeenCalledWith('p-parking', 'u-sofia');
    // The search box is gone: there is nobody left to ask.
    expect(screen.queryByLabelText('Search by name or email')).not.toBeInTheDocument();
  });

  test('a search that matches nobody says so', async () => {
    const user = userEvent.setup();
    client.searchAdvisers.mockResolvedValue([]);
    await renderPanel();

    await user.type(screen.getByLabelText('Search by name or email'), 'Zzz');

    expect(await screen.findByText(/Nobody matching that/)).toBeInTheDocument();
    expect(screen.getByText(/already on this team can’t advise it/)).toBeInTheDocument();
  });

  test('a search that fails says so instead of showing an empty list', async () => {
    const user = userEvent.setup();
    client.searchAdvisers.mockRejectedValue(new Error('Network is down'));
    await renderPanel();

    await user.type(screen.getByLabelText('Search by name or email'), 'Sofia');

    expect(await screen.findByRole('alert')).toHaveTextContent('Network is down');
  });

  // The database refuses what the search box cannot know: somebody who was
  // asked a moment ago by another tab, an account that just became an admin.
  test('a refused invitation shows the reason and leaves the panel as it was', async () => {
    const user = userEvent.setup();
    client.searchAdvisers.mockResolvedValue([SOFIA]);
    client.inviteAdviser.mockRejectedValue(new Error('This project already has an adviser'));
    await renderPanel();

    await user.type(screen.getByLabelText('Search by name or email'), 'Sofia');
    await user.click(await screen.findByRole('button', { name: 'Ask to advise' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This project already has an adviser');
    expect(screen.getByText(/Nobody is advising this project yet/)).toBeInTheDocument();
  });
});

// --- taking it back -------------------------------------------------------

describe('cancelling and removing', () => {
  test('cancelling a pending invitation empties the panel and brings the search back', async () => {
    const user = userEvent.setup();
    client.getProjectAdviser.mockResolvedValue({ ...DANA, status: 'pending', responded_at: null });
    await renderPanel();

    client.getProjectAdviser.mockResolvedValue(null);
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));

    await waitFor(() => expect(client.cancelAdviserRequest).toHaveBeenCalledWith('p-parking'));
    expect(await screen.findByLabelText('Search by name or email')).toBeInTheDocument();
    expect(screen.queryByText('Dana Kim')).not.toBeInTheDocument();
  });

  test('removing an accepted adviser does the same', async () => {
    const user = userEvent.setup();
    client.getProjectAdviser.mockResolvedValue(DANA);
    await renderPanel();

    client.getProjectAdviser.mockResolvedValue(null);
    await user.click(screen.getByRole('button', { name: 'Remove adviser' }));

    await waitFor(() => expect(client.removeAdviser).toHaveBeenCalledWith('p-parking'));
    expect(await screen.findByLabelText('Search by name or email')).toBeInTheDocument();
  });

  test('a refused removal says why and keeps the adviser on screen', async () => {
    const user = userEvent.setup();
    client.getProjectAdviser.mockResolvedValue(DANA);
    client.removeAdviser.mockRejectedValue(
      new Error('Only the project creator can remove the adviser')
    );
    await renderPanel();

    await user.click(screen.getByRole('button', { name: 'Remove adviser' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the project creator can remove the adviser'
    );
    expect(screen.getByText('Dana Kim')).toBeInTheDocument();
  });

  // A decline is not an empty panel: the owner has to ask for the search box
  // back, so the answer does not vanish the moment they read it.
  test('after a decline the owner asks for the search box before it appears', async () => {
    const user = userEvent.setup();
    client.getProjectAdviser.mockResolvedValue({ ...DANA, status: 'declined' });
    await renderPanel();

    expect(screen.queryByLabelText('Search by name or email')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Ask someone else' }));

    expect(screen.getByLabelText('Search by name or email')).toBeInTheDocument();
    // The decline is still readable while they pick somebody else.
    expect(screen.getByText('Declined')).toBeInTheDocument();
  });
});

// --- when the panel itself cannot load ------------------------------------

test('a panel that cannot load says so without breaking the team page', async () => {
  client.getProjectAdviser.mockRejectedValue(new Error('PGRST500'));

  await renderPanel();

  expect(screen.getByText('Could not load the adviser just now.')).toBeInTheDocument();
  // Not an alert: the rest of the team page is fine, and this is one line of it.
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Adviser' })).toBeInTheDocument();
});
