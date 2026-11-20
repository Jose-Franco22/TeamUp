// Issue #55: weekly check-ins on the team page, against the mock API.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CheckIns from './CheckIns';
import { setSessionUserId } from '../api/client';
import { adviserRequests, checkIns } from '../api/mockData';
import { CHECK_IN_MAX, addWeeks, formatWeek, weekStart } from '../lib/checkIns';

// The lab-scheduler team in mockData: formed, Omar and Priya on it.
const PROJECT = 'p-lab';
const MEMBERS = [
  { user_id: 'u-omar', name: 'Omar Molina' },
  { user_id: 'u-priya', name: 'Priya Vale' },
];

const thisWeek = weekStart();
const lastWeek = addWeeks(thisWeek, -1);
const thisWeekLabel = `This week ${formatWeek(thisWeek)}`;
const lastWeekLabel = `Week of ${formatWeek(lastWeek)}`;

let savedCheckIns;
let savedAdvisers;
beforeEach(() => {
  savedCheckIns = checkIns.splice(0);
  savedAdvisers = adviserRequests.slice();
  setSessionUserId('u-omar');
});
afterEach(() => {
  checkIns.splice(0, checkIns.length, ...savedCheckIns);
  adviserRequests.splice(0, adviserRequests.length, ...savedAdvisers);
  setSessionUserId(null);
});

const seed = (row) =>
  checkIns.push({
    id: `ci-test-${checkIns.length}`,
    project_id: PROJECT,
    did: 'Did a thing',
    doing_next: 'Next thing',
    blockers: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...row,
  });

const renderCheckIns = (props = {}) =>
  render(
    <CheckIns
      projectId={PROJECT}
      members={MEMBERS}
      formedAt={`${addWeeks(thisWeek, -2)}T18:00:00Z`}
      viewerId="u-omar"
      {...props}
    />
  );

const week = (label) => screen.getByRole('region', { name: label });

