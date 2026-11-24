// Issue #57 — deliverables on the team page.
//
// What this file is about, criterion by criterion: the file picker refuses
// what the bucket would refuse, before anything uploads; every status reads
// as its own badge and late work says so; every earlier version stays
// listed; and nobody on the team is offered the adviser's review controls,
// which don't exist until #54 (PR #90) — the adviser's half of that last
// criterion arrives with them.
//
// The picker cases use applyAccept: false. user-event otherwise filters out
// a file that doesn't match <input accept>, which is a courtesy to the OS
// dialog and not a check: "All files" is one click away in every dialog, so
// what's under test is what happens when the wrong file gets through.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Deliverables from './Deliverables';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getDeliverables: vi.fn(),
    submitDeliverable: vi.fn(),
    getDeliverableFileUrls: vi.fn(),
    reviewDeliverable: vi.fn(),
    postDeliverableComment: vi.fn(),
  };
});

const FUTURE = '2098-11-01T17:00:00Z';
const PAST = '2001-11-01T17:00:00Z';
const MB = 1024 * 1024;

function version(n, fields = {}) {
  return {
    id: `v-${n}`,
    version: n,
    kind: 'file',
    file_path: `p-parking/ms-prop/${n}.pdf`,
    file_name: `Proposal v${n}.pdf`,
    file_size: 2 * MB,
    file_type: 'pdf',
    link_url: null,
    is_late: false,
    status: 'submitted',
    submitted_by: 'u-jose',
    submitted_by_name: 'Jose Franco Garza',
    submitted_at: `2026-10-0${n}T15:00:00Z`,
    ...fields,
  };
}

function deliverable(fields = {}) {
  return {
    milestone_id: 'ms-prop',
    name: 'Project proposal',
    due_at: FUTURE,
    message: '',
    status: 'not_submitted',
    is_late: false,
    versions: [],
    comments: [],
    ...fields,
  };
}

