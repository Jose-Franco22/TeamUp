// Issue #27 — the owner can review a requester before deciding: name,
// skills, availability, GitHub link and message, oldest request first.
// Runs against the mock API.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Requests from './Requests';
import * as client from '../api/client';
import { joinRequests } from '../api/mockData';

// Lets a test hand the page its own list while every other call stays real.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getRequests: vi.fn(actual.getRequests) };
});

// Nicolas owns "Campus parking tracker", which has two pending requests:
// Rita Cano (jr-2, sent 31 Aug, no message) and Adan Barrera (jr-1, sent
// 1 Sep, with a message).
const OWNER = 'u-nicolas';

const snapshot = {};
beforeEach(() => {
  client.setSessionUserId(OWNER);
  snapshot.joinRequests = joinRequests.map((r) => ({ ...r }));
});
afterEach(() => {
  joinRequests.splice(0, joinRequests.length, ...snapshot.joinRequests);
  vi.mocked(client.getRequests).mockClear();
});

async function renderRequests() {
  render(
    <MemoryRouter>
      <Requests />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Requests' });
}

function rowFor(name) {
  return screen.getByLabelText(`Role for ${name}`).closest('.row');
}

function incomingNames() {
  return screen.getAllByLabelText(/^Role for /).map((el) => el.getAttribute('aria-label').replace('Role for ', ''));
}

describe("the requester's profile", () => {
  test('each pending request shows the name, skills, availability and GitHub link', async () => {
    await renderRequests();

    const adan = rowFor('Adan Barrera');
    expect(within(adan).getByText('Adan Barrera')).toBeInTheDocument();
    expect(
      within(adan).getByText('React, JavaScript, Figma, Node.js, PostgreSQL, Git, Jest')
    ).toBeInTheDocument();
    expect(within(adan).getByText('12 hrs/wk')).toBeInTheDocument();
    const github = within(adan).getByRole('link', { name: 'github.com/adanbarrera' });
    expect(github).toHaveAttribute('href', 'https://github.com/adanbarrera');
    expect(github).toHaveAttribute('target', '_blank');

    const rita = rowFor('Rita Cano');
    expect(within(rita).getByText('Rita Cano')).toBeInTheDocument();
    expect(within(rita).getByText('Python')).toBeInTheDocument();
    expect(within(rita).getByText('6 hrs/wk')).toBeInTheDocument();
    // Rita never linked a GitHub; the row says so instead of a dead link.
    expect(within(rita).queryByRole('link')).not.toBeInTheDocument();
    expect(within(rita).getByText('No GitHub linked')).toBeInTheDocument();
  });
});

describe("the requester's message", () => {
  test('is shown when there is one', async () => {
    await renderRequests();
    expect(
      within(rowFor('Adan Barrera')).getByText(/I park in Lot E every day/)
    ).toBeInTheDocument();
  });

  test('is left out when there is none, and the row still works', async () => {
    await renderRequests();
    const rita = rowFor('Rita Cano');
    expect(rita.querySelector('.req-message')).toBeNull();
    expect(within(rita).getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  test('a request with no message field at all still renders', async () => {
    // Rows from before the message column existed, or a partial response.
    const actual = await vi.importActual('../api/client');
    client.getRequests.mockImplementationOnce(async () => {
      const data = await actual.getRequests();
      return {
        ...data,
        incoming: data.incoming.map(({ message: _m, github_url: _g, ...rest }) => rest),
      };
    });
    await renderRequests();

    expect(incomingNames()).toEqual(['Rita Cano', 'Adan Barrera']);
    expect(document.querySelector('.req-message')).toBeNull();
    expect(screen.getAllByText('No GitHub linked')).toHaveLength(2);
  });
});

describe('ordering', () => {
  test('requests are listed oldest first', async () => {
    await renderRequests();
    // jr-1 (Adan) comes first in the table but was sent a day after jr-2.
    expect(incomingNames()).toEqual(['Rita Cano', 'Adan Barrera']);
  });

  test('order comes from when each request was sent, not where it is stored', async () => {
    joinRequests.push({
      id: 'jr-new',
      project_id: 'p-parking',
      user_id: 'u-omar',
      status: 'pending',
      message: '',
      created_at: '2026-09-05T08:00:00Z',
    });
    joinRequests.unshift({
      id: 'jr-old',
      project_id: 'p-parking',
      user_id: 'u-priya',
      status: 'pending',
      message: '',
      created_at: '2026-08-20T08:00:00Z',
    });
    await renderRequests();
    expect(incomingNames()).toEqual(['Priya Vale', 'Rita Cano', 'Adan Barrera', 'Omar Molina']);
  });
});
