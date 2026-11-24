// Issue #56 — the adviser dashboard, from mocked adviser_dashboard() rows.
import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Advising from './Advising';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getAdviserDashboard: vi.fn() };
});

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const ahead = (days) => ago(-days);

const ON_TRACK = {
  project_id: 'p-lab',
  title: 'Lab scheduler',
  team_id: 't-lab',
  formed_at: ago(40),
  members: [
    { user_id: 'u-omar', name: 'Omar Haddad' },
    { user_id: 'u-priya', name: 'Priya Shah' },
  ],
  check_ins_submitted: 2,
  check_ins_expected: 2,
  open_blockers: 0,
  last_check_in_at: ago(0.1),
  next_milestone_id: 'm-design',
  next_milestone_name: 'Design doc',
  next_milestone_due_at: ahead(3),
  next_deliverable_status: 'approved',
  overdue_deliverables: 0,
  changes_requested: 0,
  last_commit_at: ago(2.2),
};

const STRUGGLING = {
  project_id: 'p-parking',
  title: 'Campus parking tracker',
  team_id: 't-parking',
  formed_at: ago(40),
  members: [
    { user_id: 'u-jose', name: 'Jose Franco Garza' },
    { user_id: 'u-nicolas', name: 'Nicolas Guerra' },
    { user_id: 'u-adan', name: 'Adan Barrera' },
    { user_id: 'u-rita', name: 'Rita Gomez' },
  ],
  check_ins_submitted: 3,
  check_ins_expected: 4,
  open_blockers: 2,
  last_check_in_at: ago(9),
  next_milestone_id: 'm-design',
  next_milestone_name: 'Design doc',
  next_milestone_due_at: ahead(3),
  next_deliverable_status: 'changes_requested',
  overdue_deliverables: 1,
  changes_requested: 1,
  last_commit_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

function renderPage() {
  render(
    <MemoryRouter>
      <Advising />
    </MemoryRouter>
  );
}

const card = (name) => screen.getByRole('link', { name: new RegExp(`^${name}`) });

test('one card per team, each opening that team’s page', async () => {
  client.getAdviserDashboard.mockResolvedValue([ON_TRACK, STRUGGLING]);
  renderPage();

  expect(await screen.findByRole('heading', { name: 'Lab scheduler' })).toBeInTheDocument();
  expect(card('Lab scheduler')).toHaveAttribute('href', '/advising/p-lab');
  expect(card('Campus parking tracker')).toHaveAttribute('href', '/advising/p-parking');
});

test('a card shows the counts: members, check-ins, blockers, next milestone and days since a check-in', async () => {
  client.getAdviserDashboard.mockResolvedValue([STRUGGLING]);
  renderPage();

  const c = within(await screen.findByRole('link', { name: /^Campus parking tracker/ }));
  expect(c.getByText('Jose Franco Garza, Nicolas Guerra, Adan Barrera, Rita Gomez')).toBeInTheDocument();
  expect(c.getByText('3 of 4')).toBeInTheDocument();
  expect(c.getByText('Open blockers').nextElementSibling).toHaveTextContent('2');
  expect(c.getByText('Last check-in').nextElementSibling).toHaveTextContent('9 days ago');
  expect(c.getByText('Next milestone').nextElementSibling).toHaveTextContent(/Design doc.*due/);
  expect(c.getByText('Changes requested', { selector: '.pill' })).toBeInTheDocument();
  // No repository linked, so no Last commit row at all.
  expect(c.queryByText('Last commit')).not.toBeInTheDocument();
});

test('a team that needs attention says so, and why', async () => {
  client.getAdviserDashboard.mockResolvedValue([STRUGGLING]);
  renderPage();

  const c = within(await screen.findByRole('link', { name: 'Campus parking tracker, needs attention' }));
  expect(c.getByText('Needs attention')).toBeInTheDocument();
  const reasons = within(c.getByRole('list', { name: 'Why it needs attention' }))
    .getAllByRole('listitem')
    .map((li) => li.textContent);
  expect(reasons).toEqual(['Deliverable overdue', 'Changes requested', 'Open blocker', 'No check-ins in 7 days']);
});

test('a healthy team is not flagged, and shows its last commit', async () => {
  client.getAdviserDashboard.mockResolvedValue([ON_TRACK]);
  renderPage();

  const c = within(await screen.findByRole('link', { name: 'Lab scheduler' }));
  expect(c.getByText('On track')).toBeInTheDocument();
  expect(c.queryByText('Needs attention')).not.toBeInTheDocument();
  expect(c.queryByRole('list', { name: 'Why it needs attention' })).not.toBeInTheDocument();
  expect(c.getByText('Last check-in').nextElementSibling).toHaveTextContent('Today');
  expect(c.getByText('Last commit').nextElementSibling).toHaveTextContent('2 days ago');
  expect(c.getByText('Approved', { selector: '.pill' })).toBeInTheDocument();
});

test('flagged teams come first, whatever order the rows arrive in', async () => {
  client.getAdviserDashboard.mockResolvedValue([ON_TRACK, STRUGGLING]);
  renderPage();

  await screen.findByRole('heading', { name: 'Lab scheduler' });
  const titles = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(titles).toEqual(['Campus parking tracker', 'Lab scheduler']);
  expect(screen.getByText(/2 teams · 1 needs attention/)).toBeInTheDocument();
});

test('with no teams, the empty state explains how to start advising', async () => {
  client.getAdviserDashboard.mockResolvedValue([]);
  renderPage();

  expect(await screen.findByText("You aren't advising any teams yet.")).toBeInTheDocument();
  expect(screen.getByText(/asks you to advise their team/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Requests' })).toHaveAttribute('href', '/requests');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

test('a failure to load says so and offers a retry', async () => {
  client.getAdviserDashboard.mockRejectedValue(new Error('PGRST500'));
  renderPage();

  expect(await screen.findByRole('alert')).toHaveTextContent('PGRST500');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