function fileOf(name, size, type = '') {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

beforeEach(() => {
  vi.clearAllMocks();
  client.getDeliverables.mockResolvedValue([deliverable()]);
  client.submitDeliverable.mockResolvedValue({ version: 1, is_late: false });
  client.getDeliverableFileUrls.mockResolvedValue({});
  client.reviewDeliverable.mockResolvedValue({});
  client.postDeliverableComment.mockResolvedValue({});
});

async function renderList() {
  render(<MemoryRouter><Deliverables projectId="p-parking" /></MemoryRouter>);
  return screen.findByRole('region', { name: 'Deliverables' });
}

const item = (name) => screen.getByRole('article', { name });

// --- the file picker --------------------------------------------------------

describe('the file picker', () => {
  test('refuses a file of the wrong type, and offers nothing to submit', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderList();

    await user.upload(screen.getByLabelText('File'), fileOf('notes.txt', 1024, 'text/plain'));

    expect(screen.getByRole('alert')).toHaveTextContent('Upload a PDF, DOCX or PPTX file');
    expect(screen.getByLabelText('File')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(client.submitDeliverable).not.toHaveBeenCalled();
  });

  test.each(['setup.exe', 'archive.zip', 'proposal.doc', 'pdf'])('refuses %s', async (name) => {
    const user = userEvent.setup({ applyAccept: false });
    await renderList();
    await user.upload(screen.getByLabelText('File'), fileOf(name, 1024));
    expect(screen.getByRole('alert')).toHaveTextContent('Upload a PDF, DOCX or PPTX file');
  });

  test('refuses a file one byte over 25 MB', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderList();

    await user.upload(screen.getByLabelText('File'), fileOf('Proposal.pdf', 25 * MB + 1, 'application/pdf'));

    expect(screen.getByRole('alert')).toHaveTextContent('Files can be at most 25 MB');
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
    expect(client.submitDeliverable).not.toHaveBeenCalled();
  });

  test('takes a PDF of exactly 25 MB and submits it', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderList();
    const file = fileOf('Proposal.pdf', 25 * MB, 'application/pdf');

    await user.upload(screen.getByLabelText('File'), file);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    expect(client.submitDeliverable).toHaveBeenCalledWith('p-parking', 'ms-prop', { file });
    expect(await screen.findByRole('status')).toHaveTextContent('Version 1 submitted.');
  });

  test.each(['Design doc.DOCX', 'Slides.pptx'])('takes %s', async (name) => {
    const user = userEvent.setup({ applyAccept: false });
    await renderList();
    await user.upload(screen.getByLabelText('File'), fileOf(name, 3 * MB));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  test('tells the browser which types to offer', async () => {
    await renderList();
    const accept = screen.getByLabelText('File').getAttribute('accept');
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.docx');
    expect(accept).toContain('.pptx');
  });

  test('a link is the other way to submit', async () => {
    const user = userEvent.setup();
    await renderList();
    await user.click(screen.getByRole('radio', { name: 'Paste a link' }));
    await user.type(screen.getByLabelText('Link'), 'javascript:alert(1)');
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Paste a full link that starts with http:// or https://');

    await user.clear(screen.getByLabelText('Link'));
    await user.type(screen.getByLabelText('Link'), 'https://docs.example.edu/proposal');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(client.submitDeliverable).toHaveBeenCalledWith('p-parking', 'ms-prop', {
      link: 'https://docs.example.edu/proposal',
    });
  });

  test('a refusal from the server is shown, and the list is not reloaded', async () => {
    client.submitDeliverable.mockRejectedValue(new Error('Only members of this team can submit its deliverables'));
    const user = userEvent.setup({ applyAccept: false });
    await renderList();
    await user.upload(screen.getByLabelText('File'), fileOf('Proposal.pdf', MB));
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only members of this team can submit its deliverables');
    expect(client.getDeliverables).toHaveBeenCalledTimes(1);
  });
});

// --- statuses and late --------------------------------------------------------

describe('status badges', () => {
  const CASES = [
    ['not_submitted', 'Not submitted', 'quiet'],
    ['submitted', 'Submitted', 'info'],
    ['changes_requested', 'Changes requested', 'warn'],
    ['approved', 'Approved', 'good'],
  ];

  test.each(CASES)('%s reads "%s" with the %s tone', async (status, label, tone) => {
    client.getDeliverables.mockResolvedValue([
      deliverable({ status, versions: status === 'not_submitted' ? [] : [version(1, { status })] }),
    ]);
    await renderList();
    const head = within(item('Project proposal')).getByRole('banner');
    const badge = within(head).getByText(label);
    expect(badge).toHaveClass('pill', tone);
    expect(badge).toHaveAttribute('data-status', status);
  });

  test('four deliverables in four states each show their own badge and no other', async () => {
    client.getDeliverables.mockResolvedValue(
      CASES.map(([status], i) =>
        deliverable({
          milestone_id: `ms-${i}`,
          name: `Milestone ${i}`,
          status,
          versions: status === 'not_submitted' ? [] : [version(1, { status })],
        })
      )
    );
    await renderList();
    CASES.forEach(([, label], i) => {
      const head = within(item(`Milestone ${i}`)).getByRole('banner');
      for (const [, other] of CASES) {
        if (other === label) expect(within(head).getByText(other)).toBeInTheDocument();
        else expect(within(head).queryByText(other)).not.toBeInTheDocument();
      }
    });
  });

  test('a late deliverable is labelled late; an on-time one is not', async () => {
    client.getDeliverables.mockResolvedValue([
      deliverable({ milestone_id: 'a', name: 'Late one', due_at: PAST, status: 'submitted', is_late: true, versions: [version(1, { is_late: true })] }),
      deliverable({ milestone_id: 'b', name: 'On time', status: 'submitted', versions: [version(1)] }),
    ]);
    await renderList();
    expect(within(within(item('Late one')).getByRole('banner')).getByText('Late')).toBeInTheDocument();
    expect(within(item('On time')).queryByText('Late')).not.toBeInTheDocument();
  });

  test('past the due date, the form says a submission will be marked late', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ due_at: PAST })]);
    await renderList();
    expect(within(item('Project proposal')).getByText(/still submit, and it will be marked late/)).toBeInTheDocument();
  });
});

