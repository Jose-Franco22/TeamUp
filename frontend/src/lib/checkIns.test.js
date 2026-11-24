// Issue #55: the week arithmetic, the check-in form's rules, and grouping.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  CHECK_IN_MAX,
  addWeeks,
  formatWeek,
  groupCheckIns,
  hasBlocker,
  validateCheckIn,
  weekStart,
} from './checkIns';

describe('weekStart() — the Monday of the Central-time week', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // Each case sets the clock and calls weekStart() with no argument, the way
  // the app does.
  const at = (iso) => {
    vi.setSystemTime(new Date(iso));
    return weekStart();
  };

  test('a Wednesday afternoon belongs to that Monday', () => {
    expect(at('2026-11-18T18:00:00Z')).toBe('2026-11-16');
  });

  test('Monday at midnight Central starts a new week', () => {
    expect(at('2026-11-23T06:00:00Z')).toBe('2026-11-23'); // 12:00 AM CST
  });

  test('Sunday 11:59 PM Central is still the old week, though it is already Monday in UTC', () => {
    expect(at('2026-11-23T05:59:00Z')).toBe('2026-11-16');
  });

  test('Monday morning in UTC can still be Sunday in Central', () => {
    expect(at('2026-11-16T03:00:00Z')).toBe('2026-11-09'); // Sun 9 PM CST
  });

  describe('around daylight saving', () => {
    // Clocks fall back at 2 AM CDT on Sunday, November 1, 2026.
    test('the repeated hour on the Sunday clocks fall back stays in the old week', () => {
      expect(at('2026-11-01T06:30:00Z')).toBe('2026-10-26'); // 1:30 AM CDT
      expect(at('2026-11-01T07:30:00Z')).toBe('2026-10-26'); // 1:30 AM CST, again
    });

    test('the week turns over at midnight CST, not CDT, the night after falling back', () => {
      // 11:30 PM CST Sunday — would be 12:30 AM Monday on CDT's offset.
      expect(at('2026-11-02T05:30:00Z')).toBe('2026-10-26');
      expect(at('2026-11-02T06:00:00Z')).toBe('2026-11-02');
    });

    // Clocks spring forward at 2 AM CST on Sunday, March 14, 2027.
    test('the week turns over at midnight CDT, not CST, the night after springing forward', () => {
      // 11:30 PM CDT Sunday — would still be Sunday on CST's offset too, so
      // check the hour after it, which only CDT calls Monday.
      expect(at('2027-03-15T04:30:00Z')).toBe('2027-03-08');
      expect(at('2027-03-15T05:00:00Z')).toBe('2027-03-15'); // 12:00 AM CDT; CST would say Sun 11 PM
    });

    test('the skipped hour on the Sunday clocks spring forward stays in the old week', () => {
      expect(at('2027-03-14T08:30:00Z')).toBe('2027-03-08'); // 3:30 AM CDT
    });
  });

  test('works across a year boundary', () => {
    expect(at('2027-01-01T18:00:00Z')).toBe('2026-12-28'); // a Friday
  });

  test('takes an explicit moment too', () => {
    expect(weekStart('2026-11-21T12:00:00Z')).toBe('2026-11-16');
  });
});

describe('addWeeks() and formatWeek()', () => {
  test('steps whole weeks either way', () => {
    expect(addWeeks('2026-11-16', -1)).toBe('2026-11-09');
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
  });

  test('labels a week by its Monday and Sunday', () => {
    expect(formatWeek('2026-11-16')).toBe('Nov 16 – 22');
    expect(formatWeek('2026-10-26')).toBe('Oct 26 – Nov 1');
  });
});

describe('validateCheckIn()', () => {
  const ok = { did: 'Built the login page', doing_next: 'Hook it up to the API', blockers: '' };

  test('the first two fields are required', () => {
    const { errors, isValid } = validateCheckIn({ did: '   ', doing_next: '', blockers: 'x' });
    expect(isValid).toBe(false);
    expect(errors).toEqual({
      did: 'Say what you worked on this week',
      doing_next: "Say what you're doing next",
    });
  });

  test('blockers are optional, and blank means none', () => {
    const { values, isValid } = validateCheckIn(ok);
    expect(isValid).toBe(true);
    expect(values).toEqual({ did: 'Built the login page', doing_next: 'Hook it up to the API', blockers: null });
  });

  test(`each field is at most ${CHECK_IN_MAX} characters, after trimming`, () => {
    const max = 'a'.repeat(CHECK_IN_MAX);
    expect(validateCheckIn({ did: `  ${max}  `, doing_next: max, blockers: max }).isValid).toBe(true);

    const { errors } = validateCheckIn({ did: `${max}a`, doing_next: `${max}a`, blockers: `${max}a` });
    expect(errors).toEqual({
      did: `Keep it to ${CHECK_IN_MAX} characters or fewer`,
      doing_next: `Keep it to ${CHECK_IN_MAX} characters or fewer`,
      blockers: `Keep it to ${CHECK_IN_MAX} characters or fewer`,
    });
  });

  test('counts characters the way Postgres does, so an emoji is one', () => {
    expect(validateCheckIn({ ...ok, did: '🚀'.repeat(CHECK_IN_MAX) }).isValid).toBe(true);
  });
});

