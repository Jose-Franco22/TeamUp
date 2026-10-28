// Issue #20 — the header bell: an unread count, live updates, click to open,
// and "Mark all as read". Runs against the mock API, whose
// addMockNotification() stands in for the database plus Realtime.
import { afterEach, describe, expect, test } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
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

function renderBell(seed = []) {
  notifications.push(...seed);
  setSessionUserId(ME);
  render(
    <MemoryRouter initialEntries={['/browse']}>
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

  test('each kind opens its own page', async () => {
    renderBell([note()]);
    await userEvent.click(await screen.findByRole('button', { name: /Notifications \(1 unread\)/ }));
    await userEvent.click(screen.getByRole('button', { name: /asked to join/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/requests');
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
