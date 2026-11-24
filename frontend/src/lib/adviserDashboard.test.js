// Issue #56 — which advised teams need attention, and the order of the cards.
import { describe, expect, test } from 'vitest';
import { attentionReasons, daysSince, needsAttention, sortAdvisedTeams } from './adviserDashboard';

const NOW = new Date('2026-11-23T18:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();
const daysAhead = (n) => daysAgo(-n);

// Formed a month ago, checked in yesterday, nothing overdue or sent back.
const healthy = (overrides = {}) => ({
  project_id: 'p-healthy',
  title: 'Healthy team',
  formed_at: daysAgo(30),
  check_ins_submitted: 2,
  check_ins_expected: 2,
  open_blockers: 0,
  last_check_in_at: daysAgo(1),
  next_milestone_due_at: daysAhead(5),
  overdue_deliverables: 0,
  changes_requested: 0,
  ...overrides,
});

describe('needsAttention', () => {
  test('is false for a healthy team', () => {
    expect(needsAttention(healthy(), NOW)).toBe(false);
    expect(attentionReasons(healthy(), NOW)).toEqual([]);
  });

  test.each([
    ['an overdue deliverable', { overdue_deliverables: 1 }, 'overdue'],
    ['a deliverable sent back with changes requested', { changes_requested: 1 }, 'changes_requested'],
    ['an open blocker', { open_blockers: 2 }, 'blocker'],
    ['no check-in in the past week', { last_check_in_at: daysAgo(8) }, 'quiet'],
    ['no check-in at all, a month after forming', { last_check_in_at: null }, 'quiet'],
  ])('is true for %s', (_, overrides, reason) => {
    expect(needsAttention(healthy(overrides), NOW)).toBe(true);
    expect(attentionReasons(healthy(overrides), NOW)).toEqual([reason]);
  });

  test('lists every reason that applies, in a fixed order', () => {
    const team = healthy({ open_blockers: 1, overdue_deliverables: 1, last_check_in_at: null, changes_requested: 3 });
    expect(attentionReasons(team, NOW)).toEqual(['overdue', 'changes_requested', 'blocker', 'quiet']);
  });

  test('exactly seven days of silence counts as a quiet week', () => {
    expect(needsAttention(healthy({ last_check_in_at: daysAgo(7) }), NOW)).toBe(true);
    expect(needsAttention(healthy({ last_check_in_at: daysAgo(6.9) }), NOW)).toBe(false);
  });

  // Check-ins open when the team forms, so silence before then isn't a sign
  // of anything.
  test('a team still forming is not flagged for having no check-ins', () => {
    expect(needsAttention(healthy({ formed_at: null, last_check_in_at: null }), NOW)).toBe(false);
  });

  test('nor is one that formed less than a week ago', () => {
    expect(needsAttention(healthy({ formed_at: daysAgo(3), last_check_in_at: null }), NOW)).toBe(false);
  });

  test('but a forming team with an overdue deliverable still is', () => {
    expect(needsAttention(healthy({ formed_at: null, overdue_deliverables: 1 }), NOW)).toBe(true);
  });
});

describe('sortAdvisedTeams', () => {
  test('puts flagged teams first, then sorts by next due date', () => {
    const teams = [
      healthy({ title: 'Healthy, due in 9', next_milestone_due_at: daysAhead(9) }),
      healthy({ title: 'Flagged, due in 20', next_milestone_due_at: daysAhead(20), open_blockers: 1 }),
      healthy({ title: 'Healthy, due in 2', next_milestone_due_at: daysAhead(2) }),
      healthy({ title: 'Flagged, due in 4', next_milestone_due_at: daysAhead(4), overdue_deliverables: 1 }),
    ];

    expect(sortAdvisedTeams(teams, NOW).map((t) => t.title)).toEqual([
      'Flagged, due in 4',
      'Flagged, due in 20',
      'Healthy, due in 2',
      'Healthy, due in 9',
    ]);
  });

  test('a team with nothing coming up goes after the ones with a due date', () => {
    const teams = [
      healthy({ title: 'Nothing due', next_milestone_due_at: null }),
      healthy({ title: 'Due soon', next_milestone_due_at: daysAhead(1) }),
    ];
    expect(sortAdvisedTeams(teams, NOW).map((t) => t.title)).toEqual(['Due soon', 'Nothing due']);
  });

  test('ties are broken by name, so the order is stable', () => {
    const teams = [
      healthy({ title: 'Zeta', next_milestone_due_at: null }),
      healthy({ title: 'Alpha', next_milestone_due_at: null }),
    ];
    expect(sortAdvisedTeams(teams, NOW).map((t) => t.title)).toEqual(['Alpha', 'Zeta']);
  });

  test('does not reorder the array it was given', () => {
    const teams = [healthy({ title: 'B' }), healthy({ title: 'A', open_blockers: 1 })];
    sortAdvisedTeams(teams, NOW);
    expect(teams.map((t) => t.title)).toEqual(['B', 'A']);
  });
});

describe('daysSince', () => {
  test('counts whole days, and null for no date', () => {
    expect(daysSince(daysAgo(3.5), NOW)).toBe(3);
    expect(daysSince(NOW.toISOString(), NOW)).toBe(0);
    expect(daysSince(null, NOW)).toBeNull();
  });
});
