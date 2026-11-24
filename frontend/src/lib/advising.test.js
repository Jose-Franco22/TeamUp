// Issue #60 — reading an adviser's capacity and expertise.
//
// Two of these matter more than the rest.
//
// `isFull` reads the server's flag instead of recomputing it from max_teams
// and the count, and there is a test that holds it to that: given a row where
// the two disagree, the flag wins. That is not a preference. invite_adviser()
// and respond_to_adviser_request() refuse on their own reading, so a second
// definition here would eventually offer an "Ask to advise" button the server
// then refuses — and the panel would look broken rather than wrong.
//
// `matchingExpertise` is the matching engine's answer, not this file's. The
// same-category case is the one worth seeing proved: an adviser who lists
// React is a plausible answer to a project that needs Vue, and roleFit()
// already says so with `basis: 'same-category'`. #31 is why that comparison
// is not written twice.
import { describe, expect, test } from 'vitest';
import { isFull, matchingExpertise, orderAdvisers, spotsLabel, spotsLeft } from './advising';

const REACT = { id: 's-react', name: 'React', category: 'Frontend' };
const VUE = { id: 's-vue', name: 'Vue', category: 'Frontend' };
const PYTHON = { id: 's-python', name: 'Python', category: 'Data' };
const GIT = { id: 's-git', name: 'Git', category: 'Tools' };

// What search_advisers() returns, with only the fields each test needs.
const adviser = (over = {}) => ({
  id: 'u-a',
  name: 'Ada Adviser',
  email: 'ada@utrgv.edu',
  max_teams: null,
  advising: 0,
  is_full: false,
  expertise: [],
  ...over,
});

const role = (skill, over = {}) => ({
  role_id: `r-${skill?.id ?? 'none'}`,
  role_name: 'Developer',
  skill_id: skill?.id ?? null,
  skill_name: skill?.name ?? null,
  category: skill?.category ?? null,
  quantity_needed: 1,
  ...over,
});

describe('spotsLeft', () => {
  test('is null when no maximum has been set, which is not the same as zero', () => {
    expect(spotsLeft(adviser())).toBe(null);
  });

  test('counts down from the maximum', () => {
    expect(spotsLeft(adviser({ max_teams: 5, advising: 2 }))).toBe(3);
  });

  test('never goes negative, because lowering the maximum below the teams already held is allowed', () => {
    expect(spotsLeft(adviser({ max_teams: 1, advising: 3 }))).toBe(0);
  });

  test('a missing count reads as none advised rather than NaN', () => {
    expect(spotsLeft({ max_teams: 4 })).toBe(4);
  });
});

describe('isFull', () => {
  test('is the server’s answer', () => {
    expect(isFull(adviser({ is_full: true }))).toBe(true);
    expect(isFull(adviser({ is_full: false }))).toBe(false);
  });

  // The assertion that keeps the definition in one place. If this ever gets
  // "fixed" to recompute, the panel and the database can disagree, and the
  // database is the one that refuses the invitation.
  test('is not recomputed: the flag wins even when the numbers would say otherwise', () => {
    expect(isFull(adviser({ is_full: false, max_teams: 1, advising: 9 }))).toBe(false);
    expect(isFull(adviser({ is_full: true, max_teams: 9, advising: 0 }))).toBe(true);
  });

  test('a row without the flag is not full', () => {
    expect(isFull({})).toBe(false);
    expect(isFull(undefined)).toBe(false);
  });
});

describe('spotsLabel', () => {
  test('is the phrase the issue asks for', () => {
    expect(spotsLabel(adviser({ max_teams: 5, advising: 3 }))).toBe('2 of 5 spots open');
  });

  // The word "Full" belongs beside the name, where it is visible. This line
  // carries the numbers instead, so the two are not the same word twice.
  test('gives a full adviser the count, since the row says Full on its own', () => {
    expect(spotsLabel(adviser({ is_full: true, max_teams: 2, advising: 2 }))).toBe('2 of 2 teams');
  });

  test('and falls back to the word when there is no count to give', () => {
    expect(spotsLabel(adviser({ is_full: true }))).toBe('Full');
  });

  test('one team is a team, not teams — the singular shows up on the commonest cap there is', () => {
    expect(spotsLabel(adviser({ is_full: true, max_teams: 1, advising: 1 }))).toBe('1 of 1 team');
  });

  test('says so when no limit has been set', () => {
    expect(spotsLabel(adviser())).toBe('No limit set');
  });

  test('a maximum of one is one spot, not one spots', () => {
    expect(spotsLabel(adviser({ max_teams: 1 }))).toBe('1 of 1 spot open');
  });
});

