// Issue #26 — a project creator hears about join requests: the Requests tab
// counts the pending ones, and each new request shows a notice naming who
// asked, linking to /requests. Runs the whole app against the mock API.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/SessionContext';
import { ThemeProvider } from './theme/ThemeContext';
import * as client from './api/client';
import { joinRequests, notifications, projects, teamMembers, teams } from './api/mockData';

// Spy on the two reads behind the badge and the notice while still calling
// the real (mock-mode) implementations, so a test can wait for them to
// settle before checking that something is absent.
vi.mock('./api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getPendingRequestCount: vi.fn(actual.getPendingRequestCount),
    getNotifications: vi.fn(actual.getNotifications),
  };
});

const SESSION_KEY = 'teamup.mockSessionUserId';
const ONBOARDED_KEY = 'teamup.mockOnboarded';

// Nicolas owns "Campus parking tracker", with pending requests from Adan
// Barrera and Rita Cano. Jose is on that team but owns nothing. Sofia is on
// no team and has no requests out.
const OWNER = 'u-nicolas';

const snapshot = {};
beforeEach(() => {
  snapshot.joinRequests = joinRequests.map((r) => ({ ...r }));
  snapshot.teamMembers = teamMembers.map((m) => ({ ...m }));
  snapshot.projects = projects.map((p) => ({ ...p }));
  snapshot.teams = teams.map((t) => ({ ...t }));
});
afterEach(() => {
  const restore = (arr, saved) => arr.splice(0, arr.length, ...saved);
  restore(joinRequests, snapshot.joinRequests);
  restore(teamMembers, snapshot.teamMembers);
  restore(projects, snapshot.projects);
  restore(teams, snapshot.teams);
  notifications.length = 0;
  vi.mocked(client.getPendingRequestCount).mockClear();
  vi.mocked(client.getNotifications).mockClear();
});

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderApp(path, signedInAs) {
  localStorage.setItem(SESSION_KEY, signedInAs);
  localStorage.setItem(ONBOARDED_KEY, JSON.stringify([signedInAs]));
  render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[path]}>
        <SessionProvider>
          <App />
          <CurrentPath />
        </SessionProvider>
      </MemoryRouter>
    </ThemeProvider>
  );
}

const path = () => screen.getByTestId('path').textContent;

// Sofia asks to join Nicolas's project, as she would from Browse.
async function sofiaRequestsParking() {
  client.setSessionUserId('u-sofia');
  await client.createJoinRequest('p-parking');
  client.setSessionUserId(null);
}

// Waits for every count and notifications read made so far to finish.
async function alertsSettled() {
  const spies = [client.getPendingRequestCount, client.getNotifications].map(vi.mocked);
  await waitFor(() => spies.forEach((spy) => expect(spy).toHaveBeenCalled()));
  await Promise.allSettled(spies.flatMap((spy) => spy.mock.results.map((r) => r.value)));
}

describe('createJoinRequest notifies the creator', () => {
  test('a request creates exactly one notification, for the project creator', async () => {
    await sofiaRequestsParking();

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      user_id: OWNER,
      kind: 'join_request',
      project_id: 'p-parking',
      actor_id: 'u-sofia',
      read_at: null,
    });
  });

  test('a refused request notifies no one', async () => {
    client.setSessionUserId('u-adan');
    await expect(client.createJoinRequest('p-parking')).rejects.toThrow(
      'You already have a pending request for this project'
    );
    client.setSessionUserId(OWNER);
    await expect(client.createJoinRequest('p-parking')).rejects.toThrow(
      'You cannot request to join your own project'
    );
    client.setSessionUserId('u-jose');
    await expect(client.createJoinRequest('p-degree')).rejects.toThrow(
      'You are already on a team and cannot request to join another project'
    );

    expect(notifications).toHaveLength(0);
  });
});

describe('Requests tab badge', () => {
  test('shows how many requests are pending', async () => {
    renderApp('/browse', OWNER);

    const tab = await screen.findByRole('link', { name: 'Requests (2 pending)' });
    expect(tab.querySelector('.count-badge')).toHaveTextContent('2');
  });

  test('counts a new request', async () => {
    await sofiaRequestsParking();
    renderApp('/browse', OWNER);

    expect(await screen.findByRole('link', { name: 'Requests (3 pending)' })).toBeInTheDocument();
  });

  test('is not shown when nothing is pending', async () => {
    renderApp('/browse', 'u-jose');
    await screen.findByRole('heading', { name: 'Open projects' });
    await alertsSettled();

    const tab = screen.getByRole('link', { name: 'Requests' });
    expect(tab.querySelector('.count-badge')).toBeNull();
  });

  test('counts down as requests are answered and clears at zero', async () => {
    const user = userEvent.setup();
    renderApp('/requests', OWNER);
    await screen.findByRole('link', { name: 'Requests (2 pending)' });

    const declineFor = (name) =>
      within(screen.getByLabelText(`Role for ${name}`).closest('.row')).getByRole('button', { name: 'Decline' });

    await user.click(declineFor('Adan Barrera'));
    expect(await screen.findByRole('link', { name: 'Requests (1 pending)' })).toBeInTheDocument();

    await user.click(declineFor('Rita Cano'));
    const tab = await screen.findByRole('link', { name: 'Requests' });
    expect(tab.querySelector('.count-badge')).toBeNull();
  });
});

describe('new-request notice', () => {
  test('names the requester and the project, and links to the Requests page', async () => {
    await sofiaRequestsParking();
    renderApp('/browse', OWNER);

    const notice = await screen.findByRole('region', { name: 'New join requests' });
    expect(notice).toHaveTextContent('Sofia Garza asked to join “Campus parking tracker”.');
    expect(within(notice).getByRole('link', { name: 'Review on your Requests page' })).toHaveAttribute(
      'href',
      '/requests'
    );
  });

  test('following the link opens Requests and marks the notice read', async () => {
    await sofiaRequestsParking();
    renderApp('/browse', OWNER);
    const notice = await screen.findByRole('region', { name: 'New join requests' });

    await userEvent.setup().click(within(notice).getByRole('link', { name: 'Review on your Requests page' }));

    await waitFor(() => expect(path()).toBe('/requests'));
    expect(await screen.findByLabelText('Role for Sofia Garza')).toBeInTheDocument();
    await waitFor(() => expect(notifications[0].read_at).not.toBeNull());
    expect(screen.queryByRole('region', { name: 'New join requests' })).not.toBeInTheDocument();
  });

  test('Dismiss hides it and marks it read', async () => {
    await sofiaRequestsParking();
    renderApp('/browse', OWNER);
    const notice = await screen.findByRole('region', { name: 'New join requests' });

    await userEvent.setup().click(within(notice).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('region', { name: 'New join requests' })).not.toBeInTheDocument();
    await waitFor(() => expect(notifications[0].read_at).not.toBeNull());
  });

  test('only the creator sees it', async () => {
    await sofiaRequestsParking();
    renderApp('/browse', 'u-sofia');
    await screen.findByRole('heading', { name: 'Open projects' });
    await alertsSettled();

    expect(screen.queryByRole('region', { name: 'New join requests' })).not.toBeInTheDocument();
  });
});
