// Issue #54 — the read-only view of a team you advise.
//
// "I can view the team page and its members but can't edit the project,
// accept join requests or manage members." The database refuses all of that
// already (supabase/tests/adviser_responses.test.sql has a case each), so
// what these cases are really for is the other half: that the app does not
// *offer* a control which is going to fail. A disabled-looking page that
// still shows an Edit link teaches people the app is broken.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AdvisedTeams from './AdvisedTeams';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAdvisedProjects: vi.fn(),
    stepDownAsAdviser: vi.fn(),
    getDeliverables: vi.fn(),
    getDeliverableFileUrls: vi.fn(),
  };
});

const PROJECT = {
  id: 'p-parking',
  creator_id: 'u-nicolas',
  creator_name: 'Nicolas Guerra',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy from existing camera feeds.',
  team_size_target: 4,
  status: 'open',
  member_count: 2,
  members: [
    { user_id: 'u-nicolas', name: 'Nicolas Guerra', role_id: 'r-backend', role: 'Backend Developer' },
    { user_id: 'u-jose', name: 'Jose Franco Garza', role_id: 'r-data', role: 'Data / ML' },
  ],
  roles_needed: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  client.getAdvisedProjects.mockResolvedValue([PROJECT]);
  client.stepDownAsAdviser.mockResolvedValue(undefined);
  client.getDeliverables.mockResolvedValue([]);
  client.getDeliverableFileUrls.mockResolvedValue({});
});

async function renderAdvised() {
  render(<MemoryRouter><AdvisedTeams /></MemoryRouter>);
  await waitFor(() => expect(client.getAdvisedProjects).toHaveBeenCalled());
}

const card = () => screen.getByRole('region', { name: 'Advising Campus parking tracker' });

test('somebody who advises nothing sees no section', async () => {
  client.getAdvisedProjects.mockResolvedValue([]);

  await renderAdvised();

  expect(screen.queryByRole('heading', { name: 'Teams you advise' })).not.toBeInTheDocument();
});

test('a failure to load shows nothing rather than breaking the team page', async () => {
  client.getAdvisedProjects.mockRejectedValue(new Error('PGRST500'));

  await renderAdvised();

  expect(screen.queryByRole('heading', { name: 'Teams you advise' })).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

describe('a team you advise', () => {
  test('shows the project and who is on it', async () => {
    await renderAdvised();

    expect(await screen.findByText('Campus parking tracker')).toBeInTheDocument();
    expect(within(card()).getByText('Jose Franco Garza')).toBeInTheDocument();
    expect(within(card()).getByText('Data / ML')).toBeInTheDocument();
    expect(within(card()).getByText('Backend Developer')).toBeInTheDocument();
    expect(within(card()).getByText('2 of 4')).toBeInTheDocument();
    // Twice on purpose: once as who created it, once on the roster.
    expect(within(card()).getAllByText('Nicolas Guerra')).toHaveLength(2);
    expect(within(card()).getByText('Owner')).toBeInTheDocument();
  });

  test('and says plainly that advising is not a seat', async () => {
    await renderAdvised();

    expect(await screen.findByText(/not on its roster and hold no seat/)).toBeInTheDocument();
  });

  // The criterion, as the UI sees it.
  test('offers no way to edit the project or manage the team', async () => {
    await renderAdvised();

    const buttons = within(card()).getAllByRole('button').map((b) => b.textContent);
    expect(buttons).toEqual(['Step down as adviser']);
    expect(within(card()).queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
    expect(within(card()).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(card()).queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
  });
});

describe('stepping down', () => {
  test('asks first — one press changes nothing', async () => {
    const user = userEvent.setup();
    await renderAdvised();

    await user.click(await screen.findByRole('button', { name: 'Step down as adviser' }));

    expect(screen.getByText(/Stop advising/)).toBeInTheDocument();
    expect(client.stepDownAsAdviser).not.toHaveBeenCalled();
  });

  test('says what it will do to the owner before doing it', async () => {
    const user = userEvent.setup();
    await renderAdvised();

    await user.click(await screen.findByRole('button', { name: 'Step down as adviser' }));

    expect(screen.getByText(/The owner is told, and can invite someone else/)).toBeInTheDocument();
  });

  test('cancelling does nothing at all', async () => {
    const user = userEvent.setup();
    await renderAdvised();

    await user.click(await screen.findByRole('button', { name: 'Step down as adviser' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(client.stepDownAsAdviser).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Step down as adviser' })).toBeInTheDocument();
    expect(screen.getByText('Campus parking tracker')).toBeInTheDocument();
  });

  test('confirming ends it and the card goes', async () => {
    const user = userEvent.setup();
    await renderAdvised();

    await user.click(await screen.findByRole('button', { name: 'Step down as adviser' }));
    await user.click(screen.getByRole('button', { name: 'Yes, step down' }));

    await waitFor(() => expect(client.stepDownAsAdviser).toHaveBeenCalledWith('p-parking'));
    await waitFor(() =>
      expect(screen.queryByText('Campus parking tracker')).not.toBeInTheDocument()
    );
  });

  test('a refusal says why and leaves the team on screen', async () => {
    const user = userEvent.setup();
    client.stepDownAsAdviser.mockRejectedValue(
      new Error('You are not the adviser for this project')
    );
    await renderAdvised();

    await user.click(await screen.findByRole('button', { name: 'Step down as adviser' }));
    await user.click(screen.getByRole('button', { name: 'Yes, step down' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('not the adviser for this project');
    expect(screen.getByText('Campus parking tracker')).toBeInTheDocument();
  });
});

// --- deliverables (#57) ------------------------------------------------------

describe('the team’s deliverables', () => {
  test('the adviser reviews them here: the newest version with Approve and Request changes, and no submit form', async () => {
    client.getDeliverables.mockResolvedValue([
      {
        milestone_id: 'ms-prop',
        name: 'Project proposal',
        due_at: '2098-11-01T17:00:00Z',
        message: '',
        status: 'submitted',
        is_late: false,
        versions: [
          {
            id: 'v-1', version: 1, kind: 'link', file_path: null, file_name: null, file_size: null, file_type: null,
            link_url: 'https://docs.example.edu/proposal', is_late: false, status: 'submitted',
            submitted_by: 'u-jose', submitted_by_name: 'Jose Franco Garza', submitted_at: '2026-10-01T15:00:00Z',
          },
        ],
        comments: [],
      },
    ]);
    await renderAdvised();

    const deliverables = await within(card()).findByRole('region', { name: 'Deliverables' });
    expect(client.getDeliverables).toHaveBeenCalledWith('p-parking');
    const review = within(deliverables).getByRole('group', { name: 'Review version 1 of Project proposal' });
    expect(within(review).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(review).getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(within(deliverables).queryByRole('form', { name: 'Submit Project proposal' })).not.toBeInTheDocument();
  });
});
