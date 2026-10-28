// The Announcements page, against the mock API: what students see, what
// admins can post, and that nothing typed is ever run as HTML.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Announcements, { relativeDue } from './Announcements';
import { setSessionUserId } from '../api/client';
import { announcements, announcementsSeenAt, milestones } from '../api/mockData';

let viewer = { id: 'u-sofia', name: 'Sofia Garza', is_admin: false };
vi.mock('../auth/SessionContext', () => ({ useSession: () => ({ user: viewer }) }));

const inDays = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();

function seed() {
  milestones.push(
    { id: 'ms-1', name: 'Proposal due', due_at: inDays(5), is_formation_deadline: false, message: 'One PDF per team.', updated_at: inDays(-1) },
    { id: 'ms-2', name: 'Teams due', due_at: inDays(2), is_formation_deadline: true, message: '', updated_at: inDays(-1) },
    { id: 'ms-0', name: 'Kickoff', due_at: inDays(-10), is_formation_deadline: false, message: '', updated_at: inDays(-20) },
  );
  announcements.push({
    id: 'an-1', title: 'Welcome to senior project', body: 'Read the syllabus.\n\nThen list your skills.',
    author_id: 'u-instructor', created_at: inDays(-3), updated_at: inDays(-3),
  });
}

function renderPage(as) {
  viewer = as;
  setSessionUserId(as.id);
  render(<MemoryRouter><Announcements /></MemoryRouter>);
}

// The admin form shows before the feed and deadlines load, so wait for both
// before typing; otherwise their "Loading…" status is still on the page.
async function renderLoadedPage(as) {
  renderPage(as);
  await waitFor(() => expect(screen.queryByText(/^Loading/)).not.toBeInTheDocument());
}

// A save or delete is two mock calls (the change, then a refetch), each with
// the mock API's delay, which can outlast findBy's default 1s on a slow CI runner.
const AFTER_SAVE = { timeout: 3000 };

const STUDENT = { id: 'u-sofia', name: 'Sofia Garza', is_admin: false };
const ADMIN = { id: 'u-instructor', name: 'Course Instructor', is_admin: true };

beforeEach(() => {
  milestones.length = 0;
  announcements.length = 0;
  for (const k of Object.keys(announcementsSeenAt)) delete announcementsSeenAt[k];
  seed();
});
afterEach(() => setSessionUserId(null));

test('students see upcoming deadlines soonest first, with their messages', async () => {
  renderPage(STUDENT);
  const list = await screen.findByRole('list', { name: 'Upcoming deadlines' });
  const items = within(list).getAllByRole('listitem');
  expect(items.map((li) => li.querySelector('h3').textContent)).toEqual(['Teams dueRosters lock', 'Proposal due']);
  expect(within(items[0]).getByText('in 2 days')).toBeInTheDocument();
  expect(within(items[1]).getByText('One PDF per team.')).toBeInTheDocument();
});

test('students see announcements with who posted them, and past deadlines separately', async () => {
  renderPage(STUDENT);
  const posts = await screen.findByRole('list', { name: 'Announcements' });
  expect(within(posts).getByRole('heading', { name: 'Welcome to senior project' })).toBeInTheDocument();
  expect(within(posts).getByText(/Course Instructor/)).toBeInTheDocument();
  expect(within(posts).getByText(/Then list your skills/)).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'Past deadlines' })).getByText('Kickoff')).toBeInTheDocument();
  // Students can only read.
  expect(screen.queryByRole('form', { name: 'Post an announcement' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Edit|Delete/ })).not.toBeInTheDocument();
});

test('opening the page records the visit', async () => {
  renderPage(STUDENT);
  await screen.findByRole('list', { name: 'Announcements' });
  await vi.waitFor(() => expect(announcementsSeenAt['u-sofia']).toBeTruthy());
});