// --- version history -------------------------------------------------------------

describe('version history', () => {
  const THREE = [
    version(3, { kind: 'link', file_path: null, file_name: null, file_size: null, file_type: null, link_url: 'https://docs.example.edu/v3' }),
    version(2, { is_late: true, status: 'changes_requested', submitted_by_name: 'Nicolas Guerra' }),
    version(1),
  ];
  const LINKS = { 'v-2': 'https://storage.example/v2?token=a', 'v-1': 'https://storage.example/v1?token=b' };

  test('lists every earlier version, newest first, with who submitted it', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: THREE })]);
    client.getDeliverableFileUrls.mockResolvedValue(LINKS);
    await renderList();
    const history = screen.getByRole('list', { name: 'Versions of Project proposal' });
    const rows = within(history).getAllByRole('listitem');

    expect(rows.map((r) => within(r).getByText(/^Version \d$/).textContent)).toEqual(['Version 3', 'Version 2', 'Version 1']);
    expect(within(rows[0]).getByRole('link', { name: 'https://docs.example.edu/v3' })).toHaveAttribute('href', 'https://docs.example.edu/v3');
    expect(await within(rows[1]).findByRole('link', { name: 'Download Proposal v2.pdf' })).toBeInTheDocument();
    expect(within(rows[1]).getByText(/Nicolas Guerra/)).toBeInTheDocument();
    expect(within(rows[2]).getByRole('link', { name: 'Download Proposal v1.pdf' })).toBeInTheDocument();
  });

  test('each version keeps its own late label and status', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: THREE })]);
    await renderList();
    const rows = within(screen.getByRole('list', { name: 'Versions of Project proposal' })).getAllByRole('listitem');
    expect(within(rows[1]).getByText('Late')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Changes requested')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('Late')).not.toBeInTheDocument();
    expect(within(rows[2]).queryByText('Late')).not.toBeInTheDocument();
  });

  // #95 review: the download used to be a button that awaited a URL and then
  // called window.open(), outside the click's user gesture — Safari, Firefox
  // and mobile blocked it and nothing happened. It has to be a real link with
  // its URL already in place before anyone clicks.
  test('a stored file is a real link with its URL in place before the click — no window.open', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: THREE })]);
    client.getDeliverableFileUrls.mockResolvedValue(LINKS);
    await renderList();

    const download = await screen.findByRole('link', { name: 'Download Proposal v1.pdf' });
    expect(download.tagName).toBe('A');
    expect(download).toHaveAttribute('href', 'https://storage.example/v1?token=b');
    expect(download).toHaveAttribute('download', 'Proposal v1.pdf');
    expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  test('links are minted up front, for every version, in one call', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: THREE })]);
    client.getDeliverableFileUrls.mockResolvedValue(LINKS);
    await renderList();
    await waitFor(() => expect(client.getDeliverableFileUrls).toHaveBeenCalledTimes(1));
    expect(client.getDeliverableFileUrls).toHaveBeenCalledWith(THREE);
  });

  test('a file that could not get a link says so next to it, and is not a dead link', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: THREE })]);
    client.getDeliverableFileUrls.mockResolvedValue({ 'v-2': null, 'v-1': LINKS['v-1'] });
    await renderList();
    const rows = within(screen.getByRole('list', { name: 'Versions of Project proposal' })).getAllByRole('listitem');
    expect(await within(rows[1]).findByRole('alert')).toHaveTextContent('can’t be downloaded right now');
    expect(within(rows[1]).queryByRole('link')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Proposal v2.pdf')).toBeInTheDocument();
  });

  test('a stored link that is not http(s) is shown as text, never as a link', async () => {
    client.getDeliverables.mockResolvedValue([
      deliverable({ status: 'submitted', versions: [version(1, { kind: 'link', file_path: null, file_name: null, link_url: 'javascript:alert(1)' })] }),
    ]);
    await renderList();
    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull();
  });

  test('resubmitting is offered as a new version', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: THREE })]);
    await renderList();
    expect(screen.getByRole('button', { name: 'Submit a new version' })).toBeInTheDocument();
  });
});

