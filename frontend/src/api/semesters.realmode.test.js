// Issue #61 — the semester calls in REAL mode, against a fake Supabase.
//
// Mock mode proves the components work; it can't prove the calls do. These
// pin which RPC each function calls with which argument names — the names
// 50_semesters.sql declares — and that a database refusal reaches the page
// as the same sentence mock mode throws (semesters.test.js).
import { beforeEach, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state = { rpcResult: { data: null, error: null } };
  const supabase = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u-admin' } } } })) },
    rpc: vi.fn(async () => state.rpcResult),
  };
  return { state, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

async function realMode() {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  return import('./client');
}

const SEM = '33333333-3333-4333-8333-333333333333';
const P = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.rpcResult = { data: null, error: null };
});

test('each read calls its function, and nothing current reads as null rather than an error', async () => {
  const c = await realMode();
  expect(await c.getCurrentSemester()).toBeNull();
  expect(fake.supabase.rpc).toHaveBeenLastCalledWith('current_semester');
  expect(await c.getSemesterClosePreview()).toBeNull();
  expect(fake.supabase.rpc).toHaveBeenLastCalledWith('semester_close_preview');
  expect(await c.getPastSemesters()).toEqual([]);
  expect(fake.supabase.rpc).toHaveBeenLastCalledWith('past_semesters');
  await c.getPastTeam(P);
  expect(fake.supabase.rpc).toHaveBeenLastCalledWith('past_team', { p_project_id: P });
});

test('closing sends the semester and the name exactly as typed', async () => {
  const c = await realMode();
  await c.closeSemester(SEM, 'Fall 2026 ');
  expect(fake.supabase.rpc).toHaveBeenCalledWith('close_semester', { p_semester_id: SEM, p_confirm_name: 'Fall 2026 ' });
});

test("closing's refusal comes back in the database's sentence", async () => {
  const c = await realMode();
  fake.state.rpcResult = { data: null, error: { message: 'Type the semester name exactly as shown to confirm', code: 'P0001' } };
  await expect(c.closeSemester(SEM, 'fall 2026')).rejects.toMatchObject({
    message: 'Type the semester name exactly as shown to confirm',
  });
});

test('reopening sends the semester', async () => {
  const c = await realMode();
  await c.reopenSemester(SEM);
  expect(fake.supabase.rpc).toHaveBeenCalledWith('reopen_semester', { p_semester_id: SEM });
});

test('starting sends the cleaned values, with the deadline as an ISO timestamp', async () => {
  const c = await realMode();
  const deadline = new Date(Date.now() + 30 * 86400000);
  const end = new Date(Date.now() + 120 * 86400000).toISOString().slice(0, 10);
  await c.startSemester({ name: '  Spring 2027 ', starts_on: '2027-01-19', ends_on: end, formation_deadline: deadline.toISOString() });
  expect(fake.supabase.rpc).toHaveBeenCalledWith('start_semester', {
    p_name: 'Spring 2027', p_starts_on: '2027-01-19', p_ends_on: end, p_formation_deadline: deadline.toISOString(),
  });
});

test('a form the database would refuse is refused before it is sent', async () => {
  const c = await realMode();
  await expect(c.startSemester({ name: '', starts_on: '', ends_on: '', formation_deadline: '' })).rejects.toMatchObject({
    fieldErrors: { name: 'Give the semester a name', starts_on: 'Give the semester a start date' },
  });
  expect(fake.supabase.rpc).not.toHaveBeenCalled();
});

test('joining the semester calls enroll_in_current_semester with no arguments, and passes a refusal on', async () => {
  const c = await realMode();
  fake.state.rpcResult = { data: { id: SEM, name: 'Spring 2027', needs_enrollment: false }, error: null };
  expect(await c.enrollInCurrentSemester()).toMatchObject({ needs_enrollment: false });
  expect(fake.supabase.rpc).toHaveBeenLastCalledWith('enroll_in_current_semester');
  fake.state.rpcResult = {
    data: null,
    error: { message: 'No semester is open right now — an admin has to start the next one first', code: 'P0001' },
  };
  await expect(c.enrollInCurrentSemester()).rejects.toMatchObject({
    message: 'No semester is open right now — an admin has to start the next one first',
  });
});
