// Issue #61 — the admin's Close semester flow, run against the client in
// mock mode rather than a stub, so closing really archives the mock data and
// Browse really comes back empty afterwards.
//
// From mockData.js, Fall 2026 has 4 teams with 8 students on them, 3 pending
// join requests, Luis's unanswered adviser invitation and Dana's adviser link.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import SemesterPanel from './SemesterPanel';
import Browse from '../pages/Browse';
import { setSessionUserId } from '../api/client';
import {
  adviserRequests,
  joinRequests,
  milestones,
  notifications,
  projects,
  semesters,
  teamMembers,
} from '../api/mockData';

let session = { status: 'authenticated', user: { id: 'u-instructor', is_admin: true } };
vi.mock('../auth/SessionContext', () => ({ useSession: () => session }));

const ARRAYS = { semesters, joinRequests, adviserRequests, notifications, milestones, projects, teamMembers };
const saved = {};

beforeEach(() => {
  for (const [k, arr] of Object.entries(ARRAYS)) saved[k] = arr.map((row) => ({ ...row }));
  session = { status: 'authenticated', user: { id: 'u-instructor', is_admin: true } };
  setSessionUserId('u-instructor');
});

afterEach(() => {
  for (const [k, arr] of Object.entries(ARRAYS)) arr.splice(0, arr.length, ...saved[k]);
  setSessionUserId(null);
});

async function openDialog(user) {
  render(<SemesterPanel />);
  await user.click(await screen.findByRole('button', { name: 'Close semester' }));
  return screen.getByRole('dialog', { name: 'Close Fall 2026?' });
}

describe('the Close semester dialog', () => {
  test('shows how many teams and students it will archive, and what else it cancels', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const impact = within(dialog).getByRole('list', { name: 'What closing will do' });
    expect(impact).toHaveTextContent('4 teams and 8 students will be archived');
    expect(impact).toHaveTextContent('3 pending join requests will be cancelled');
    expect(impact).toHaveTextContent('1 pending adviser request will be cancelled');
    expect(impact).toHaveTextContent('1 adviser link will end');
  });

  test('asks for the rosters to be exported first, with the export button right there', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    expect(within(dialog).getByRole('heading', { name: 'Export the rosters first' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Export Fall 2026 rosters' })).toBeInTheDocument();
  });

  test('keeps the confirm button disabled until the name is typed exactly', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    const confirm = within(dialog).getByRole('button', { name: 'Close Fall 2026' });
    const input = within(dialog).getByLabelText(/to confirm/);

    expect(confirm).toBeDisabled();
    for (const typed of ['Fall 202', 'fall 2026', 'FALL 2026', 'Fall 2026 ', ' Fall 2026', 'Fall  2026']) {
      await user.clear(input);
      await user.type(input, typed);
      expect(confirm).toBeDisabled();
    }
    await user.clear(input);
    await user.type(input, 'Fall 2026');
    expect(confirm).toBeEnabled();
  });

  test('Cancel closes nothing', async () => {
    const user = userEvent.setup();
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(semesters[0].closed_at).toBeNull();
  });
});

describe('after closing', () => {
  test('the new-semester form appears, and Browse is empty', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SemesterPanel onChange={onChange} />);
    await user.click(await screen.findByRole('button', { name: 'Close semester' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/to confirm/), 'Fall 2026');
    await user.click(within(dialog).getByRole('button', { name: 'Close Fall 2026' }));

    expect(await screen.findByRole('form', { name: 'Start the next semester' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Fall 2026 is closed: 4 teams and 8 students archived.');
    expect(onChange).toHaveBeenCalled();

    // Browse, as a student, now has nothing to show.
    session = { status: 'authenticated', user: { id: 'u-adan' } };
    setSessionUserId('u-adan');
    render(<MemoryRouter><Browse /></MemoryRouter>);
    expect(await screen.findByText('No projects have been posted yet.')).toBeInTheDocument();
  });

  test('starting the next semester makes it current', async () => {
    const user = userEvent.setup();
    render(<SemesterPanel />);
    await user.click(await screen.findByRole('button', { name: 'Close semester' }));
    await user.type(screen.getByLabelText(/to confirm/), 'Fall 2026');
    await user.click(screen.getByRole('button', { name: 'Close Fall 2026' }));

    const form = await screen.findByRole('form', { name: 'Start the next semester' });
    await user.click(within(form).getByRole('button', { name: 'Start semester' }));
    expect(within(form).getByText('Give the semester a name')).toBeInTheDocument();

    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    await user.type(within(form).getByLabelText('Name'), 'Spring 2027');
    await user.type(within(form).getByLabelText('Starts'), day(1));
    await user.type(within(form).getByLabelText('Ends'), day(120));
    await user.type(within(form).getByLabelText('Team formation deadline'), `${day(30)}T23:59`);
    await user.click(within(form).getByRole('button', { name: 'Start semester' }));

    expect(await screen.findByText('Spring 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close semester' })).toBeInTheDocument();
  });

  test('the semester just closed can be reopened, after a confirm', async () => {
    const user = userEvent.setup();
    render(<SemesterPanel />);
    await user.click(await screen.findByRole('button', { name: 'Close semester' }));
    await user.type(screen.getByLabelText(/to confirm/), 'Fall 2026');
    await user.click(screen.getByRole('button', { name: 'Close Fall 2026' }));

    await user.click(await screen.findByRole('button', { name: 'Reopen Fall 2026' }));
    expect(semesters[0].closed_at).not.toBeNull();
    await user.click(screen.getByRole('button', { name: 'Yes, reopen Fall 2026' }));

    expect(await screen.findByRole('button', { name: 'Close semester' })).toBeInTheDocument();
    expect(semesters[0]).toMatchObject({ closed_at: null, reopened_by: 'u-instructor' });
    // The close's cancellations stand.
    expect(joinRequests.find((r) => r.id === 'jr-1').status).toBe('cancelled');
  });
});

test('nothing on the panel is a link — every action is a button (the PR #98 pattern)', async () => {
  const user = userEvent.setup();
  await openDialog(user);
  expect(screen.queryAllByRole('link')).toHaveLength(0);
});