// --- a refresh that fails after a write ------------------------------------------
// #95 review: a submission that saved, followed by a reload that failed,
// used to swap the whole card for an error — the history vanished and the
// success message with it, so students resubmitted. The list has to stay.

describe('a refresh that fails after a write', () => {
  test('after a submit, the list stays on screen and the message says it is stale', async () => {
    client.getDeliverables
      .mockResolvedValueOnce([deliverable({ status: 'submitted', versions: [version(1)] })])
      .mockRejectedValueOnce(new Error('Network error'));
    client.submitDeliverable.mockResolvedValue({ version: 2, is_late: false });
    const user = userEvent.setup({ applyAccept: false });
    await renderList();

    await user.upload(screen.getByLabelText('File'), fileOf('Proposal v2.pdf', MB, 'application/pdf'));
    await user.click(screen.getByRole('button', { name: 'Submit a new version' }));

    const status = await screen.findByText(/Version 2 submitted\./);
    await waitFor(() => expect(status).toHaveTextContent('couldn’t be refreshed'));
    expect(screen.getByRole('list', { name: 'Versions of Project proposal' })).toBeInTheDocument();
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });

  test('after a reply, the thread stays on screen and says it is stale', async () => {
    client.getDeliverables
      .mockResolvedValueOnce([
        deliverable({
          status: 'submitted',
          versions: [version(1)],
          comments: [{ id: 'c1', author_id: 'u-jose', author_name: 'Jose Franco Garza', body: 'First.', decision: null, version: 1, created_at: '2026-10-02T10:00:00Z' }],
        }),
      ])
      .mockRejectedValueOnce(new Error('Network error'));
    const user = userEvent.setup();
    await renderList();

    await user.type(screen.getByLabelText('Reply'), 'Second.');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));

    expect(await screen.findByText(/Posted\. The list below couldn’t be refreshed/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Comments on Project proposal' })).toHaveTextContent('First.');
  });
});

// --- the thread ------------------------------------------------------------------

