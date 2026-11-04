// Issue #22 — the banner's countdown and which deadline it counts down to.
// relativeDue() (the Announcements schedule, #38) moved here from
// Announcements.jsx so the two date formatters sit side by side.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { formatCountdown, isDueSoon, relativeDue } from './deadlines';

const NOW = new Date('2026-10-21T12:00:00Z');
const later = (ms) => new Date(NOW.getTime() + ms).toISOString();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe('formatCountdown()', () => {
  test('whole days once a day or more is left', () => {
    expect(formatCountdown(later(4 * DAY))).toBe('4 days');
    expect(formatCountdown(later(4 * DAY + 23 * HOUR))).toBe('4 days');
    expect(formatCountdown(later(DAY))).toBe('1 day');
    expect(formatCountdown(later(47 * HOUR))).toBe('1 day');
  });

  test('hours inside the last day', () => {
    expect(formatCountdown(later(5 * HOUR))).toBe('5 hours');
    expect(formatCountdown(later(5 * HOUR + 59 * 60 * 1000))).toBe('5 hours');
    expect(formatCountdown(later(DAY - 1))).toBe('23 hours');
    expect(formatCountdown(later(HOUR))).toBe('1 hour');
    expect(formatCountdown(later(20 * 60 * 1000))).toBe('less than an hour');
  });

  test('"Closed" once the deadline has passed, including the moment it passes', () => {
    expect(formatCountdown(later(0))).toBe('Closed');
    expect(formatCountdown(later(-1))).toBe('Closed');
    expect(formatCountdown('2020-01-01T00:00:00Z')).toBe('Closed');
  });
});

test('isDueSoon() is true from 48 hours out until the deadline passes', () => {
  expect(isDueSoon(later(48 * HOUR + 1))).toBe(false);
  expect(isDueSoon(later(48 * HOUR))).toBe(true);
  expect(isDueSoon(later(HOUR))).toBe(true);
  expect(isDueSoon(later(0))).toBe(false);
});

test('relative dates read naturally', () => {
  const now = new Date('2026-10-21T12:00:00');
  expect(relativeDue('2026-10-21T23:00:00', now)).toBe('today');
  expect(relativeDue('2026-10-22T08:00:00', now)).toBe('tomorrow');
  expect(relativeDue('2026-10-20T08:00:00', now)).toBe('yesterday');
  expect(relativeDue('2026-10-26T08:00:00', now)).toBe('in 5 days');
  expect(relativeDue('2026-10-11T08:00:00', now)).toBe('10 days ago');
  expect(relativeDue('2026-11-11T08:00:00', now)).toBe('in 3 weeks');
  expect(relativeDue('2027-02-21T08:00:00', now)).toBe('in 4 months');
  expect(relativeDue('2026-08-01T08:00:00', now)).toBe('3 months ago');
  expect(relativeDue('2027-11-01T08:00:00', now)).toBe('in 1 year');
  expect(relativeDue('2031-10-21T08:00:00', now)).toBe('in 5 years');
});
