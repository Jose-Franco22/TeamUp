// Issue #58 — the repository panel on the team page.
//
// Two things here are not about pixels and are the reason the file is this
// long:
//
//   1. A FAILURE MUST NOT REPLACE THE TABLE. Every one of the reasons the
//      Edge Function can return leaves the counts we already had on screen,
//      with a sentence above them. "The numbers are an hour old" is a far
//      better page than an error where the numbers were, and there is no
//      way to tell those apart except by asserting it.
//   2. THE THREE KINDS OF ROW LOOK DIFFERENT ON PURPOSE. A member with
//      commits, a member with a profile link and no commits, and a member
//      with no profile link at all are three different facts; the middle one
//      is a zero and the last one must not be, or the page accuses somebody
//      of writing nothing when the truth is that we cannot tell.
import { StrictMode } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import RepoActivity from './RepoActivity';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getRepoActivity: vi.fn(),
    refreshRepoActivity: vi.fn(),
    setProjectRepo: vi.fn(),
  };
});

const REPO = 'https://github.com/Jose-Franco22/TeamUp';

const MEMBERS = [
  { user_id: 'u-nicolas', name: 'Nicolas Guerra', github_url: 'https://github.com/nguerra' },
  { user_id: 'u-jose', name: 'Jose Franco Garza', github_url: 'https://github.com/Jose-Franco22' },
  { user_id: 'u-sofia', name: 'Sofia Garza', github_url: '' },
];

const ACTIVITY = {
  repo: REPO,
  contributors: [
    { login: 'nguerra', name: 'Nicolas Guerra', commits: 12, pull_requests: 3, last_commit_at: '2026-11-18T22:14:00Z' },
    { login: 'dependabot[bot]', name: null, commits: 4, pull_requests: 4, last_commit_at: '2026-11-17T06:02:00Z' },
  ],
  last_commit_at: '2026-11-18T22:14:00Z',
  window_days: 14,
  fetched_at: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
  error: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  client.getRepoActivity.mockResolvedValue(ACTIVITY);
  client.refreshRepoActivity.mockResolvedValue({ ok: true, cached: true, activity: ACTIVITY });
  client.setProjectRepo.mockImplementation(async (_id, repo) => ({ github_repo: repo }));
});

function renderPanel(props = {}) {
  render(
    <MemoryRouter>
      <RepoActivity
        projectId="p-parking"
        isOwner={false}
        members={MEMBERS}
        repo={REPO}
        viewerId="u-jose"
        {...props}
      />
    </MemoryRouter>
  );
}

const panel = () => screen.getByRole('region', { name: 'Repository activity' });
const rowFor = (name) => within(panel()).getByRole('row', { name: new RegExp(name) });

// --- nothing linked -------------------------------------------------------

