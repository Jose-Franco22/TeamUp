// The matching engine, stage one: "the jury".
//
// A deterministic point system that scores ONE student against ONE project.
// No network, no model, no randomness — the same inputs always produce the
// same number, and every number here can be shown to a student as the reason
// they were ranked where they were.
//
// This is the student-side half of the engine. It is used two ways:
//   1. Browse (issue #31) ranks the project list by it.
//   2. The fit check before requesting to join shows it with a verdict.
// Both call scoreFit(); nothing else in the app knows how the maths works.
//
// Deliberately NOT here: anything that needs a server. The LLM review that
// reads a project description and tempers the verdict is stage two, and it
// lives in an Edge Function because it needs an API key. When it fails — no
// key, rate limit, bad JSON, timeout — this file's answer is what the student
// sees, so this file has to stand on its own.

// Tunable and deliberately visible: these are the argument the write-up has to
// defend. They sum to 1, so a raw score lands in 0..1 and scales to 0..100.
export const WEIGHTS = {
  primaryFit: 0.45, // the best single open role this student can fill
  scarcity: 0.15, // how badly that role is needed
  depth: 0.15, // months and projects behind the skill
  hoursFit: 0.15, // how close their weekly hours are to the team's
  extraCoverage: 0.1, // other open roles they could also cover
};

// A skill in the same category is worth a fraction of the real thing: someone
// who knows Vue can probably pick up React, but it is not the same claim.
export const ADJACENT_CATEGORY_FIT = 0.35;

// Hours apart at which the availability score bottoms out.
export const HOURS_SPREAD_FLOOR = 20;

// Used when either side's hours are unknown. Neutral on purpose: a missing
// number should neither reward nor punish, and a project with no members yet
// has no average to be close to.
export const NEUTRAL_HOURS_FIT = 0.5;

// Band boundaries, inclusive lower bounds. 69 is a partial fit, 70 is strong.
export const BAND_THRESHOLDS = { strong: 70, partial: 40 };

const ZERO_PARTS = {
  primaryFit: 0,
  scarcity: 0,
  depth: 0,
  hoursFit: 0,
  extraCoverage: 0,
};

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function bandFor(points) {
  if (points >= BAND_THRESHOLDS.strong) return 'strong';
  if (points >= BAND_THRESHOLDS.partial) return 'partial';
  return 'long-shot';
}

export const BAND_LABELS = {
  strong: 'Strong fit',
  partial: 'Partial fit',
  'long-shot': 'Long shot',
};

// How much to trust a claimed skill, from the evidence behind it. A bare tag
// is worth half — the student said so and that counts for something, but not
// for everything. Months of use and shipped projects raise it.
export function confidence(entry) {
  if (!entry) return 0;
  const { months = 0, projects = 0, source } = entry;
  let score = 0.5 + 0.3 * clamp01(months / 12) + 0.2 * clamp01(projects / 3);
  // A skill matched against a line in their resume is a little more than a
  // checkbox they ticked.
  if (source === 'resume') score += 0.05;
  return clamp01(score);
}

// How close two weekly-hours figures are. Either side missing is neutral, not
// zero: avg_availability_hours comes back 0 for a project with no seated
// members, which is an absence of information rather than a mismatch.
export function hoursCloseness(mine, theirs) {
  if (mine == null || theirs == null) return NEUTRAL_HOURS_FIT;
  const a = Number(mine);
  const b = Number(theirs);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return NEUTRAL_HOURS_FIT;
  return clamp01(1 - Math.abs(a - b) / HOURS_SPREAD_FLOOR);
}

// The student's skills keyed by skill id, with their evidence folded in.
//
// `student.skills` is what getCurrentUser() returns: { id, name, category,
// source }. `student.evidence` is optional and keyed by skill id —
// profile_evidence is own-rows-only, so a student always has access to their
// own months and projects even though nobody else does. Absent evidence is
// zeros, which confidence() reads as a bare tag.
export function ownedSkills(student) {
  const evidence = student?.evidence || {};
  const owned = {};
  for (const s of student?.skills || []) {
    if (!s?.id) continue;
    const e = evidence[s.id] || {};
    owned[s.id] = {
      skill_id: s.id,
      name: s.name ?? s.id,
      category: s.category ?? null,
      source: s.source ?? null,
      months: Number(e.months) || 0,
      projects: Number(e.projects) || 0,
    };
  }
  return owned;
}

