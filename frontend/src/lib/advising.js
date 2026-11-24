// Issue #60 — reading an adviser's capacity and expertise.
//
// Pure, and deliberately small: the rules themselves live in
// supabase/48_adviser_expertise.sql, which is the boundary. Everything here
// is about *saying* what the server already decided, in the two places that
// show it — the Profile card for your own settings, and the owner's search
// results in AdviserPanel.
//
// The one piece of judgement in this file is which expertise areas count as
// matching a project's open roles, and it does not make that judgement
// itself: roleFit() from the matching engine answers it. Writing a second
// comparison here is the #31 mistake — needsOneOfMySkills() and scoreFit()
// disagreed about the same question for weeks, and nobody could say which
// was right because both were.

import { ownedSkills, roleFit } from './matching/fit';

/**
 * How many more teams this adviser will take, or null when they have set no
 * limit. Display only — `is_full` below is the answer that matters, and the
 * server owns it.
 */
export function spotsLeft(adviser) {
  const max = adviser?.max_teams;
  if (max === null || max === undefined) return null;
  return Math.max(0, max - (Number(adviser?.advising) || 0));
}

/**
 * Whether this adviser can be asked at all.
 *
 * Read straight off the row rather than recomputed from max_teams and the
 * count. invite_adviser() and respond_to_adviser_request() refuse on their
 * own reading of it, so a second definition here is how a panel starts
 * offering an "Ask to advise" button that the server then refuses.
 */
export function isFull(adviser) {
  return Boolean(adviser?.is_full);
}

/**
 * "2 of 5 spots open", the phrase #60 asks for, or the two cases it doesn't
 * cover: no limit set, and full.
 *
 * A full adviser gets the count rather than the word "Full". The row says
 * Full in its own right, beside the name where it is actually visible, and
 * two elements carrying the same word is how a reader ends up looking for a
 * difference between them that isn't there.
 */
export function spotsLabel(adviser) {
  const left = spotsLeft(adviser);
  if (left === null) return isFull(adviser) ? 'Full' : 'No limit set';
  const max = adviser.max_teams;
  if (isFull(adviser)) {
    return `${Number(adviser.advising) || max} of ${max} team${max === 1 ? '' : 's'}`;
  }
  return `${left} of ${max} spot${max === 1 ? '' : 's'} open`;
}

/**
 * Which of this adviser's expertise areas match the project's open roles.
 *
 * Returns the areas themselves, each with the `basis` roleFit() used:
 * 'has-skill' for the role's own skill, 'same-category' for a neighbour. The
 * caller highlights them; the distinction is kept because "React, because you
 * need Vue" is a weaker claim than "React, because you need React" and the UI
 * should not present them as the same thing.
 *
 * A role listed without a skill pinned to it ("we need a project manager")
 * matches nothing, which is roleFit()'s answer, not a special case here.
 */
export function matchingExpertise(adviser, rolesNeeded = []) {
  const areas = adviser?.expertise || [];
  if (areas.length === 0 || rolesNeeded.length === 0) return [];

  const owned = ownedSkills({ skills: areas });
  const byId = new Map(areas.filter((a) => a?.id).map((a) => [a.id, a]));
  const hits = new Map();

  for (const role of rolesNeeded) {
    const { fit, basis, via } = roleFit(role, owned);
    if (fit <= 0) continue;
    const id = basis === 'has-skill' ? role.skill_id : via;
    const area = byId.get(id);
    if (!area) continue;
    // One area can match several roles. A direct hit on any of them is the
    // stronger claim, so it wins over a same-category hit on another.
    const seen = hits.get(id);
    if (!seen || (seen.basis !== 'has-skill' && basis === 'has-skill')) {
      hits.set(id, { ...area, basis });
    }
  }

  return [...hits.values()].sort(
    (a, b) =>
      (a.basis === 'has-skill' ? 0 : 1) - (b.basis === 'has-skill' ? 0 : 1) ||
      String(a.name || '').localeCompare(String(b.name || '')) ||
      String(a.id || '').localeCompare(String(b.id || ''))
  );
}

/**
 * The order #60 asks for: the people who can say yes, best fit first.
 *
 * search_advisers() already sorts full advisers last, and this sorts them
 * last again. That is on purpose — mock mode and the database have to agree
 * about what the panel shows, and the expertise half of the ordering can only
 * happen here, so doing the whole comparison in one place is what keeps the
 * two modes from disagreeing about the first row.
 */
export function orderAdvisers(advisers = [], rolesNeeded = []) {
  return [...advisers]
    .map((adviser) => ({ adviser, matches: matchingExpertise(adviser, rolesNeeded).length }))
    .sort(
      (a, b) =>
        Number(isFull(a.adviser)) - Number(isFull(b.adviser)) ||
        b.matches - a.matches ||
        String(a.adviser?.name || '').localeCompare(String(b.adviser?.name || '')) ||
        String(a.adviser?.id || '').localeCompare(String(b.adviser?.id || ''))
    )
    .map(({ adviser }) => adviser);
}
