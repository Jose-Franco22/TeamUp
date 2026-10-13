// Issue #18 — the app shell end to end in mock mode: everything but /login
// needs a session, signing out goes to the sign-in page, and the
// first-sign-in walkthrough shows once per student.
import { describe, expect, test } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/SessionContext';
import { ThemeProvider } from './theme/ThemeContext';

const SESSION_KEY = 'teamup.mockSessionUserId';
const ONBOARDED_KEY = 'teamup.mockOnboarded';

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderApp(path, { signedInAs, onboarded = true } = {}) {
  if (signedInAs) {
    localStorage.setItem(SESSION_KEY, signedInAs);
    if (onboarded) localStorage.setItem(ONBOARDED_KEY, JSON.stringify([signedInAs]));
  }
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

describe('guests', () => {
  test.each(['/', '/browse', '/profile', '/team'])('a guest opening %s is sent to /login', async (start) => {
    renderApp(start);
    await waitFor(() => expect(path()).toBe('/login'));
    expect(screen.getByRole('heading', { name: 'Sign in to get started' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse' })).not.toBeInTheDocument();
  });
});

describe('signed in', () => {
  test('opening / goes to Browse', async () => {
    renderApp('/', { signedInAs: 'u-jose' });
    await waitFor(() => expect(path()).toBe('/browse'));
    expect(await screen.findByRole('heading', { name: 'Open projects' })).toBeInTheDocument();
  });

  test('signing out from a protected page lands on the sign-in page', async () => {
    renderApp('/profile', { signedInAs: 'u-jose' });
    await screen.findByRole('heading', { name: 'Your profile' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(path()).toBe('/login'));
    expect(screen.getByRole('heading', { name: 'Sign in to get started' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test('after signing out, the next sign-in starts on Browse, not the last student\'s page', async () => {
    renderApp('/profile', { signedInAs: 'u-jose' });
    await screen.findByRole('heading', { name: 'Your profile' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in to get started' });

    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(path()).toBe('/browse'));
  });
});

describe('first-sign-in walkthrough', () => {
  test('shows for a student who has not finished it', async () => {
    renderApp('/browse', { signedInAs: 'u-jose', onboarded: false });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  test('does not show for a student who already finished it', async () => {
    renderApp('/browse', { signedInAs: 'u-jose' });
    await screen.findByRole('heading', { name: 'Open projects' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('skipping it closes it, lands on Browse, and it stays dismissed next visit', async () => {
    renderApp('/profile', { signedInAs: 'u-jose', onboarded: false });
    await screen.findByRole('dialog');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Skip tour' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(path()).toBe('/browse');
    expect(JSON.parse(localStorage.getItem(ONBOARDED_KEY))).toContain('u-jose');
  });

  test('Next and Back move between steps, and the last step finishes the tour', async () => {
    renderApp('/browse', { signedInAs: 'u-jose', onboarded: false });
    const dialog = await screen.findByRole('dialog');
    const user = userEvent.setup();

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();

    // Walk to the end; the last step's button finishes the tour.
    while (!screen.queryByRole('button', { name: 'Browse projects' })) {
      await user.click(screen.getByRole('button', { name: 'Next' }));
    }
    await user.click(screen.getByRole('button', { name: 'Browse projects' }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(path()).toBe('/browse');
  });
});

describe('admin access (#36)', () => {
  test.each(['/admin', '/admin/students', '/admin/teams/t-parking', '/admin/students/u-adan'])('students opening %s are redirected without admin navigation', async (start) => {
    renderApp(start, { signedInAs: 'u-adan' });
    await waitFor(() => expect(path()).toBe('/browse'));
    expect(screen.queryByRole('heading', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('guests opening /admin must sign in', async () => {
    renderApp('/admin');
    await waitFor(() => expect(path()).toBe('/login'));
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('an instructor sees the admin page and navigation without the student walkthrough', async () => {
    renderApp('/admin', { signedInAs: 'u-instructor', onboarded: false });
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute('href', '/admin');
    expect(screen.queryByRole('link', { name: 'Create a project' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Your team' })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test.each(['/', '/login', '/browse', '/projects/new', '/requests', '/team'])('an instructor opening %s lands on /admin', async (start) => {
    renderApp(start, { signedInAs: 'u-instructor' });
    await waitFor(() => expect(path()).toBe('/admin'));
    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument();
  });

  test('admin sign-out removes admin navigation and returns to login', async () => {
    renderApp('/admin', { signedInAs: 'u-instructor' });
    await screen.findByRole('heading', { name: 'Administration' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(path()).toBe('/login'));
    expect(screen.queryByRole('link', { name: 'Admin' })).not.toBeInTheDocument();
  });

  test('an admin can follow dashboard links into any team and student details (#37)', async () => {
    renderApp('/admin', { signedInAs: 'u-instructor' });
    const teams = await screen.findByRole('table', { name: 'All teams' });
    const user = userEvent.setup();
    await user.click(within(teams).getByRole('link', { name: 'Campus parking tracker' }));
    expect(await screen.findByRole('heading', { name: 'Campus parking tracker' })).toBeInTheDocument();
    expect(path()).toBe('/admin/teams/t-parking');
    await user.click(screen.getByRole('link', { name: 'Jose Franco Garza' }));
    expect(await screen.findByRole('heading', { name: 'Jose Franco Garza' })).toBeInTheDocument();
    expect(path()).toBe('/admin/students/u-jose');
    await user.click(screen.getByRole('link', { name: 'Back to dashboard' }));
    expect(await screen.findByRole('table', { name: 'Unplaced students' })).toBeInTheDocument();
    const students = screen.getByRole('table', { name: 'Unplaced students' });
    await user.click(within(students).getByRole('link', { name: 'Adan Barrera' }));
    expect(await screen.findByRole('heading', { name: 'Adan Barrera' })).toBeInTheDocument();
    expect(screen.getByText('Not on a team.')).toBeInTheDocument();
  });
});

// Issue #46 — on a phone the tabs and Sign out sit in a slide-out menu.
// jsdom doesn't apply the stylesheet, so these check the menu's state, not
// whether it's on screen.
describe('phone menu (#46)', () => {
  const menuButton = (name) => screen.getByRole('button', { name });

  test('guests get no menu button', async () => {
    renderApp('/login');
    await screen.findByRole('heading', { name: 'Sign in to get started' });
    expect(screen.queryByRole('button', { name: 'Open menu' })).not.toBeInTheDocument();
  });

  test('picking a tab closes the menu', async () => {
    renderApp('/browse', { signedInAs: 'u-jose' });
    await screen.findByRole('heading', { name: 'Open projects' });
    const user = userEvent.setup();

    await user.click(menuButton('Open menu'));
    expect(menuButton('Close menu')).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('site-menu')).toHaveClass('open');

    await user.click(screen.getByRole('link', { name: 'Your profile' }));
    await waitFor(() => expect(path()).toBe('/profile'));
    expect(menuButton('Open menu')).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('site-menu')).not.toHaveClass('open');
  });

  test('Escape and the backdrop close the menu', async () => {
    renderApp('/browse', { signedInAs: 'u-jose' });
    await screen.findByRole('heading', { name: 'Open projects' });
    const user = userEvent.setup();

    await user.click(menuButton('Open menu'));
    await user.keyboard('{Escape}');
    expect(menuButton('Open menu')).toHaveAttribute('aria-expanded', 'false');

    await user.click(menuButton('Open menu'));
    await user.click(document.querySelector('.menu-backdrop'));
    expect(menuButton('Open menu')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('.menu-backdrop')).toBeNull();
  });

  test('Sign out works from inside the menu', async () => {
    renderApp('/browse', { signedInAs: 'u-jose' });
    await screen.findByRole('heading', { name: 'Open projects' });
    const user = userEvent.setup();

    await user.click(menuButton('Open menu'));
    await user.click(within(document.getElementById('site-menu')).getByRole('button', { name: 'Sign out' }));

    await waitFor(() => expect(path()).toBe('/login'));
    expect(screen.queryByRole('button', { name: /menu/ })).not.toBeInTheDocument();
  });
});