// How well this student fits one open role.
//
// `skillById` is optional. Role entries from the API already carry the
// skill's category (see composeProject in api/client.js), so adjacency works
// without loading the whole ~500-row skills table; pass skillById when a
// caller has it and wants it to win.
export function roleFit(role, owned, skillById = {}) {
  // A role can be listed without pinning a skill to it — "we need a project
  // manager" — and the schema allows it on purpose. There is nothing to match
  // against, so it scores nothing rather than scoring badly.
  if (!role?.skill_id) return { fit: 0, basis: 'no-skill-listed' };

  const direct = owned[role.skill_id];
  if (direct) return { fit: confidence(direct), basis: 'has-skill' };

  const wanted = skillById[role.skill_id]?.category ?? role.category ?? null;
  if (!wanted) return { fit: 0, basis: 'none' };

  // Ties break on skill id so two runs never disagree about which adjacent
  // skill was used.
  const via = Object.keys(owned)
    .filter((id) => (owned[id].category ?? skillById[id]?.category ?? null) === wanted)
    .sort((a, b) => confidence(owned[b]) - confidence(owned[a]) || a.localeCompare(b))[0];

  if (via) {
    return { fit: ADJACENT_CATEGORY_FIT * confidence(owned[via]), basis: 'same-category', via };
  }
  return { fit: 0, basis: 'none' };
}

function orderByFit(scored) {
  // Fit first, then stable tie-breaks, so the "best" role for a student is
  // never decided by object key order.
  return [...scored].sort(
    (a, b) =>
      b.fit - a.fit ||
      String(a.role.skill_name || '').localeCompare(String(b.role.skill_name || '')) ||
      String(a.role.role_id || '').localeCompare(String(b.role.role_id || ''))
  );
}

function describeRole(role) {
  if (role.role_name && role.skill_name) return `${role.role_name} (${role.skill_name})`;
  return role.role_name || role.skill_name || 'an open role';
}

function evidenceNote(entry) {
  if (!entry) return '';
  const bits = [];
  if (entry.months > 0) bits.push(`${entry.months} month${entry.months === 1 ? '' : 's'}`);
  if (entry.projects > 0) bits.push(`${entry.projects} project${entry.projects === 1 ? '' : 's'}`);
  return bits.length ? ` — ${bits.join(', ')} behind it` : '';
}

/**
 * Score one student against one project.
 *
 * Returns a result object in every case, including the cases where there is
 * nothing to score. Callers read `status` first and only trust `points` and
 * `band` when it is 'ok' — that way "you have no skills listed" never renders
 * as a score of zero, which reads as a judgement rather than a prompt.
 *
 * status:
 *   'ok'              scored; points, band, parts and reasons are meaningful
 *   'no-skills'       the student has no skills listed — nothing to score with
 *   'no-open-roles'   the project pins no skills to its open roles
 */
