// Issue #20 — the header bell: an unread count, live updates, click to open,
// and "Mark all as read". Runs against the mock API, whose
// addMockNotification() stands in for the database plus Realtime.
import { afterEach, describe, expect, test } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import NotificationBell, { LINKS, notificationText } from './NotificationBell';
import { addMockNotification, getNotificationFeed, setSessionUserId } from '../api/client';
import { notifications } from '../api/mockData';

const ME = 'u-nicolas';

let seq = 0;
function note(fields) {
  seq += 1;
  return {
    id: `n-test-${seq}`,
    user_id: ME,
    kind: 'join_request',
    project_id: 'p-parking',
    actor_id: 'u-sofia',
    by_admin: false,
    created_at: new Date(Date.UTC(2026, 9, 1, 0, seq)).toISOString(),
    read_at: null,
    ...fields,
  };
}

afterEach(() => {
  notifications.length = 0;
  setSessionUserId(null);
});

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderBell(seed = [], start = '/browse') {
  notifications.push(...seed);
  setSessionUserId(ME);
  render(
    <MemoryRouter initialEntries={[start]}>
      <NotificationBell />
      <CurrentPath />
    </MemoryRouter>
  );
}

const bell = () => screen.getByRole('button', { name: /^Notifications/ });

describe('NotificationBell', () => {
  test('shows the unread count, counting only unread ones', async () => {
    renderBell([note(), note(), note({ read_at: '2026-10-01T00:00:00Z' })]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('2');
    expect(bell()).toHaveAccessibleName('Notifications (2 unread)');
  });

  test('hides the badge at 0', async () => {
    renderBell([note({ read_at: '2026-10-01T00:00:00Z' })]);
    await act(() => getNotificationFeed());
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notifications'));
    expect(screen.queryByTestId('bell-badge')).not.toBeInTheDocument();
  });

  test('only counts the signed-in user’s notifications', async () => {
    renderBell([note(), note({ user_id: 'u-sofia' })]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');
  });

  test('a new notification raises the count without a reload', async () => {
    renderBell([note()]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');

    act(() => addMockNotification(note({ actor_id: 'u-rita' })));
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('2');

    await userEvent.click(bell());
    expect(screen.getByText('Rita Cano asked to join “Campus parking tracker”')).toBeInTheDocument();
  });

  // Realtime can send the same row again on reconnect; the list already
  // ignored the repeat, and the count has to as well.
  test('the same notification delivered twice only counts once', async () => {
    const seeded = note();
    renderBell([seeded]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');

    act(() => addMockNotification(seeded));
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('1');

    const fresh = note({ actor_id: 'u-rita' });
    act(() => addMockNotification(fresh));
    act(() => addMockNotification(fresh));
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('2');
  });

  test('a notification for someone else doesn’t change the count', async () => {
    renderBell([note()]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');
    act(() => addMockNotification(note({ user_id: 'u-sofia' })));
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('1');
  });

  // The way App.requests.test.jsx has Sofia ask to join: switch the mock
  // session to her, write, switch back.
  test('a notification written while acting as someone else still arrives', async () => {
    renderBell();
    await act(() => getNotificationFeed());
    setSessionUserId('u-sofia');
    act(() => addMockNotification(note()));
    setSessionUserId(ME);
    expect(screen.getByTestId('bell-badge')).toHaveTextContent('1');
  });

  test('clicking a notification marks it read and opens its page', async () => {
    const accepted = note({ kind: 'request_accepted', actor_id: 'u-jose' });
    renderBell([note(), accepted]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('2');

    await userEvent.click(bell());
    await userEvent.click(screen.getByRole('button', { name: /You were accepted onto/ }));

    expect(screen.getByTestId('path')).toHaveTextContent('/team');
    await waitFor(() => expect(notifications.find((n) => n.id === accepted.id).read_at).not.toBeNull());
    await waitFor(() => expect(screen.getByTestId('bell-badge')).toHaveTextContent('1'));
    expect(notifications.filter((n) => !n.read_at)).toHaveLength(1);
  });

  // The page each kind should open, written out by hand. Reading these from
  // LINKS would only compare the map with itself, and pointing
  // request_declined at /team (#34) would have passed.
  const EXPECTED_LINKS = {
    // An invitation to advise wants an answer, and /requests is where things
    // waiting for one live (#53). Being removed as adviser does not: they
    // hold no seat, so there is no team page of theirs to open.
    adviser_invited: '/requests',
    adviser_removed: '/browse',
    // The owner's three (#54). Their team page is where the adviser shows,
    // and where they would invite somebody else.
    adviser_accepted: '/team',
    adviser_declined: '/team',
    adviser_stepped_down: '/team',
    deadline_reminder: '/browse',
    // The check-in form is on the team page (#55).
    check_in_reminder: '/team',
    // #57: feedback to the team, submissions to the adviser — both on /team.
    deliverable_feedback: '/team',
    deliverable_submitted: '/team',
    join_request: '/requests',
    member_left: '/team',
    member_removed: '/browse',
    project_removed: '/browse',
    request_accepted: '/team',
    request_declined: '/browse',
    team_complete: '/team',
  };

  test('every kind in LINKS has an expected page here', () => {
    expect(Object.keys(EXPECTED_LINKS).sort()).toEqual(Object.keys(LINKS).sort());
  });

  // Without its own case it would fall through to "Something changed on…",
  // which tells an adviser nothing about there being work to look at.
  test('a deliverable_submitted notification says who submitted for which project', () => {
    expect(
      notificationText({ kind: 'deliverable_submitted', actor_name: 'Rita Cano', project_title: 'Campus parking tracker' })
    ).toBe('Rita Cano submitted a deliverable for “Campus parking tracker”');
  });

  test('a deliverable_feedback notification tells the team who responded, and on which project', () => {
    expect(
      notificationText({ kind: 'deliverable_feedback', actor_name: 'Dana Kim', project_title: 'Campus parking tracker' })
    ).toBe('Dana Kim left feedback on a deliverable for “Campus parking tracker”');
  });

  // Starts somewhere no kind links to, so landing on /browse is a real move.
  test.each(Object.entries(EXPECTED_LINKS))('clicking a %s notification opens %s', async (kind, page) => {
    renderBell([note({ kind, project_title: 'Campus parking tracker' })], '/start');
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');

    await userEvent.click(bell());
    const panel = screen.getByRole('region', { name: 'Notifications' });
    await userEvent.click(within(within(panel).getByRole('list')).getByRole('button'));

    expect(screen.getByTestId('path')).toHaveTextContent(page);
  });

  test('"Mark all as read" sets the count to 0', async () => {
    renderBell([note(), note(), note({ user_id: 'u-sofia' })]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('2');

    await userEvent.click(bell());
    const panel = screen.getByRole('region', { name: 'Notifications' });
    await userEvent.click(within(panel).getByRole('button', { name: 'Mark all as read' }));

    expect(screen.queryByTestId('bell-badge')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(notifications.filter((n) => n.user_id === ME && !n.read_at)).toHaveLength(0)
    );
    // Someone else's stay unread.
    expect(notifications.find((n) => n.user_id === 'u-sofia').read_at).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  test('says so when there are none', async () => {
    renderBell();
    await userEvent.click(bell());
    expect(await screen.findByText('Nothing yet.')).toBeInTheDocument();
  });
});

// --- a project that no longer exists (issue #25) --------------------------
//
// The only kind whose project is gone by the time the notification is read.
// It carries the title instead of a project_id, because a project_id would
// have cascaded the row away with the project — see
// supabase/32_notify_on_project_delete.sql.

describe('a deleted project', () => {
  const removed = () =>
    note({
      kind: 'project_removed',
      project_id: null,
      project_title: 'Campus parking tracker',
      actor_id: 'u-sofia',
    });

  test('says the project went and the request went with it', async () => {
    renderBell([removed()]);
    await screen.findByTestId('bell-badge');
    await userEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(
      screen.getByText(
        '“Campus parking tracker” was removed, so your request to join it is cancelled'
      )
    ).toBeInTheDocument();
  });

  test('names the project from the stored title, with no project to join on', async () => {
    renderBell([removed()]);
    await screen.findByTestId('bell-badge');
    await userEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    // The fallback is "a project"; seeing the real name proves the stored
    // title is used rather than the join, which has no project_id to follow.
    expect(screen.getByText(/Campus parking tracker/)).toBeInTheDocument();
    expect(screen.queryByText(/“a project”/)).not.toBeInTheDocument();
  });

  test('falls back gracefully if even the title is missing', async () => {
    renderBell([note({ kind: 'project_removed', project_id: null, project_title: null })]);
    await screen.findByTestId('bell-badge');
    await userEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(screen.getByText(/“a project” was removed/)).toBeInTheDocument();
  });

  test('opens Browse, since the project it was about is gone', async () => {
    const user = userEvent.setup();
    renderBell([removed()]);
    await screen.findByTestId('bell-badge');
    await user.click(screen.getByRole('button', { name: /^Notifications/ }));
    await user.click(await screen.findByText(/was removed, so your request/));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/browse'));
  });
});

// --- deadline reminders (issue #43) ----------------------------------------
//
// Written hourly by supabase/37_deadline_reminders.sql for students who
// aren't on a full team. Like every kind, they arrive in the bell.

describe('a deadline reminder', () => {
  const reminder = () =>
    note({ kind: 'deadline_reminder', project_id: null, actor_id: null, project_title: null });

  test('says the deadline is coming up, without naming a project', async () => {
    renderBell([reminder()]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');
    await userEvent.click(bell());
    expect(
      screen.getByText(
        "The team formation deadline is coming up and you're not on a full team yet — find a team before rosters lock"
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/a project/)).not.toBeInTheDocument();
  });

  test('opens Browse, to find a team', async () => {
    const user = userEvent.setup();
    renderBell([reminder()]);
    await screen.findByTestId('bell-badge');
    await user.click(bell());
    await user.click(await screen.findByText(/formation deadline is coming up/));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/browse'));
  });

  test('arrives live, like any other notification', async () => {
    renderBell();
    await waitFor(() => expect(bell()).toHaveAccessibleName('Notifications'));
    act(() => addMockNotification(reminder()));
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');
  });
});

// --- advising (#53, #54) ---------------------------------------------------
// Five kinds between the two stories, and the thing worth asserting is that
// none of them reads like a join request. "Ada asked you" has to mean
// something different here, and the two that leave a project without an
// adviser have to say what the owner can do next.
describe('the adviser kinds', () => {
  const adviserNote = (kind) =>
    note({ kind, actor_name: 'Ada Adviser', project_title: 'Campus parking tracker' });

  async function textOf(kind) {
    renderBell([adviserNote(kind)]);
    expect(await screen.findByTestId('bell-badge')).toHaveTextContent('1');
    await userEvent.click(bell());
    return screen.getByRole('region', { name: 'Notifications' }).textContent;
  }

  test('an invitation says it is to advise, not to join', async () => {
    const text = await textOf('adviser_invited');
    expect(text).toContain('asked you to advise');
    expect(text).toContain('not a seat on it');
    expect(text).not.toContain('asked to join');
  });

  test('an acceptance names who is now advising', async () => {
    expect(await textOf('adviser_accepted')).toContain('accepted and is now advising');
  });

  test('a decline tells the owner they can ask someone else', async () => {
    const text = await textOf('adviser_declined');
    expect(text).toContain('turned down advising');
    expect(text).toContain('you can ask someone else');
  });

  test('and so does a stepping-down, which leaves the same gap', async () => {
    const text = await textOf('adviser_stepped_down');
    expect(text).toContain('stepped down as adviser');
    expect(text).toContain('you can ask someone else');
  });

  // The adviser's own side: being dropped is not phrased as a refusal.
  test('being removed does not read as having declined', async () => {
    const text = await textOf('adviser_removed');
    expect(text).toContain('no longer the adviser');
    expect(text).not.toMatch(/declin|turned down/i);
  });
});
