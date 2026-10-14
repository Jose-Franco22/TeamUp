// Issue #25 — UI tests for deleting a project.
//
// Deleting is irreversible and takes the project, its open roles and every
// request anyone sent it, so most of this file is about the ways it must
// *not* happen: no delete without confirming, none while somebody else is on
// the team, none for anyone but the creator.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Team from './Team';
import * as client from '../api/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

let session = { status: 'authenticated', user: { id: 'u-creator' } };
vi.mock('../auth/SessionContext', () => ({ useSession: () => session }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMyTeam: vi.fn(),
    deleteTeam: vi.fn(),
    leaveTeam: vi.fn(),
    removeMember: vi.fn(),
  };
});

const CREATOR = {
  user_id: 'u-creator',
  name: 'Nicolas Guerra',
  role_id: 'r-pm',
  role: 'Project Manager',
  availability_hours: 12,
  skills: ['Node.js'],
};
const OTHER = {
  user_id: 'u-other',
  name: 'Sofia Garza',
  role_id: 'r-frontend',
  role: 'Frontend Developer',
  availability_hours: 14,
  skills: ['React'],
};

const team = (over = {}) => ({
  id: 'p-1',
  team_id: 't-1',
  creator_id: 'u-creator',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy from camera feeds.',
  team_size_target: 4,
  member_count: 1,
  status: 'open',
  members: [CREATOR],
  roles_needed: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  session = { status: 'authenticated', user: { id: 'u-creator' } };
  client.getMyTeam.mockResolvedValue(team());
  client.deleteTeam.mockResolvedValue(undefined);
});

async function renderTeam() {
  render(
    <MemoryRouter>
      <Team />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: /Campus parking tracker/ });
}

const deleteSection = () => screen.getByRole('heading', { name: 'Delete this team' }).closest('section');

// --- nothing happens without confirming -----------------------------------

describe('confirmation', () => {
  test('the first press only asks — nothing is deleted yet', async () => {
    const user = userEvent.setup();
    await renderTeam();

    await user.click(within(deleteSection()).getByRole('button', { name: 'Delete team' }));

    expect(screen.getByText(/Delete .*Campus parking tracker.* permanently\?/)).toBeInTheDocument();
    expect(client.deleteTeam).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('cancelling does nothing at all', async () => {
    const user = userEvent.setup();
    await renderTeam();
    const section = deleteSection();

    await user.click(within(section).getByRole('button', { name: 'Delete team' }));
    await user.click(within(section).getByRole('button', { name: 'Cancel' }));

    expect(client.deleteTeam).not.toHaveBeenCalled();
    expect(within(section).getByRole('button', { name: 'Delete team' })).toBeInTheDocument();
    expect(screen.queryByText(/permanently\?/)).not.toBeInTheDocument();
  });

  test('confirming deletes this team and goes to Browse', async () => {
    const user = userEvent.setup();
    await renderTeam();
    const section = deleteSection();

    await user.click(within(section).getByRole('button', { name: 'Delete team' }));
    await user.click(within(section).getByRole('button', { name: 'Yes, delete it' }));

    await waitFor(() => expect(client.deleteTeam).toHaveBeenCalledWith('t-1'));
    expect(client.deleteTeam).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/browse', { replace: true });
  });

  // The page heading also carries the title, so this is scoped to the
  // confirmation itself — the question has to name what it will destroy.
  test('the confirmation names the project, so it is clear what is being deleted', async () => {
    const user = userEvent.setup();
    await renderTeam();
    const section = deleteSection();
    await user.click(within(section).getByRole('button', { name: 'Delete team' }));
    expect(within(section).getByText(/Campus parking tracker/)).toBeInTheDocument();
  });

  test('it says what else goes with it', async () => {
    await renderTeam();
    expect(
      within(deleteSection()).getByText(/Removes the project, its open roles, and any requests/)
    ).toBeInTheDocument();
    expect(within(deleteSection()).getByText(/cannot be undone/)).toBeInTheDocument();
  });
});

// --- not while anyone else is on the team ---------------------------------

describe('once somebody else has joined', () => {
  beforeEach(() => {
    client.getMyTeam.mockResolvedValue(team({ members: [CREATOR, OTHER], member_count: 2 }));
  });

  test('the delete button is disabled', async () => {
    await renderTeam();
    expect(within(deleteSection()).getByRole('button', { name: 'Delete team' })).toBeDisabled();
  });

  test('and the reason is on the page, not just the disabled state', async () => {
    await renderTeam();
    expect(
      within(deleteSection()).getByText(/only delete this team while you're the only one on it/i)
    ).toBeInTheDocument();
  });

  test('pressing it does nothing', async () => {
    const user = userEvent.setup();
    await renderTeam();
    await user.click(within(deleteSection()).getByRole('button', { name: 'Delete team' }));
    expect(screen.queryByText(/permanently\?/)).not.toBeInTheDocument();
    expect(client.deleteTeam).not.toHaveBeenCalled();
  });
});

// --- only the creator -----------------------------------------------------

describe('someone who is not the creator', () => {
  beforeEach(() => {
    session = { status: 'authenticated', user: { id: 'u-other' } };
    client.getMyTeam.mockResolvedValue(team({ members: [CREATOR, OTHER], member_count: 2 }));
  });

  test('is not offered the delete section at all', async () => {
    await renderTeam();
    expect(screen.queryByRole('heading', { name: 'Delete this team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete team' })).not.toBeInTheDocument();
  });

  test('is offered to leave instead', async () => {
    await renderTeam();
    expect(screen.getByRole('button', { name: /leave/i })).toBeInTheDocument();
  });
});

// --- the server refusing --------------------------------------------------

describe('when the delete is refused', () => {
  test('the reason is shown and the page stays put', async () => {
    const user = userEvent.setup();
    client.deleteTeam.mockRejectedValue(
      new Error('Remove everyone else from the team before deleting it')
    );
    await renderTeam();
    const section = deleteSection();

    await user.click(within(section).getByRole('button', { name: 'Delete team' }));
    await user.click(within(section).getByRole('button', { name: 'Yes, delete it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Remove everyone else from the team before deleting it'
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a refusal leaves the team on screen so nothing looks half-deleted', async () => {
    const user = userEvent.setup();
    client.deleteTeam.mockRejectedValue(new Error('Network down'));
    await renderTeam();
    const section = deleteSection();

    await user.click(within(section).getByRole('button', { name: 'Delete team' }));
    await user.click(within(section).getByRole('button', { name: 'Yes, delete it' }));

    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: /Campus parking tracker/ })).toBeInTheDocument();
  });
});

// --- the page around it ---------------------------------------------------

describe('the team page', () => {
  test('shows a student with no team what happens next, and no delete button', async () => {
    client.getMyTeam.mockResolvedValue(null);
    render(
      <MemoryRouter>
        <Team />
      </MemoryRouter>
    );

    expect(await screen.findByText('You are not on a team yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete team' })).not.toBeInTheDocument();
  });

  test('a failure to load is an error with a retry, not an empty page', async () => {
    client.getMyTeam.mockRejectedValueOnce(new Error('Network down'));
    render(
      <MemoryRouter>
        <Team />
      </MemoryRouter>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  test('retrying after a failure shows the team', async () => {
    const user = userEvent.setup();
    client.getMyTeam.mockRejectedValueOnce(new Error('Network down'));
    render(
      <MemoryRouter>
        <Team />
      </MemoryRouter>
    );
    await screen.findByRole('alert');

    client.getMyTeam.mockResolvedValue(team());
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByRole('heading', { name: /Campus parking tracker/ })).toBeInTheDocument();
  });
});