export function scoreFit({ project, student, skillById = {} } = {}) {
  const roles = project?.roles_needed || [];
  const owned = ownedSkills(student);

  if (Object.keys(owned).length === 0) {
    return {
      status: 'no-skills',
      points: 0,
      band: null,
      parts: { ...ZERO_PARTS },
      primary: null,
      covered: [],
      uncovered: [],
      reasons: ['Add skills to your profile, or import your resume, to see how you fit.'],
    };
  }

  const skillRoles = roles.filter((r) => r?.skill_id);
  const unpinned = roles.filter((r) => r && !r.skill_id);

  if (skillRoles.length === 0) {
    return {
      status: 'no-open-roles',
      points: 0,
      band: null,
      parts: { ...ZERO_PARTS },
      primary: null,
      covered: [],
      uncovered: [],
      reasons: unpinned.length
        ? [
            `${unpinned
              .map(describeRole)
              .join(', ')} ${unpinned.length === 1 ? 'is' : 'are'} open with no specific skill listed, so there is nothing to score. Say why you fit when you ask to join.`,
          ]
        : ['This project has no open roles listed.'],
    };
  }

  const scored = skillRoles.map((role) => ({ role, ...roleFit(role, owned, skillById) }));
  const ordered = orderByFit(scored);
  const best = ordered[0];
  const covered = ordered.filter((s) => s.fit > 0);
  const uncovered = ordered.filter((s) => s.fit <= 0);

  // No role matches at all. Scored as a flat zero rather than letting the
  // availability and scarcity parts float it up to a double-digit number:
  // "you fit 15/100 of this" would be noise, and the student needs the
  // reason, not the decimal.
  if (best.fit <= 0) {
    const reasons = ['None of the roles still open match the skills on your profile.'];
    reasons.push(
      `Still open: ${skillRoles.map(describeRole).join(', ')}.`
    );
    if (unpinned.length) {
      reasons.push(
        `${unpinned.map(describeRole).join(', ')} ${unpinned.length === 1 ? 'is' : 'are'} open without a specific skill, which no score can speak to.`
      );
    }
    return {
      status: 'ok',
      points: 0,
      band: bandFor(0),
      parts: { ...ZERO_PARTS },
      primary: null,
      covered: [],
      uncovered,
      reasons,
    };
  }

  const primaryFit = best.fit;

  // Scarcity and extraCoverage describe the *project*, not the student, so
  // both are scaled by how strong the student's claim on the role actually
  // is. Without that scaling a one-role project handed out 25 points before
  // the student was considered at all, and someone with a merely related
  // skill on a single-role project (48) outranked an exact match on a
  // three-role project (43) — which is backwards.
  const claim = primaryFit;

  // The last uncovered role is worth more than one of three.
  const scarcity = clamp01(1 / skillRoles.length) * claim;

  // Evidence behind whichever skill earned the primary fit.
  const bestEntry = best.basis === 'has-skill' ? owned[best.role.skill_id] : owned[best.via];
  const depth = clamp01(
    0.6 * clamp01((bestEntry?.months || 0) / 12) + 0.4 * clamp01((bestEntry?.projects || 0) / 3)
  );

  const hoursFit = hoursCloseness(student?.availability_hours, project?.avg_availability_hours);

  // How much of the rest of the need this student also covers. With nothing
  // else open, covering the one role means covering all of it — otherwise a
  // perfect match on a single-role project could never reach 100.
  const others = skillRoles.length - 1;
  const extraCoverage = (others === 0 ? 1 : clamp01((covered.length - 1) / others)) * claim;

  const parts = { primaryFit, scarcity, depth, hoursFit, extraCoverage };
  const total =
    WEIGHTS.primaryFit * primaryFit +
    WEIGHTS.scarcity * scarcity +
    WEIGHTS.depth * depth +
    WEIGHTS.hoursFit * hoursFit +
    WEIGHTS.extraCoverage * extraCoverage;

  const points = Math.round(100 * clamp01(total));

  return {
    status: 'ok',
    points,
    band: bandFor(points),
    parts,
    primary: {
      role_id: best.role.role_id,
      role_name: best.role.role_name ?? null,
      skill_id: best.role.skill_id,
      skill_name: best.role.skill_name ?? null,
      basis: best.basis,
      via: best.via ?? null,
      via_name: best.via ? owned[best.via]?.name ?? null : null,
      fit: best.fit,
    },
    covered: covered.map((s) => s.role),
    uncovered: uncovered.map((s) => s.role),
    reasons: explain({ best, covered, uncovered, unpinned, owned, parts, project, student }),
  };
}

// Plain-language reasons, so a score never arrives without one. Every line
// names a role or a skill — no bare numbers.
function explain({ best, covered, uncovered, unpinned, owned, parts, project, student }) {
  const reasons = [];
  const entry = best.basis === 'has-skill' ? owned[best.role.skill_id] : owned[best.via];

  if (best.basis === 'has-skill') {
    reasons.push(`You cover ${describeRole(best.role)}${evidenceNote(entry)}.`);
  } else {
    reasons.push(
      `You could cover ${describeRole(best.role)} through ${entry?.name ?? 'a related skill'}, which is in the same area.`
    );
  }

  const extra = covered.filter((s) => s.role !== best.role);
  if (extra.length) {
    reasons.push(`You could also cover ${extra.map((s) => describeRole(s.role)).join(', ')}.`);
  }

  if (uncovered.length) {
    reasons.push(
      `${uncovered.length} open role${uncovered.length === 1 ? '' : 's'} you don't match: ${uncovered
        .map((s) => describeRole(s.role))
        .join(', ')}.`
    );
  }

  if (unpinned.length) {
    reasons.push(
      `${unpinned.map(describeRole).join(', ')} ${unpinned.length === 1 ? 'is' : 'are'} open with no specific skill listed.`
    );
  }

  // Only worth mentioning when it actually pulled the score down, and only
  // when both numbers are real.
  if (parts.hoursFit < NEUTRAL_HOURS_FIT && student?.availability_hours != null) {
    reasons.push(
      `The team averages ${project.avg_availability_hours} hrs/week and you listed ${student.availability_hours}.`
    );
  }

  return reasons;
}
