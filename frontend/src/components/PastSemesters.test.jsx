// Issue #61 — the Past semesters section, against the client in mock mode
// after Fall 2026 has really been closed. Read-only is the point: the
// section offers nothing to type into, tick, pick or follow, and its only
// buttons open and close a team's details.
import { afterEach, beforeEach, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PastSemesters from './PastSemesters';
import { closeSemester, setSessionUserId } from '../api/client';
import { adviserRequests, joinRequests, notifications, semesters } from '../api/mockData';

const ARRAYS = { semesters, joinRequests, adviserRequests, notifications };
const saved = {};

beforeEach(async () => {
  for (const [k, arr] of Object.entries(ARRAYS)) saved[k] = arr.map((row) => ({ ...row }));
  setSessionUserId('u-instructor');
  await closeSemester('sem-fall-2026', 'Fall 2026');
});

afterEach(() => {
  for (const [k, arr] of Object.entries(ARRAYS)) arr.splice(0, arr.length, ...saved[k]);
  setSessionUserId(null);
});

function expectReadOnly(container) {
  for (const role of ['textbox', 'checkbox', 'combobox', 'radio', 'spinbutton', 'link']) {
    expect(within(container).queryAllByRole(role)).toHaveLength(0);
  }
  for (const button of within(container).queryAllByRole('button')) {
    expect(button).toHaveAccessibleName(/^(Show|Hide) /);
  }
}

test("a student sees their own archived team, read-only, and nobody else's", async () => {
  setSessionUserId('u-nicolas');
  render(<PastSemesters />);
  const section = (await screen.findByRole('heading', { name: 'Past semesters' })).closest('section');
  const list = within(section).getByRole('list', { name: 'Fall 2026 teams' });
  expect(within(list).getAllByRole('listitem').filter((li) => li.classList.contains('past-team'))).toHaveLength(1);
  expect(within(list).getByText('Campus parking tracker')).toBeInTheDocument();
  expect(within(list).getByText('Your team')).toBeInTheDocument();
  expect(within(section).queryByText('Degree plan builder')).not.toBeInTheDocument();
  expectReadOnly(section);
});

test('opening a past team shows its members, adviser, deliverables and check-ins — still with no edit controls', async () => {
  const user = userEvent.setup();
  setSessionUserId('u-omar');
  render(<PastSemesters />);
  await user.click(await screen.findByRole('button', { name: 'Show Lab equipment sign-out' }));

  const section = screen.getByRole('heading', { name: 'Past semesters' }).closest('section');
  expect(await within(section).findByRole('heading', { name: 'Members' })).toBeInTheDocument();
  expect(within(section).getByText('Priya Vale')).toBeInTheDocument();
  expect(within(section).getByText('Adviser: none')).toBeInTheDocument();
  const checkIns = within(section).getByRole('list', { name: 'Check-ins' });
  expect(checkIns).toHaveTextContent('Still waiting on the lab manager for the room list.');
  expect(within(section).getByRole('button', { name: 'Hide Lab equipment sign-out' })).toHaveAttribute('aria-expanded', 'true');
  expectReadOnly(section);
});

test('an adviser sees the team they advised', async () => {
  setSessionUserId('u-dana');
  render(<PastSemesters />);
  const section = (await screen.findByRole('heading', { name: 'Past semesters' })).closest('section');
  const row = within(section).getByText('Campus parking tracker').closest('li');
  expect(within(row).getByText('You advised')).toBeInTheDocument();
});

test('somebody with no past team sees no section at all', async () => {
  setSessionUserId('u-adan');
  const { container } = render(<PastSemesters />);
  // Give the load time to land, then check nothing was drawn.
  await new Promise((r) => setTimeout(r, 400));
  expect(container).toBeEmptyDOMElement();
});
