// Issue #40's last criterion, on the dashboard #56 built: "advisers get the
// same export limited to the teams they advise, from the Advising dashboard".
//
// The scoping is not tested here, because it does not live here —
// export_rosters() narrows by who is asking (supabase/46_export_rosters.sql,
// 35 assertions) and api/exportRosters.test.js covers the client's half. What
// this file pins is the part that was missing for a month: that the button is
// on the page at all, that it is the admin's component rather than a second
// one, and that it is not offered to somebody the server would refuse.
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Advising from './Advising';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getAdviserDashboard: vi.fn(), exportRosters: vi.fn() };
});

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const TEAM = {
  project_id: 'p-lab',
  title: 'Lab scheduler',
  team_id: 't-lab',
  formed_at: ago(40),
  members: [{ user_id: 'u-omar', name: 'Omar Haddad' }],
  check_ins_submitted: 1,
  check_ins_expected: 1,
  open_blockers: 0,
  last_check_in_at: ago(0.1),
  next_milestone_id: null,
  next_milestone_name: null,
  next_milestone_due_at: null,
  next_deliverable_status: null,
  overdue_deliverables: 0,
  changes_requested: 0,
  last_commit_at: ago(1),
};

const ROSTERS = {
  scope: 'adviser',
  generated_at: '2026-11-24T20:00:00Z',
  teams: [{ team_id: 't-lab', project_id: 'p-lab', team_name: 'Lab scheduler', status: 'full' }],
  members: [],
  unplaced_students: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  client.getAdviserDashboard.mockResolvedValue([TEAM]);
  client.exportRosters.mockResolvedValue(ROSTERS);
});

const renderPage = async () => {
  render(
    <MemoryRouter>
      <Advising />
    </MemoryRouter>
  );
  return screen.findByRole('heading', { name: 'Advising' });
};

test('an adviser with teams gets the export button', async () => {
  await renderPage();
  expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeInTheDocument();
});

test('clicking it asks the server for the rosters', async () => {
  await renderPage();

  await userEvent.click(screen.getByRole('button', { name: 'Export to Excel' }));

  expect(client.exportRosters).toHaveBeenCalledTimes(1);
});

// export_rosters() refuses a caller who is neither an admin nor an accepted
// adviser, so somebody who stepped down would get a button that 403s. The
// empty state is the whole page for them; a download control on it would be
// the one thing there that does not work.
test('an adviser with no teams gets no button, because the server would refuse it', async () => {
  client.getAdviserDashboard.mockResolvedValue([]);
  await renderPage();

  expect(screen.queryByRole('button', { name: 'Export to Excel' })).not.toBeInTheDocument();
  expect(screen.getByText(/aren't advising any teams yet/i)).toBeInTheDocument();
});

// The label is the admin's, deliberately. An admin who also advises gets the
// admin scope from export_rosters() — every team, not only theirs — so a
// label promising "my teams" would be a promise the server does not keep.
test('it is the same component and label as the admin page, not a second one', async () => {
  await renderPage();

  const button = screen.getByRole('button', { name: 'Export to Excel' });
  expect(button).toHaveClass('btn', 'ghost');
  expect(screen.queryByRole('button', { name: /my teams/i })).not.toBeInTheDocument();
});
