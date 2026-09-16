// Stage 1, the jury: a point system that scores a candidate team against a
// project. Deterministic and explainable — every number here can be shown to a
// student as the reason they were recommended.

// Tunable, and deliberately visible: these weights are the argument the
// write-up has to defend. They sum to 1, so a team score lands in 0..1.
export const WEIGHTS = {
  coverage: 0.5, // how much of the open roles the team actually fills
  depth: 0.2, // how well evidenced those skills are
  breadth: 0.15, // distinct needed skills covered, so not three of the same
  hours: 0.15, // whether the team can work at a similar pace
};

// A skill in the same category is worth a fraction of the real thing: a Vue
// developer can probably pick up React, but it is not the same claim.
export const ADJACENT_CATEGORY_FIT = 0.35;

// Hours apart at which the availability score bottoms out.
export const HOURS_SPREAD_FLOOR = 20;

const clamp01 = (n) => Math.min(1, Math.max(0, n));

// How much to trust a claimed skill, from the evidence behind it. A bare tag
// is worth half; months of use and shipped projects raise it.
export function confidence(entry) {
  if (!entry) return 0;
  const { months = 0, projects = 0, source } = entry;
  let score = 0.5 + 0.3 * clamp01(months / 12) + 0.2 * clamp01(projects / 3);
  if (source === 'resume') score += 0.05; // confirmed against a line in their resume
  return clamp01(score);
}

// How well one student fits one open slot.
export function roleFit(student, slot, skillById) {
  const owned = student.skills[slot.skill_id];
  if (owned) return { fit: confidence(owned), basis: 'has-skill' };

  const wanted = skillById[slot.skill_id]?.category;
  const adjacent = Object.keys(student.skills)
    .filter((id) => skillById[id]?.category === wanted)
    .sort(
      (a, b) => confidence(student.skills[b]) - confidence(student.skills[a]) || a.localeCompare(b),
    )[0];

  if (adjacent) {
    return {
      fit: ADJACENT_CATEGORY_FIT * confidence(student.skills[adjacent]),
      basis: 'same-category',
      via: adjacent,
    };
  }
  return { fit: 0, basis: 'none' };
}

// Assign candidates to slots, best fit first, one slot each. Greedy is fine at
// this size, and swapping in the Hungarian algorithm later changes nothing else.
export function assignToSlots(candidates, slots, skillById) {
  const pairs = [];
  for (const student of candidates) {
    slots.forEach((slot, index) => {
      const { fit, basis, via } = roleFit(student, slot, skillById);
      if (fit > 0) pairs.push({ student, slot, index, fit, basis, via });
    });
  }
  pairs.sort(
    (a, b) => b.fit - a.fit || a.student.id.localeCompare(b.student.id) || a.index - b.index,
  );

  const usedStudents = new Set();
  const usedSlots = new Set();
  const assignments = [];
  for (const pair of pairs) {
    if (usedStudents.has(pair.student.id) || usedSlots.has(pair.index)) continue;
    usedStudents.add(pair.student.id);
    usedSlots.add(pair.index);
    assignments.push(pair);
  }
  return assignments;
}

// Score a whole candidate team. `seats` is how many people the project can
// still take, which caps how many slots any team could fill.
export function scoreTeam({ project, candidates, slots, skillById, seats }) {
  const assignments = assignToSlots(candidates, slots, skillById);
  const fillable = Math.max(1, Math.min(slots.length, seats));
  const totalFit = assignments.reduce((sum, a) => sum + a.fit, 0);

  const coverage = clamp01(totalFit / fillable);
  const depth = assignments.length ? totalFit / assignments.length : 0;

  const neededSkills = new Set(slots.map((s) => s.skill_id));
  const covered = new Set(
    assignments.filter((a) => a.basis === 'has-skill').map((a) => a.slot.skill_id),
  );
  const breadth = neededSkills.size
    ? clamp01(covered.size / Math.min(neededSkills.size, seats))
    : 1;

  const hoursList = [...project.members, ...candidates].map((m) => m.availability_hours);
  const spread = hoursList.length ? Math.max(...hoursList) - Math.min(...hoursList) : 0;
  const hours = clamp01(1 - spread / HOURS_SPREAD_FLOOR);

  const parts = { coverage, depth, breadth, hours };
  const total =
    WEIGHTS.coverage * coverage +
    WEIGHTS.depth * depth +
    WEIGHTS.breadth * breadth +
    WEIGHTS.hours * hours;

  return {
    total,
    points: Math.round(total * 1000), // friendlier to show than 0.7314
    parts,
    assignments,
    unfilledSlots: Math.max(0, fillable - assignments.length),
  };
}

// Plain-language reasons, so a recommendation never arrives without one.
export function explain(score, skillById) {
  const reasons = score.assignments.map((a) => {
    const skill = skillById[a.slot.skill_id].name;
    const months = a.student.skills[a.slot.skill_id]?.months ?? 0;
    if (a.basis === 'has-skill') {
      return `${a.student.name} covers ${skill}${months ? ` (${months} months)` : ''}`;
    }
    return `${a.student.name} could cover ${skill} via ${skillById[a.via].name}`;
  });
  if (score.unfilledSlots > 0) {
    const plural = score.unfilledSlots === 1 ? '' : 's';
    reasons.push(`${score.unfilledSlots} role${plural} still uncovered`);
  }
  return reasons;
}
