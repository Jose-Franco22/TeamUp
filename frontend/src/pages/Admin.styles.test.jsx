// The teams table's layout rules, checked against the real markup so a class
// renamed on one side breaks a test. jsdom cascades styles.css by source
// order only (no specificity) and skips @media, and it does no layout, so
// these check which declarations reach which cells, not how it looks.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Admin from './Admin';
import { getAdminActions, getAdminDashboard } from '../api/client';
import { DASHBOARD } from '../test/adminFixtures';

vi.mock('../api/client', () => ({
  getAdminDashboard: vi.fn(),
  getAdminActions: vi.fn(),
  // The Semester panel and Past semesters (#61), which this page now holds.
  getSemesterClosePreview: vi.fn(async () => ({
    semester_id: 'sem-fall-2026', name: 'Fall 2026', starts_on: '2026-08-24', ends_on: '2026-12-12',
    teams: 2, students: 3, pending_join_requests: 1, pending_adviser_requests: 0, adviser_links: 1,
  })),
  getPastSemesters: vi.fn(async () => []),
}));

let style;
beforeEach(() => {
  style = document.createElement('style');
  style.textContent = readFileSync(resolve(__dirname, '../styles.css'), 'utf8');
  document.head.append(style);
  getAdminDashboard.mockReset().mockResolvedValue(DASHBOARD);
  getAdminActions.mockResolvedValue([]);
});
afterEach(() => style.remove());

async function teamsTable() {
  render(<MemoryRouter><Admin /></MemoryRouter>);
  return screen.findByRole('table', { name: 'All teams' });
}
const css = (el) => getComputedStyle(el);

test('the column titles stick under the 60px top bar, above the scrolling cells', async () => {
  const table = await teamsTable();
  for (const th of within(table).getAllByRole('columnheader')) {
    expect(css(th).position).toBe('sticky');
    expect(css(th).top).toBe('60px');
    expect(css(th).zIndex).toBe('1');
  }
});

test('seats filled is a number, so its title and cells are right-aligned', async () => {
  const table = await teamsTable();
  expect(css(within(table).getByRole('columnheader', { name: 'Seats filled' })).textAlign).toBe('right');
  expect(css(within(table).getByText('1 of 4').closest('td')).textAlign).toBe('right');
});

test('members is the one column that wraps; the other cells stay on one line with an ellipsis', async () => {
  const table = await teamsTable();
  const row = within(table).getByRole('link', { name: 'Campus parking tracker' }).closest('tr');
  const [team, members, seats, status, next] = row.children;
  for (const cell of [team, seats, status, next]) {
    expect(css(cell).whiteSpace).toBe('nowrap');
    expect(css(cell).textOverflow).toBe('ellipsis');
  }
  expect(css(members).whiteSpace).not.toBe('nowrap');
});

// jsdom skips @media, so apply the phone-width block by hand: its rules
// unwrapped into a sheet after the main one, where the cascade puts them.
function atPhoneWidth() {
  const phone = [...style.sheet.cssRules].find((r) => r.media?.mediaText === '(max-width: 760px)');
  const sheet = document.createElement('style');
  sheet.textContent = [...phone.cssRules].map((r) => r.cssText).join('\n');
  document.head.append(sheet);
  return sheet;
}

test('at phone width each team is a card: the same table, its rows and cells restyled as blocks', async () => {
  const phone = atPhoneWidth();
  try {
    const table = await teamsTable();
    expect(css(table).display).toBe('block');
    const row = within(table).getByRole('link', { name: 'Campus parking tracker' }).closest('tr');
    expect(css(row).display).toBe('grid');
    const [team, members, seats, status, next] = row.children;
    for (const cell of [team, members, status]) expect(css(cell).display).toBe('block');
    // Bare values get their column title as a label beside them.
    for (const [cell, label] of [[seats, 'Seats filled'], [next, 'Next steps']]) {
      expect(css(cell).display).toBe('flex');
      expect(cell).toHaveAttribute('data-label', label);
    }
    // Column titles leave the layout but stay in the table for screen readers.
    const thead = table.querySelector('thead');
    expect(css(thead).position).toBe('absolute');
    expect(within(table).getByRole('columnheader', { name: 'Seats filled' })).toBeInTheDocument();
  } finally {
    phone.remove();
  }
});
