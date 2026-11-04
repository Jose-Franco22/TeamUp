// Issue #32 — requesting to join from Browse, with a note: the composer and
// its character counter, and the reason shown for every case a student
// can't ask. The client is mocked outright, as in Browse.test.jsx, so each
// test can put the student in exactly the state it's about.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Browse from './Browse';
import * as client from '../api/client';
import { JOIN_BLOCKED } from '../lib/joinRequests';

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ status: 'authenticated', user: { id: 'u-sofia' } }),
}));

vi.mock('../api/client', () => ({
  getProjects: vi.fn(),
  getCurrentUser: vi.fn(),
  getRoles: vi.fn(),
  createJoinRequest: vi.fn(),
  getFormationDeadline: vi.fn(),
}));

const project = (overrides) => ({
  id: 'p-parking',
  creator_id: 'u-nicolas',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy estimated from existing camera feeds.',
  team_size_target: 4,
  member_count: 1,
  status: 'open',
  avg_availability_hours: 12,
  roles_needed: [],
  members: [],
  viewer_request_status: null,
  ...overrides,
});

const PARKING = project();
const DEGREE = project({
  id: 'p-degree',
  creator_id: 'u-alexis',
  title: 'Degree plan builder',
  description: 'Constraint solver over prerequisites and offering patterns.',
});

beforeEach(() => {
  client.getProjects.mockResolvedValue([PARKING, DEGREE]);
  client.getCurrentUser.mockResolvedValue({ id: 'u-sofia', availability_hours: 10, skills: [] });
  client.getRoles.mockResolvedValue([]);
  client.createJoinRequest.mockReset().mockResolvedValue({});
  client.getFormationDeadline.mockResolvedValue(null);
});

