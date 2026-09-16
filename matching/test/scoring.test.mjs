import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ADJACENT_CATEGORY_FIT,
  assignToSlots,
  confidence,
  roleFit,
  scoreTeam,
} from '../src/scoring.mjs';

const skillById = {
  's-react': { id: 's-react', name: 'React', category: 'Frontend' },
  's-figma': { id: 's-figma', name: 'Figma', category: 'Frontend' },
  's-pg': { id: 's-pg', name: 'PostgreSQL', category: 'Backend' },
};

const student = (id, skills, hours = 12) => ({
  id,
  name: id,
  availability_hours: hours,
  skills,
  onTeam: false,
});

const bare = { source: 'manual', months: 0, projects: 0 };
const proven = { source: 'resume', months: 24, projects: 3 };

test('a claimed skill with no evidence is worth half', () => {
  assert.equal(confidence(bare), 0.5);
  assert.equal(confidence(undefined), 0);
});

test('evidence raises confidence, and it never exceeds 1', () => {
  assert.ok(confidence({ source: 'manual', months: 12, projects: 0 }) > confidence(bare));
  assert.ok(confidence({ source: 'manual', months: 6, projects: 3 }) > confidence(bare));
  assert.equal(confidence(proven), 1);
  assert.equal(confidence({ source: 'resume', months: 999, projects: 99 }), 1);
});

test('the same evidence is worth more when it came from a resume', () => {
  const typed = { source: 'manual', months: 6, projects: 1 };
  assert.ok(confidence({ ...typed, source: 'resume' }) > confidence(typed));
});

test('having the skill beats a neighbouring skill, which beats nothing', () => {
  const slot = { skill_id: 's-react' };
  const has = roleFit(student('a', { 's-react': bare }), slot, skillById);
  const near = roleFit(student('b', { 's-figma': bare }), slot, skillById);
  const none = roleFit(student('c', { 's-pg': bare }), slot, skillById);

  assert.equal(has.basis, 'has-skill');
  assert.equal(near.basis, 'same-category');
  assert.equal(near.via, 's-figma');
  assert.equal(none.fit, 0);
  assert.ok(has.fit > near.fit && near.fit > none.fit);
  assert.equal(near.fit, ADJACENT_CATEGORY_FIT * confidence(bare));
});

test('one student cannot fill two slots', () => {
  const slots = [{ skill_id: 's-react' }, { skill_id: 's-react' }];
  const assignments = assignToSlots([student('a', { 's-react': proven })], slots, skillById);
  assert.equal(assignments.length, 1);
});

test('covering both open roles scores higher than covering one twice', () => {
  const project = { members: [], roles: [] };
  const slots = [
    { skill_id: 's-react', skill_name: 'React' },
    { skill_id: 's-pg', skill_name: 'PostgreSQL' },
  ];
  const shared = { project, slots, skillById, seats: 2 };

  const complete = scoreTeam({
    ...shared,
    candidates: [student('a', { 's-react': proven }), student('b', { 's-pg': proven })],
  });
  const duplicated = scoreTeam({
    ...shared,
    candidates: [student('a', { 's-react': proven }), student('b', { 's-react': proven })],
  });

  assert.ok(complete.points > duplicated.points);
  assert.equal(complete.unfilledSlots, 0);
  assert.equal(duplicated.unfilledSlots, 1);
  assert.ok(duplicated.parts.breadth < complete.parts.breadth);
});

test('teams that can meet at a similar pace score higher', () => {
  const project = { members: [], roles: [] };
  const slots = [
    { skill_id: 's-react', skill_name: 'React' },
    { skill_id: 's-pg', skill_name: 'PostgreSQL' },
  ];
  const shared = { project, slots, skillById, seats: 2 };

  const matched = scoreTeam({
    ...shared,
    candidates: [
      student('a', { 's-react': proven }, 12),
      student('b', { 's-pg': proven }, 14),
    ],
  });
  const lopsided = scoreTeam({
    ...shared,
    candidates: [
      student('a', { 's-react': proven }, 2),
      student('b', { 's-pg': proven }, 30),
    ],
  });

  assert.ok(matched.parts.hours > lopsided.parts.hours);
  assert.ok(matched.points > lopsided.points);
});

test('points stay inside 0..1000', () => {
  const project = { members: [], roles: [] };
  const slots = [{ skill_id: 's-react', skill_name: 'React' }];
  const empty = scoreTeam({ project, candidates: [], slots, skillById, seats: 1 });
  const full = scoreTeam({
    project,
    candidates: [student('a', { 's-react': proven })],
    slots,
    skillById,
    seats: 1,
  });
  assert.ok(empty.points >= 0 && full.points <= 1000);
  assert.ok(full.points > empty.points);
});