test('empty states', async () => {
  milestones.length = 0;
  announcements.length = 0;
  renderPage(STUDENT);
  expect(await screen.findByText('No upcoming deadlines.')).toBeInTheDocument();
  expect(await screen.findByText('No announcements yet.')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Past deadlines' })).not.toBeInTheDocument();
});

test('an admin posts an announcement, and it shows at the top with their name', async () => {
  const user = userEvent.setup();
  await renderLoadedPage(ADMIN);
  const form = screen.getByRole('form', { name: 'Post an announcement' });
  await user.type(within(form).getByLabelText('Title'), 'Demo day moved');
  await user.type(within(form).getByLabelText('Message'), 'Now on the 12th, same room.');
  await user.click(within(form).getByRole('button', { name: 'Post announcement' }));

  expect(await screen.findByText('Posted “Demo day moved”.', {}, AFTER_SAVE)).toHaveAttribute('role', 'status');
  const posts = screen.getByRole('list', { name: 'Announcements' });
  await within(posts).findByRole('heading', { name: 'Demo day moved' }, AFTER_SAVE);
  const first = within(posts).getAllByRole('listitem')[0];
  expect(within(first).getByRole('heading')).toHaveTextContent('Demo day moved');
  expect(first).toHaveTextContent('Course Instructor');
  expect(within(form).getByLabelText('Title')).toHaveValue('');
});

test('garbage is caught in the form and nothing is posted', async () => {
  const user = userEvent.setup();
  renderPage(ADMIN);
  const form = await screen.findByRole('form', { name: 'Post an announcement' });

  await user.click(within(form).getByRole('button', { name: 'Post announcement' }));
  expect(within(form).getByText('Give the announcement a title')).toBeInTheDocument();
  expect(within(form).getByText('Write a message')).toBeInTheDocument();

  await user.type(within(form).getByLabelText('Title'), '!!!!');
  await user.type(within(form).getByLabelText('Message'), '... ???');
  await user.tab();
  expect(within(form).getByText('The title has to include letters or numbers')).toBeInTheDocument();
  expect(within(form).getByText('The message has to include letters or numbers')).toBeInTheDocument();
  await user.click(within(form).getByRole('button', { name: 'Post announcement' }));
  expect(announcements).toHaveLength(1);
});

test('an admin edits and deletes an announcement', async () => {
  const user = userEvent.setup();
  await renderLoadedPage(ADMIN);
  await user.click(screen.getByRole('button', { name: 'Edit Welcome to senior project' }));
  const form = screen.getByRole('form', { name: 'Edit announcement' });
  const title = within(form).getByLabelText('Title');
  expect(title).toHaveValue('Welcome to senior project');
  await user.clear(title);
  await user.type(title, 'Welcome, everyone');
  await user.click(within(form).getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByText('Saved “Welcome, everyone”.', {}, AFTER_SAVE)).toHaveAttribute('role', 'status');
  expect(await screen.findByRole('heading', { name: 'Welcome, everyone' }, AFTER_SAVE)).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Delete Welcome, everyone' }));
  await user.click(screen.getByRole('button', { name: 'Delete “Welcome, everyone”' }));
  expect(await screen.findByText('No announcements yet.', {}, AFTER_SAVE)).toBeInTheDocument();
  expect(announcements).toHaveLength(0);
});

test('HTML and SQL in an announcement are shown as text, never run', async () => {
  const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
  announcements.push({
    id: 'an-x', title: "Robert'); DROP TABLE announcements; --", body: payload,
    author_id: 'u-instructor', created_at: inDays(0), updated_at: inDays(0),
  });
  renderPage(STUDENT);
  const posts = await screen.findByRole('list', { name: 'Announcements' });
  expect(within(posts).getByText(payload)).toBeInTheDocument();
  expect(within(posts).getByRole('heading', { name: "Robert'); DROP TABLE announcements; --" })).toBeInTheDocument();
  expect(document.querySelector('img, script')).toBeNull();
  expect(window.__pwned).toBeUndefined();
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