describe('groupCheckIns()', () => {
  const members = [
    { user_id: 'u-a', name: 'Ana' },
    { user_id: 'u-b', name: 'Ben' },
    { user_id: 'u-c', name: 'Cy' },
  ];
  const ci = (id, user_id, user_name, week_start, blockers = null) => ({
    id, user_id, user_name, week_start, did: 'did', doing_next: 'next', blockers,
  });

  test('groups by week, newest first, with who has not checked in', () => {
    const groups = groupCheckIns(
      [ci('1', 'u-b', 'Ben', '2026-11-09'), ci('2', 'u-a', 'Ana', '2026-11-16'), ci('3', 'u-b', 'Ben', '2026-11-16')],
      members,
      { currentWeek: '2026-11-16', formedAt: '2026-11-04T12:00:00Z' }
    );
    expect(groups.map((g) => g.week)).toEqual(['2026-11-16', '2026-11-09', '2026-11-02']);
    expect(groups[0].checkIns.map((c) => c.user_name)).toEqual(['Ana', 'Ben']);
    expect(groups[0].missing.map((m) => m.name)).toEqual(['Cy']);
    expect(groups[1].missing.map((m) => m.name)).toEqual(['Ana', 'Cy']);
    // The week the team formed, when nobody checked in: everyone is missing.
    expect(groups[2]).toEqual({ week: '2026-11-02', checkIns: [], missing: members });
  });

  test('this week shows even before anyone posts', () => {
    const groups = groupCheckIns([], members, { currentWeek: '2026-11-16', formedAt: '2026-11-17T00:00:00Z' });
    expect(groups).toEqual([{ week: '2026-11-16', checkIns: [], missing: members }]);
  });

  test('weeks from before the team formed list nobody as missing', () => {
    const groups = groupCheckIns([ci('1', 'u-a', 'Ana', '2026-11-02')], members, {
      currentWeek: '2026-11-16',
      formedAt: '2026-11-16T15:00:00Z',
    });
    expect(groups.map((g) => g.week)).toEqual(['2026-11-16', '2026-11-02']);
    expect(groups[1].missing).toEqual([]);
  });

  // A replacement who took a seat mid-term: missing from the week they joined
  // on, but not for the weeks before, when they weren't on the team.
  test('a member is not missing for weeks before they joined', () => {
    const roster = [
      { user_id: 'u-a', name: 'Ana', joined_at: '2026-10-20T15:00:00Z' },
      { user_id: 'u-d', name: 'Dee', joined_at: '2026-11-11T15:00:00Z' }, // Wed of the 11-09 week
    ];
    const groups = groupCheckIns([], roster, { currentWeek: '2026-11-16', formedAt: '2026-10-28T12:00:00Z' });
    const missing = Object.fromEntries(groups.map((g) => [g.week, g.missing.map((m) => m.name)]));
    expect(missing).toEqual({
      '2026-11-16': ['Ana', 'Dee'],
      '2026-11-09': ['Ana', 'Dee'], // the week they joined still counts
      '2026-11-02': ['Ana'],
      '2026-10-26': ['Ana'],
    });
  });

  // Central time, like weekStart(): 00:30 Monday UTC is still Sunday evening
  // in Chicago, so that join belongs to the week before.
  test('the join week is the Central-time week', () => {
    const roster = [{ user_id: 'u-d', name: 'Dee', joined_at: '2026-11-16T00:30:00Z' }];
    const groups = groupCheckIns([], roster, { currentWeek: '2026-11-16', formedAt: '2026-11-02T12:00:00Z' });
    expect(groups.find((g) => g.week === '2026-11-09').missing.map((m) => m.name)).toEqual(['Dee']);
    expect(groups.find((g) => g.week === '2026-11-02').missing).toEqual([]);
  });

  test('hasBlocker() is true only for a non-blank blocker', () => {
    expect(hasBlocker(ci('1', 'u-a', 'Ana', '2026-11-16', 'Waiting on access'))).toBe(true);
    expect(hasBlocker(ci('1', 'u-a', 'Ana', '2026-11-16', null))).toBe(false);
    expect(hasBlocker(ci('1', 'u-a', 'Ana', '2026-11-16', '  '))).toBe(false);
  });
});