describe('matchingExpertise', () => {
  test('is empty when there is nothing on either side', () => {
    expect(matchingExpertise(adviser({ expertise: [REACT] }), [])).toEqual([]);
    expect(matchingExpertise(adviser(), [role(REACT)])).toEqual([]);
  });

  test('matches the role’s own skill', () => {
    const found = matchingExpertise(adviser({ expertise: [REACT, PYTHON] }), [role(REACT)]);
    expect(found.map((a) => a.id)).toEqual(['s-react']);
    expect(found[0].basis).toBe('has-skill');
  });

  test('matches a neighbour in the same category, and says that is what it did', () => {
    const found = matchingExpertise(adviser({ expertise: [REACT] }), [role(VUE)]);
    expect(found.map((a) => a.id)).toEqual(['s-react']);
    expect(found[0].basis).toBe('same-category');
  });

  test('a role with no skill pinned to it matches nothing', () => {
    expect(matchingExpertise(adviser({ expertise: [REACT] }), [role(null)])).toEqual([]);
  });

  test('a role in a category the adviser has nothing in matches nothing', () => {
    expect(matchingExpertise(adviser({ expertise: [PYTHON] }), [role(REACT)])).toEqual([]);
  });

  test('one area matching two roles counts once, as the stronger of the two claims', () => {
    const found = matchingExpertise(adviser({ expertise: [REACT] }), [role(VUE), role(REACT)]);
    expect(found).toHaveLength(1);
    expect(found[0].basis).toBe('has-skill');
  });

  test('direct matches come before same-category ones, then by name', () => {
    const found = matchingExpertise(
      adviser({ expertise: [REACT, PYTHON, GIT] }),
      [role(VUE), role(PYTHON), role(GIT)]
    );
    expect(found.map((a) => a.id)).toEqual(['s-git', 's-python', 's-react']);
    expect(found.map((a) => a.basis)).toEqual(['has-skill', 'has-skill', 'same-category']);
  });

  test('carries the area through, so the caller can highlight by id', () => {
    const [found] = matchingExpertise(adviser({ expertise: [REACT] }), [role(REACT)]);
    expect(found).toMatchObject({ id: 's-react', name: 'React', category: 'Frontend' });
  });
});

describe('orderAdvisers', () => {
  const ada = adviser({ id: 'u-ada', name: 'Ada Adviser' });
  const zoe = adviser({ id: 'u-zoe', name: 'Zoe Zepeda' });

  test('puts an adviser with room before one who is full, whatever the names say', () => {
    const ordered = orderAdvisers([{ ...ada, is_full: true }, zoe], []);
    expect(ordered.map((a) => a.id)).toEqual(['u-zoe', 'u-ada']);
  });

  test('then the better fit first', () => {
    const ordered = orderAdvisers(
      [ada, { ...zoe, expertise: [REACT, PYTHON] }],
      [role(REACT), role(PYTHON)]
    );
    expect(ordered.map((a) => a.id)).toEqual(['u-zoe', 'u-ada']);
  });

  // Being full outranks fitting well: a perfect match who cannot be asked is
  // not a useful first row.
  test('fit does not promote a full adviser above an available one', () => {
    const ordered = orderAdvisers(
      [{ ...ada, is_full: true, expertise: [REACT, PYTHON] }, zoe],
      [role(REACT), role(PYTHON)]
    );
    expect(ordered.map((a) => a.id)).toEqual(['u-zoe', 'u-ada']);
  });

  test('then by name, so two equal candidates never swap between renders', () => {
    expect(orderAdvisers([zoe, ada], []).map((a) => a.id)).toEqual(['u-ada', 'u-zoe']);
  });

  test('leaves the array it was given alone', () => {
    const input = [zoe, ada];
    orderAdvisers(input, []);
    expect(input.map((a) => a.id)).toEqual(['u-zoe', 'u-ada']);
  });

  test('handles nothing at all', () => {
    expect(orderAdvisers()).toEqual([]);
    expect(orderAdvisers([], [role(REACT)])).toEqual([]);
  });
});