describe('the form', () => {
  test('requires the first two fields, and saves nothing without them', async () => {
    const user = userEvent.setup();
    renderCheckIns();
    await screen.findByRole('region', { name: thisWeekLabel });

    await user.click(screen.getByRole('button', { name: 'Post check-in' }));
    expect(screen.getByText('Say what you worked on this week')).toBeInTheDocument();
    expect(screen.getByText("Say what you're doing next")).toBeInTheDocument();
    expect(screen.getByLabelText(/What I did/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/What's next/)).toHaveAttribute('aria-invalid', 'true');
    // Blockers are optional, so no error there.
    expect(screen.getByLabelText(/Anything blocking me/)).not.toHaveAttribute('aria-invalid');
    expect(checkIns).toHaveLength(0);
  });

  test(`refuses a field over ${CHECK_IN_MAX} characters and counts as you type`, async () => {
    const user = userEvent.setup();
    renderCheckIns();
    await screen.findByRole('region', { name: thisWeekLabel });

    await user.click(screen.getByLabelText(/What I did/));
    await user.paste('a'.repeat(CHECK_IN_MAX + 1));
    await user.type(screen.getByLabelText(/What's next/), 'Tests');
    await user.click(screen.getByLabelText(/Anything blocking me/));
    await user.paste('b'.repeat(CHECK_IN_MAX + 1));
    expect(screen.getAllByText(`${CHECK_IN_MAX + 1}/${CHECK_IN_MAX}`)).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Post check-in' }));
    expect(screen.getAllByText(`Keep it to ${CHECK_IN_MAX} characters or fewer`)).toHaveLength(2);
    expect(screen.getByLabelText(/What's next/)).not.toHaveAttribute('aria-invalid');
    expect(checkIns).toHaveLength(0);

    // Exactly the limit is fine.
    await user.clear(screen.getByLabelText(/What I did/));
    await user.click(screen.getByLabelText(/What I did/));
    await user.paste('a'.repeat(CHECK_IN_MAX));
    await user.clear(screen.getByLabelText(/Anything blocking me/));
    await user.click(screen.getByRole('button', { name: 'Post check-in' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check-in posted.');
    expect(checkIns).toHaveLength(1);
  });

  test('is not offered to an adviser, who still reads the check-ins', async () => {
    adviserRequests.push({
      id: 'ar-test', project_id: PROJECT, adviser_id: 'u-dana', invited_by: 'u-omar',
      status: 'accepted', created_at: '2026-01-01T00:00:00Z', responded_at: '2026-01-01T00:00:00Z',
    });
    seed({ user_id: 'u-priya', week_start: thisWeek, did: 'Mockups' });
    setSessionUserId('u-dana');
    renderCheckIns({ viewerId: 'u-dana', canPost: false });

    expect(await within(await screen.findByRole('region', { name: thisWeekLabel })).findByText('Mockups')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Check-in form' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /check-in/i })).not.toBeInTheDocument();
  });

  test('somebody outside the team sees an error, not the check-ins', async () => {
    seed({ user_id: 'u-priya', week_start: thisWeek, did: 'Secret progress' });
    setSessionUserId('u-maria');
    renderCheckIns({ viewerId: 'u-maria', canPost: false });

    expect(await screen.findByRole('alert')).toHaveTextContent("Only this team and its adviser can see the team's check-ins");
    expect(screen.queryByText('Secret progress')).not.toBeInTheDocument();
  });
});

describe('posting and editing', () => {
  test("submitting shows my check-in in this week's group", async () => {
    const user = userEvent.setup();
    renderCheckIns();
    await screen.findByRole('region', { name: thisWeekLabel });
    expect(within(week(thisWeekLabel)).getByText('No check-ins yet.')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/What I did/), '  Booking API  ');
    await user.type(screen.getByLabelText(/What's next/), 'Conflict detection');
    await user.click(screen.getByRole('button', { name: 'Post check-in' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Check-in posted.');
    const mine = within(week(thisWeekLabel)).getByRole('listitem', { name: "Omar Molina's check-in" });
    expect(mine).toHaveTextContent('Booking API');
    expect(mine).toHaveTextContent('Conflict detection');
    expect(checkIns).toMatchObject([
      { project_id: PROJECT, user_id: 'u-omar', week_start: thisWeek, did: 'Booking API', blockers: null },
    ]);

    // One a week: the form gives way to editing the one already posted.
    expect(screen.queryByRole('button', { name: 'Post check-in' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit my check-in' })).toBeInTheDocument();
  });

  test('editing updates it in place, rather than adding a second one', async () => {
    const user = userEvent.setup();
    seed({ user_id: 'u-omar', week_start: thisWeek, did: 'First draft', doing_next: 'More' });
    renderCheckIns();
    await within(await screen.findByRole('region', { name: thisWeekLabel })).findByText('First draft');

    await user.click(screen.getByRole('button', { name: 'Edit my check-in' }));
    expect(screen.getByLabelText(/What I did/)).toHaveValue('First draft');
    await user.clear(screen.getByLabelText(/What I did/));
    await user.type(screen.getByLabelText(/What I did/), 'Second draft');
    await user.type(screen.getByLabelText(/Anything blocking me/), 'Need a test server');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Check-in updated.');
    const mine = within(week(thisWeekLabel)).getByRole('listitem', { name: /Omar Molina's check-in/ });
    expect(mine).toHaveTextContent('Second draft');
    expect(mine).not.toHaveTextContent('First draft');
    expect(mine).toHaveTextContent('Need a test server');
    expect(checkIns).toHaveLength(1);
    expect(checkIns[0]).toMatchObject({ did: 'Second draft', blockers: 'Need a test server' });
  });

  test("last week's check-in has no edit control", async () => {
    seed({ user_id: 'u-omar', week_start: lastWeek, did: 'Old news' });
    renderCheckIns();
    await within(await screen.findByRole('region', { name: lastWeekLabel })).findByText('Old news');
    expect(screen.queryByRole('button', { name: 'Edit my check-in' })).not.toBeInTheDocument();
    // This week's is still open to post.
    expect(screen.getByRole('button', { name: 'Post check-in' })).toBeInTheDocument();
  });
});

describe('the list', () => {
  test('groups by week, newest first, listing who has not submitted', async () => {
    seed({ user_id: 'u-omar', week_start: thisWeek, did: 'This week, Omar' });
    seed({ user_id: 'u-omar', week_start: lastWeek, did: 'Last week, Omar' });
    seed({ user_id: 'u-priya', week_start: lastWeek, did: 'Last week, Priya' });
    renderCheckIns();
    await screen.findByRole('region', { name: thisWeekLabel });

    const headings = within(screen.getByRole('region', { name: 'Weekly check-ins' }))
      .getAllByRole('heading', { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      thisWeekLabel,
      lastWeekLabel,
      `Week of ${formatWeek(addWeeks(thisWeek, -2))}`,
    ]);

    expect(within(week(thisWeekLabel)).getByLabelText(`Missing check-ins for ${thisWeekLabel}`)).toHaveTextContent(
      'Not checked in yet: Priya Vale'
    );
    // Everyone checked in last week.
    expect(within(week(lastWeekLabel)).queryByLabelText(/Missing check-ins/)).not.toBeInTheDocument();
    // The week the team formed, nobody did.
    const formedWeek = `Week of ${formatWeek(addWeeks(thisWeek, -2))}`;
    expect(within(week(formedWeek)).getByLabelText(`Missing check-ins for ${formedWeek}`)).toHaveTextContent(
      "Didn't check in: Omar Molina, Priya Vale"
    );
  });

  test('a check-in with a blocker is highlighted, and one without is not', async () => {
    seed({ user_id: 'u-omar', week_start: thisWeek, did: 'Smooth week' });
    seed({ user_id: 'u-priya', week_start: thisWeek, did: 'Rough week', blockers: 'No access to the lab DB' });
    renderCheckIns();
    await within(await screen.findByRole('region', { name: thisWeekLabel })).findByText('Rough week');

    const blocked = screen.getByRole('listitem', { name: "Priya Vale's check-in, has a blocker" });
    expect(blocked).toHaveClass('blocked');
    expect(within(blocked).getByText('Blocker')).toBeInTheDocument();
    expect(within(blocked).getByText('No access to the lab DB')).toBeInTheDocument();

    const clear = screen.getByRole('listitem', { name: "Omar Molina's check-in" });
    expect(clear).not.toHaveClass('blocked');
    expect(within(clear).queryByText('Blocker')).not.toBeInTheDocument();
  });
});