describe('the thread', () => {
  test('shows the comments and posts a reply', async () => {
    client.getDeliverables.mockResolvedValue([
      deliverable({
        status: 'submitted',
        versions: [version(1)],
        comments: [{ id: 'c1', author_id: 'u-jose', author_name: 'Jose Franco Garza', body: 'Budget is in section 4.', decision: null, version: 1, created_at: '2026-10-02T10:00:00Z' }],
      }),
    ]);
    const user = userEvent.setup();
    await renderList();
    const thread = screen.getByRole('list', { name: 'Comments on Project proposal' });
    expect(within(thread).getByText('Budget is in section 4.')).toBeInTheDocument();
    expect(within(thread).getByText(/on version 1/)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Reply'), 'Thanks — updated.');
    await user.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(client.postDeliverableComment).toHaveBeenCalledWith('p-parking', 'ms-prop', 'Thanks — updated.');
    await waitFor(() => expect(client.getDeliverables).toHaveBeenCalledTimes(2));
  });

  test('an empty reply is refused before it is sent', async () => {
    const user = userEvent.setup();
    await renderList();
    await user.click(screen.getByRole('button', { name: 'Post reply' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Write a comment first');
    expect(client.postDeliverableComment).not.toHaveBeenCalled();
  });

  test('an adviser’s decision shows in the thread with its badge', async () => {
    client.getDeliverables.mockResolvedValue([
      deliverable({
        status: 'approved',
        versions: [version(1, { status: 'approved' })],
        comments: [{ id: 'c1', author_id: 'u-dana', author_name: 'Dana Kim', body: '', decision: 'approved', version: 1, created_at: '2026-10-03T10:00:00Z' }],
      }),
    ]);
    await renderList();
    const thread = screen.getByRole('list', { name: 'Comments on Project proposal' });
    expect(within(thread).getByText('Dana Kim')).toBeInTheDocument();
    expect(within(thread).getByText('Approved')).toHaveAttribute('data-status', 'approved');
  });
});

// --- who reviews -------------------------------------------------------------------

async function renderAsAdviser() {
  render(<MemoryRouter><Deliverables projectId="p-parking" asAdviser /></MemoryRouter>);
  return screen.findByRole('region', { name: 'Deliverables' });
}

describe('the review controls', () => {
  const TWO = [version(2), version(1)];

  test('a student is not offered Approve or Request changes, and does get the submit form', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: TWO })]);
    await renderList();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request changes' })).not.toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Submit Project proposal' })).toBeInTheDocument();
  });

  test('the adviser is offered both, for the newest version, and no submit form', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: TWO })]);
    await renderAsAdviser();
    const panel = screen.getByRole('group', { name: 'Review version 2 of Project proposal' });
    expect(within(panel).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Submit Project proposal' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('File')).not.toBeInTheDocument();
  });

  test('with nothing submitted yet, the adviser has nothing to decide on', async () => {
    await renderAsAdviser();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText('Nothing has been submitted for this yet.')).toBeInTheDocument();
  });

  test('Approve sends the version on screen, tells the adviser the team was told, and reloads', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: TWO })]);
    client.reviewDeliverable.mockResolvedValue({});
    const user = userEvent.setup();
    await renderAsAdviser();
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(client.reviewDeliverable).toHaveBeenCalledWith('p-parking', 'ms-prop', 2, 'approved', '');
    expect(await screen.findByText('Approved version 2. The team has been told.')).toBeInTheDocument();
    await waitFor(() => expect(client.getDeliverables).toHaveBeenCalledTimes(2));
  });

  test('Request changes without a note is stopped before it is sent; with one it goes', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: TWO })]);
    client.reviewDeliverable.mockResolvedValue({});
    const user = userEvent.setup();
    await renderAsAdviser();

    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Say what needs to change');
    expect(client.reviewDeliverable).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(/Note to the team/), 'Split the risks by owner.');
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    expect(client.reviewDeliverable).toHaveBeenCalledWith('p-parking', 'ms-prop', 2, 'changes_requested', 'Split the risks by owner.');
  });

  test('a refusal from the server is shown — e.g. a newer version arrived meanwhile', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: TWO })]);
    client.reviewDeliverable.mockRejectedValue(new Error('A newer version has been submitted since — review that one'));
    const user = userEvent.setup();
    await renderAsAdviser();
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A newer version has been submitted since');
  });

  test('the adviser comments rather than replies', async () => {
    client.getDeliverables.mockResolvedValue([deliverable({ status: 'submitted', versions: TWO })]);
    const user = userEvent.setup();
    await renderAsAdviser();
    await user.type(screen.getByLabelText('Comment'), 'Looks close.');
    await user.click(screen.getByRole('button', { name: 'Post comment' }));
    expect(client.postDeliverableComment).toHaveBeenCalledWith('p-parking', 'ms-prop', 'Looks close.');
  });
});