describe('with no repository linked', () => {
  test('an owner is told what linking one would get them', async () => {
    renderPanel({ repo: '', isOwner: true });

    expect(await screen.findByText(/who has been contributing/)).toBeInTheDocument();
    expect(screen.getByLabelText('Repository URL')).toBeInTheDocument();
  });

  // Hiding the form is not a security measure — set_project_repo() refuses
  // anyone but the creator — it just saves a round trip that would fail.
  test('and a member is told whose job it is, with no form', async () => {
    renderPanel({ repo: '', isOwner: false });

    expect(await screen.findByText(/the project owner can add one/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Repository URL')).not.toBeInTheDocument();
  });

  test('nothing is fetched when there is nothing to fetch', async () => {
    renderPanel({ repo: '', isOwner: true });

    await waitFor(() => expect(screen.getByLabelText('Repository URL')).toBeInTheDocument());
    expect(client.getRepoActivity).not.toHaveBeenCalled();
    expect(client.refreshRepoActivity).not.toHaveBeenCalled();
  });

  test('and no table of nobody', async () => {
    renderPanel({ repo: '', isOwner: true });
    await waitFor(() => expect(screen.getByLabelText('Repository URL')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

// --- the owner linking one ------------------------------------------------

describe('linking a repository', () => {
  test('saves the link and asks GitHub straight away', async () => {
    const user = userEvent.setup();
    renderPanel({ repo: '', isOwner: true });

    await user.type(screen.getByLabelText('Repository URL'), REPO);
    await user.click(screen.getByRole('button', { name: 'Link repository' }));

    await waitFor(() => expect(client.setProjectRepo).toHaveBeenCalledWith('p-parking', REPO));
    await waitFor(() =>
      expect(client.refreshRepoActivity).toHaveBeenCalledWith('p-parking', { force: true })
    );
  });

  // The message under the box comes from the same parser the database
  // mirrors, so what the form refuses and what the server refuses agree.
  test('a link we cannot read is refused before anything is sent', async () => {
    const user = userEvent.setup();
    renderPanel({ repo: '', isOwner: true });

    await user.type(screen.getByLabelText('Repository URL'), 'https://github.com/GoldNicolas');
    await user.click(screen.getByRole('button', { name: 'Link repository' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/profile link, not a repository/);
    expect(client.setProjectRepo).not.toHaveBeenCalled();
  });

  test('and the message goes away as soon as they start fixing it', async () => {
    const user = userEvent.setup();
    renderPanel({ repo: '', isOwner: true });

    await user.type(screen.getByLabelText('Repository URL'), 'nonsense');
    await user.click(screen.getByRole('button', { name: 'Link repository' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Repository URL'), '!');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a refusal from the server lands under the box too', async () => {
    const user = userEvent.setup();
    client.setProjectRepo.mockRejectedValue(
      new Error('Only the project creator can link a repository')
    );
    renderPanel({ repo: '', isOwner: true });

    await user.type(screen.getByLabelText('Repository URL'), REPO);
    await user.click(screen.getByRole('button', { name: 'Link repository' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Only the project creator/);
  });

  test('the owner can change a link that is already there', async () => {
    const user = userEvent.setup();
    renderPanel({ isOwner: true });

    await user.click(await screen.findByRole('button', { name: 'Change repository' }));
    const box = screen.getByLabelText('Repository URL');
    expect(box).toHaveValue(REPO);

    await user.clear(box);
    await user.type(box, 'github.com/utrgv/parking-tracker');
    await user.click(screen.getByRole('button', { name: 'Save repository' }));

    await waitFor(() =>
      expect(client.setProjectRepo).toHaveBeenCalledWith('p-parking', 'github.com/utrgv/parking-tracker')
    );
  });

  test('or back out of changing it', async () => {
    const user = userEvent.setup();
    renderPanel({ isOwner: true });

    await user.click(await screen.findByRole('button', { name: 'Change repository' }));
    await user.type(screen.getByLabelText('Repository URL'), '/extra');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(client.setProjectRepo).not.toHaveBeenCalled();
    // And the box forgets the abandoned edit rather than keeping it.
    await user.click(screen.getByRole('button', { name: 'Change repository' }));
    expect(screen.getByLabelText('Repository URL')).toHaveValue(REPO);
  });

  test('a member is offered no way to change it', async () => {
    renderPanel({ isOwner: false });

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Change repository' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Repository URL')).not.toBeInTheDocument();
  });
});

// --- the table ------------------------------------------------------------

describe('the activity table', () => {
  test('reads the cache first, then asks for a refresh', async () => {
    renderPanel();

    await waitFor(() => expect(client.getRepoActivity).toHaveBeenCalledWith('p-parking'));
    await waitFor(() =>
      expect(client.refreshRepoActivity).toHaveBeenCalledWith('p-parking', { force: false })
    );
  });

  test('names the window and links the repo', async () => {
    renderPanel();

    expect(await within(panel()).findByText('Last 14 days')).toBeInTheDocument();
    const link = within(panel()).getByRole('link', { name: 'Jose-Franco22/TeamUp' });
    expect(link).toHaveAttribute('href', REPO);
  });

  test('a member with commits gets their counts', async () => {
    renderPanel();

    const row = await waitFor(() => rowFor('Nicolas Guerra'));
    expect(within(row).getByText('12')).toBeInTheDocument();
    expect(within(row).getByText('3')).toBeInTheDocument();
  });

  // THE MIDDLE CASE: on the team, profile linked, nothing in the window.
  test('a linked member with nothing in the window reads as a zero', async () => {
    renderPanel();

    const row = await waitFor(() => rowFor('Jose Franco Garza'));
    expect(within(row).getAllByText('0')).toHaveLength(2);
  });

  // THE LAST CASE: we cannot tell, and a zero would be a lie.
  test('a member with no profile link gets dashes and an explanation, not zeroes', async () => {
    renderPanel();

    const row = await waitFor(() => rowFor('Sofia Garza'));
    expect(within(row).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(row).queryByText('0')).not.toBeInTheDocument();
    expect(within(row).getByText(/No GitHub URL on their profile/)).toBeInTheDocument();
  });

  // THE CRITERION: "anything unmatched shows as Unlinked contributor".
  test('a contributor who matches nobody is shown as unlinked rather than dropped', async () => {
    renderPanel();

    const row = await waitFor(() => rowFor('dependabot'));
    expect(within(row).getByText('Unlinked contributor')).toBeInTheDocument();
    // By cell rather than by text: this contributor has four commits and
    // four pull requests, and getByText('4') cannot tell them apart.
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(1, 3)).toEqual(['4', '4']);
  });

  test('the last commit date is shown for the repo and per member', async () => {
    renderPanel();

    expect(await within(panel()).findByText(/last commit/)).toBeInTheDocument();
    const row = rowFor('Nicolas Guerra');
    expect(within(row).getByText(new Date(ACTIVITY.last_commit_at).toLocaleDateString())).toBeInTheDocument();
  });

  test('a repo with nothing in the window still lists the team', async () => {
    const empty = { ...ACTIVITY, contributors: [], last_commit_at: null };
    client.getRepoActivity.mockResolvedValue(empty);
    client.refreshRepoActivity.mockResolvedValue({ ok: true, cached: false, activity: empty });
    renderPanel();

    expect(await within(panel()).findByText(/no commits in the window yet/)).toBeInTheDocument();
    expect(rowFor('Nicolas Guerra')).toBeInTheDocument();
    expect(rowFor('Jose Franco Garza')).toBeInTheDocument();
  });

  test('and how old the numbers are', async () => {
    renderPanel();
    expect(await within(panel()).findByText(/Updated 4 minutes ago/)).toBeInTheDocument();
  });

  // THE ONE THE TESTS MISSED. Every case above passed while the panel sat
  // on "Checking GitHub…" forever in the actual app: StrictMode mounts each
  // component twice in development, the cleanup cleared the "still mounted"
  // ref, and nothing reset it for the second mount — so every update after
  // the first await was dropped. The browser caught it; this is so the next
  // one doesn't need to.
  test('renders under StrictMode, which mounts it twice', async () => {
    render(
      <StrictMode>
        <MemoryRouter>
          <RepoActivity
            projectId="p-parking"
            isOwner={false}
            members={MEMBERS}
            repo={REPO}
            viewerId="u-jose"
          />
        </MemoryRouter>
      </StrictMode>
    );

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(within(rowFor('Nicolas Guerra')).getByText('12')).toBeInTheDocument();
    expect(screen.queryByText('Checking GitHub…')).not.toBeInTheDocument();
  });
});

// --- the profile prompt ---------------------------------------------------

describe('members without a GitHub URL', () => {
  // THE CRITERION, for the person it is about: they are the only one who can
  // fix it, so they get the link.
  test('the viewer is told how to fix their own', async () => {
    renderPanel({ viewerId: 'u-sofia' });

    expect(await screen.findByText(/aren’t being counted yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add your GitHub URL/ })).toHaveAttribute(
      'href',
      '/profile'
    );
  });

  // And everybody else is told who is missing, without being sent to a
  // profile page they cannot edit.
  test('while the rest of the team is told who is missing', async () => {
    renderPanel({ viewerId: 'u-jose' });

    expect(await screen.findByText(/Sofia Garza has no GitHub URL/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Add your GitHub URL/ })).not.toBeInTheDocument();
  });

  test('and a team where everyone is linked is not nagged', async () => {
    renderPanel({ members: MEMBERS.slice(0, 2) });

    await waitFor(() => expect(screen.getByRole('table')).toBeInTheDocument());
    expect(screen.queryByText(/no GitHub URL/)).not.toBeInTheDocument();
    expect(screen.queryByText(/aren’t being counted yet/)).not.toBeInTheDocument();
  });
});

// --- refreshing -----------------------------------------------------------

describe('refreshing', () => {
  test('anyone on the team can, and it forces a fetch', async () => {
    const user = userEvent.setup();
    renderPanel({ isOwner: false });

    await user.click(await screen.findByRole('button', { name: 'Refresh' }));

    await waitFor(() =>
      expect(client.refreshRepoActivity).toHaveBeenCalledWith('p-parking', { force: true })
    );
  });

  test('and the new numbers replace the old ones', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitFor(() => rowFor('Nicolas Guerra'));

    client.refreshRepoActivity.mockResolvedValue({
      ok: true,
      cached: false,
      activity: {
        ...ACTIVITY,
        contributors: [{ login: 'nguerra', commits: 20, pull_requests: 5, last_commit_at: null }],
      },
    });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(within(rowFor('Nicolas Guerra')).getByText('20')).toBeInTheDocument());
  });
});

// --- when there is no answer ---------------------------------------------

describe('a failure', () => {
  // THE RULE: the counts stay. Each of these says what happened above a
  // table that is still readable.
  test.each([
    ['not_found', /read-only collaborator/],
    ['rate_limited', /rate-limiting/],
    ['unreachable', /Couldn’t reach GitHub/],
    ['upstream_error', /GitHub had a problem/],
    ['timeout', /took too long/],
    ['bad_token', /nothing is wrong with your repo/],
    ['unavailable', /isn’t available in this build/],
    ['not_configured', /isn’t set up on the server/],
  ])('%s says what happened and leaves the table alone', async (reason, sentence) => {
    client.refreshRepoActivity.mockResolvedValue({ ok: false, reason });
    renderPanel();

    expect(await within(panel()).findByText(sentence)).toBeInTheDocument();
    expect(within(rowFor('Nicolas Guerra')).getByText('12')).toBeInTheDocument();
  });

  // THE CRITERION: a private repo explains how to give access. GitHub
  // answers 404 for private and missing alike, so this is the sentence that
  // covers both — and it arrives on the row, not as a thrown error.
  test('a private repo explains how to grant access', async () => {
    client.refreshRepoActivity.mockResolvedValue({
      ok: true,
      cached: false,
      activity: { ...ACTIVITY, error: 'not_found' },
    });
    renderPanel();

    const note = await within(panel()).findByRole('status');
    expect(note).toHaveTextContent(/If it’s private/);
    expect(note).toHaveTextContent(/read-only collaborator/);
  });

  // Not an alert: a screen reader interrupting to say the counts are an hour
  // old is louder than the news deserves.
  test('and says it as a status rather than an alert', async () => {
    client.refreshRepoActivity.mockResolvedValue({ ok: false, reason: 'unreachable' });
    renderPanel();

    expect(await within(panel()).findByRole('status')).toBeInTheDocument();
    expect(within(panel()).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a cache we cannot even read still shows the link and the form', async () => {
    client.getRepoActivity.mockRejectedValue(new Error('PGRST500'));
    client.refreshRepoActivity.mockResolvedValue({ ok: false, reason: 'unreachable' });
    renderPanel({ isOwner: true });

    expect(await within(panel()).findByRole('link', { name: 'Jose-Franco22/TeamUp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change repository' })).toBeInTheDocument();
  });

  test('and a success afterwards clears the sentence', async () => {
    const user = userEvent.setup();
    client.refreshRepoActivity.mockResolvedValue({ ok: false, reason: 'unreachable' });
    renderPanel();
    expect(await within(panel()).findByRole('status')).toBeInTheDocument();

    client.refreshRepoActivity.mockResolvedValue({ ok: true, cached: false, activity: ACTIVITY });
    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(within(panel()).queryByRole('status')).not.toBeInTheDocument());
  });
});