async function renderBrowse() {
  render(
    <MemoryRouter>
      <Browse />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Open projects' });
  await waitFor(() => expect(client.getFormationDeadline).toHaveBeenCalled());
}

const card = (title) => screen.getByText(title).closest('article');

// --- writing the note ------------------------------------------------------

describe('the message composer', () => {
  test('opens when "Request to join" is pressed, with the full allowance left', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    await user.click(within(card('Campus parking tracker')).getByRole('button', { name: 'Request to join' }));

    const parking = card('Campus parking tracker');
    expect(within(parking).getByLabelText(/why you're a good fit/i)).toBeInTheDocument();
    expect(within(parking).getByText('300 characters left')).toBeInTheDocument();
    expect(client.createJoinRequest).not.toHaveBeenCalled();
  });

  test('the counter shows how many characters are left as you type', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    const parking = card('Campus parking tracker');
    await user.click(within(parking).getByRole('button', { name: 'Request to join' }));

    await user.type(within(parking).getByLabelText(/why you're a good fit/i), 'I know React');
    expect(within(parking).getByText('288 characters left')).toBeInTheDocument();

    fireEvent.change(within(parking).getByLabelText(/why you're a good fit/i), {
      target: { value: 'a'.repeat(299) },
    });
    expect(within(parking).getByText('1 character left')).toBeInTheDocument();
  });

  test('over 300 characters the counter says so and sending is disabled', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    const parking = card('Campus parking tracker');
    await user.click(within(parking).getByRole('button', { name: 'Request to join' }));

    fireEvent.change(within(parking).getByLabelText(/why you're a good fit/i), {
      target: { value: 'a'.repeat(301) },
    });
    expect(within(parking).getByText('1 character over the 300 limit')).toBeInTheDocument();
    expect(within(parking).getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  test('sends the note with the request, then shows it pending', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    const parking = card('Campus parking tracker');
    await user.click(within(parking).getByRole('button', { name: 'Request to join' }));
    await user.type(within(parking).getByLabelText(/why you're a good fit/i), 'I built the campus map app.');
    await user.click(within(parking).getByRole('button', { name: 'Send request' }));

    expect(client.createJoinRequest).toHaveBeenCalledWith('p-parking', 'I built the campus map app.');
    expect(await within(parking).findByRole('button', { name: 'Request pending' })).toBeDisabled();
    expect(within(parking).queryByLabelText(/why you're a good fit/i)).not.toBeInTheDocument();
  });

  test('cancel closes the composer without sending', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    const parking = card('Campus parking tracker');
    await user.click(within(parking).getByRole('button', { name: 'Request to join' }));
    await user.click(within(parking).getByRole('button', { name: 'Cancel' }));

    expect(within(parking).queryByLabelText(/why you're a good fit/i)).not.toBeInTheDocument();
    expect(within(parking).getByRole('button', { name: 'Request to join' })).toBeEnabled();
    expect(client.createJoinRequest).not.toHaveBeenCalled();
  });
});

// --- every blocked case says why ------------------------------------------

describe('when a student can\'t request', () => {
  test('already on a team: the button is disabled and the reason is shown', async () => {
    client.getProjects.mockResolvedValue([
      PARKING,
      { ...DEGREE, members: [{ user_id: 'u-sofia', name: 'Sofia' }], member_count: 2 },
    ]);
    await renderBrowse();
    const parking = card('Campus parking tracker');

    expect(within(parking).getByRole('button', { name: 'Already on a team' })).toBeDisabled();
    expect(within(parking).queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument();
    expect(within(parking).getByText(JOIN_BLOCKED.onTeam)).toBeInTheDocument();
  });

  test('already has a pending request for this project', async () => {
    client.getProjects.mockResolvedValue([{ ...PARKING, viewer_request_status: 'pending' }, DEGREE]);
    await renderBrowse();
    const parking = card('Campus parking tracker');

    expect(within(parking).getByRole('button', { name: 'Request pending' })).toBeDisabled();
    expect(within(parking).getByText(JOIN_BLOCKED.pending)).toBeInTheDocument();
    // Only this project: the other card is still open to a request.
    expect(within(card('Degree plan builder')).queryByText(JOIN_BLOCKED.pending)).not.toBeInTheDocument();
  });

  test('the project is full', async () => {
    const user = userEvent.setup();
    client.getProjects.mockResolvedValue([
      { ...PARKING, team_size_target: 2, member_count: 2, status: 'full' },
      DEGREE,
    ]);
    await renderBrowse();
    // Full projects are hidden by default.
    await user.click(screen.getByLabelText('Open projects only'));
    const parking = card('Campus parking tracker');

    expect(within(parking).getByRole('button', { name: 'Project full' })).toBeDisabled();
    expect(within(parking).getByText(JOIN_BLOCKED.full)).toBeInTheDocument();
  });

  test('the formation deadline has passed', async () => {
    client.getFormationDeadline.mockResolvedValue('2026-01-01T00:00:00Z');
    await renderBrowse();
    const parking = card('Campus parking tracker');

    expect(await within(parking).findByRole('button', { name: 'Requests closed' })).toBeDisabled();
    expect(within(parking).getByText(JOIN_BLOCKED.deadline)).toBeInTheDocument();
    expect(within(card('Degree plan builder')).getByText(JOIN_BLOCKED.deadline)).toBeInTheDocument();
  });

  test('a deadline still in the future leaves requests open', async () => {
    client.getFormationDeadline.mockResolvedValue('2999-01-01T00:00:00Z');
    await renderBrowse();
    expect(within(card('Campus parking tracker')).getByRole('button', { name: 'Request to join' })).toBeEnabled();
    expect(screen.queryByText(JOIN_BLOCKED.deadline)).not.toBeInTheDocument();
  });

  test('a refusal the page could not predict shows the server\'s reason on that card', async () => {
    const user = userEvent.setup();
    client.createJoinRequest.mockRejectedValue(new Error(JOIN_BLOCKED.full));
    await renderBrowse();
    const parking = card('Campus parking tracker');
    await user.click(within(parking).getByRole('button', { name: 'Request to join' }));
    await user.click(within(parking).getByRole('button', { name: 'Send request' }));

    expect(await within(parking).findByRole('alert')).toHaveTextContent(JOIN_BLOCKED.full);
  });

  test('your own project says so instead of offering a request', async () => {
    client.getProjects.mockResolvedValue([{ ...PARKING, creator_id: 'u-sofia' }, DEGREE]);
    await renderBrowse();
    const parking = card('Campus parking tracker');
    expect(within(parking).getByText('Your project')).toBeInTheDocument();
    expect(within(parking).queryByRole('button', { name: 'Request to join' })).not.toBeInTheDocument();
  });
});