describe('around it', () => {
  test('renders nothing when no milestone needs a deliverable', async () => {
    client.getDeliverables.mockResolvedValue([]);
    const { container } = render(<MemoryRouter><Deliverables projectId="p-parking" /></MemoryRouter>);
    await waitFor(() => expect(client.getDeliverables).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  test('a refusal to load is shown, not swallowed into an empty list', async () => {
    client.getDeliverables.mockRejectedValue(new Error('Only this team, its adviser and admins can see its deliverables'));
    await renderList();
    expect(await screen.findByRole('alert')).toHaveTextContent('Only this team, its adviser and admins can see its deliverables');
  });
});

// --- arriving from "Hand it in" ---------------------------------------------------
// Announcements and the deadline banner send students to
// /team#deliverable-<milestone>. The card brings that deliverable into view
// and puts focus on its heading, so nobody scrolls looking for it.

describe('arriving from "Hand it in"', () => {
  const TWO_MILESTONES = [
    deliverable({ milestone_id: 'ms-prop', name: 'Project proposal' }),
    deliverable({ milestone_id: 'ms-final', name: 'Final report' }),
  ];
  let scrolled;
  beforeEach(() => {
    scrolled = [];
    // jsdom has no scrollIntoView; record which element asked, and how.
    Element.prototype.scrollIntoView = vi.fn(function scrollIntoView(options) {
      scrolled.push({ id: this.id, options });
    });
  });

  function renderAt(entry, props = {}) {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Deliverables projectId="p-parking" {...props} />
      </MemoryRouter>
    );
  }

  test('scrolls the named deliverable into view, smoothly, and focuses its heading', async () => {
    client.getDeliverables.mockResolvedValue(TWO_MILESTONES);
    renderAt('/team#deliverable-ms-final');

    await waitFor(() => expect(scrolled).toEqual([{ id: 'deliverable-ms-final', options: { behavior: 'smooth', block: 'start' } }]));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Final report' }));
  });

  test('jumps instead of animating for someone who asked for reduced motion', async () => {
    const original = window.matchMedia;
    window.matchMedia = vi.fn((query) => ({ matches: query.includes('prefers-reduced-motion'), media: query }));
    client.getDeliverables.mockResolvedValue(TWO_MILESTONES);
    renderAt('/team#deliverable-ms-final');
    await waitFor(() => expect(scrolled).toEqual([{ id: 'deliverable-ms-final', options: { behavior: 'auto', block: 'start' } }]));
    window.matchMedia = original;
  });

  test('without a hash, the page stays where it is', async () => {
    client.getDeliverables.mockResolvedValue(TWO_MILESTONES);
    renderAt('/team');
    await screen.findByRole('article', { name: 'Final report' });
    expect(scrolled).toEqual([]);
  });

  test('a refresh after a write does not scroll the page back', async () => {
    // A fresh array each time, as a real refresh returns, so the list really re-renders.
    client.getDeliverables.mockImplementation(async () => TWO_MILESTONES.map((d) => ({ ...d })));
    const user = userEvent.setup();
    renderAt('/team#deliverable-ms-final');
    await waitFor(() => expect(scrolled).toHaveLength(1));

    const finalReport = screen.getByRole('article', { name: 'Final report' });
    await user.type(within(finalReport).getByLabelText('Reply'), 'On it.');
    await user.click(within(finalReport).getByRole('button', { name: 'Post reply' }));
    await waitFor(() => expect(client.getDeliverables).toHaveBeenCalledTimes(2));

    expect(scrolled).toHaveLength(1);
  });

  // The real Team page shows the student's own team and, below it, the teams
  // they advise — the same milestones in both. Only their own card may answer.
  test('with an advised team on the same page, only the student’s own card scrolls', async () => {
    client.getDeliverables.mockResolvedValue(TWO_MILESTONES);
    render(
      <MemoryRouter initialEntries={['/team#deliverable-ms-final']}>
        <Deliverables projectId="p-parking" />
        <Deliverables projectId="p-degree" asAdviser />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getAllByRole('article', { name: 'Final report' })).toHaveLength(2));
    await waitFor(() => expect(scrolled).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(scrolled).toEqual([{ id: 'deliverable-ms-final', options: { behavior: 'smooth', block: 'start' } }]);
  });

  test('the adviser’s view of a team carries no anchors, so it is never the target', async () => {
    client.getDeliverables.mockResolvedValue(TWO_MILESTONES);
    renderAt('/team#deliverable-ms-final', { asAdviser: true });
    await screen.findByRole('article', { name: 'Final report' });
    expect(document.getElementById('deliverable-ms-final')).toBeNull();
    expect(scrolled).toEqual([]);
  });
});
