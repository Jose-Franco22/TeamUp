// Issue #56 — the Advising link in the header, end to end in mock mode.
// In the fixtures u-dana is the accepted adviser of p-parking (and sits on
// the scam-detector team herself); u-jose advises nothing.
import { describe, expect, test } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/SessionContext';
import { ThemeProvider } from './theme/ThemeContext';

function CurrentPath() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}

function renderApp(path, signedInAs) {
  localStorage.setItem('teamup.mockSessionUserId', signedInAs);
  localStorage.setItem('teamup.mockOnboarded', JSON.stringify([signedInAs]));
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

describe('the Advising link', () => {
  test('shows for somebody who advises a team, and opens the dashboard', async () => {
    renderApp('/browse', 'u-dana');

    const link = await screen.findByRole('link', { name: 'Advising' });
    await userEvent.setup().click(link);

    expect(screen.getByTestId('path')).toHaveTextContent('/advising');
    expect(await screen.findByRole('heading', { name: 'Campus parking tracker' })).toBeInTheDocument();
  });

  test('is not there for somebody who advises nothing', async () => {
    renderApp('/browse', 'u-jose');

    await screen.findByRole('heading', { name: 'Open projects' });
    // Give the header's check time to come back before asserting absence.
    await waitFor(() => expect(screen.getByRole('link', { name: 'Your team' })).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('link', { name: 'Advising' })).not.toBeInTheDocument();
  });
});

test('a card opens that team’s page, read-only', async () => {
  renderApp('/advising', 'u-dana');

  const card = await screen.findByRole('link', { name: /^Campus parking tracker/ });
  await userEvent.setup().click(card);

  expect(screen.getByTestId('path')).toHaveTextContent('/advising/p-parking');
  const section = await screen.findByRole('region', { name: 'Advising Campus parking tracker' });
  expect(section).toBeInTheDocument();
  expect(screen.getByText(/not on its roster and hold no seat/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← All teams you advise' })).toHaveAttribute('href', '/advising');
});

test('opening a team you don’t advise says so', async () => {
  renderApp('/advising/p-lab', 'u-dana');

  expect(await screen.findByText("You don't advise this team.")).toBeInTheDocument();
});
