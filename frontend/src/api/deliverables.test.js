// Issue #57 — the deliverables half of client.js, in MOCK mode.
//
// Mock mode is what every component test and the dev build run against, so
// it has to refuse what the database refuses, with the same sentences
// (supabase/45_milestone_deliverables.sql). A mock that let another team read
// a submission would let a component test pass against a rule production
// doesn't have. deliverables.realmode.test.js covers the Supabase calls.
//
// Fixtures from mockData.js: p-parking's team is Nicolas and Jose, with Dana
// as its accepted adviser; Alexis is on p-degree, whose adviser (Luis) is
// only invited; Sofia is on no team; u-instructor is an admin.
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  getDeliverableFileUrls,
  getDeliverables,
  postDeliverableComment,
  reviewDeliverable,
  setMilestoneRequiresDeliverable,
  setSessionUserId,
  submitDeliverable,
} from './client';
import { adviserRequests, deliverableComments, deliverableFiles, deliverableSubmissions, milestones, notifications } from './mockData';
import { DELIVERABLE_MAX_BYTES, TOO_LARGE, WRONG_TYPE } from '../lib/deliverables';

const PDF = 'application/pdf';
const DAY = 24 * 60 * 60 * 1000;

function fileOf(name, size = 2048, type = PDF) {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

function as(userId) {
  setSessionUserId(userId);
}

beforeEach(() => {
  milestones.length = 0;
  deliverableSubmissions.length = 0;
  deliverableComments.length = 0;
  deliverableFiles.clear();
  notifications.length = 0;
  milestones.push(
    { id: 'ms-prop', name: 'Proposal', due_at: new Date(Date.now() + 7 * DAY).toISOString(), is_formation_deadline: false, message: '', requires_deliverable: true },
    { id: 'ms-report', name: 'Status report', due_at: new Date(Date.now() - DAY).toISOString(), is_formation_deadline: false, message: '', requires_deliverable: true },
    { id: 'ms-demo', name: 'Demo day', due_at: new Date(Date.now() + 30 * DAY).toISOString(), is_formation_deadline: false, message: '' }
  );
});
afterEach(() => {
  setSessionUserId(null);
  // Some cases add an accepted adviser to p-degree; mockData is shared.
  for (let i = adviserRequests.length - 1; i >= 0; i -= 1) {
    if (adviserRequests[i].id === 'ar-test') adviserRequests.splice(i, 1);
  }
});

describe('submitting and resubmitting', () => {
  test('a link, then a file: two versions, and the first is untouched', async () => {
    as('u-jose');
    const first = await submitDeliverable('p-parking', 'ms-prop', { link: '  https://docs.example.edu/draft ' });
    as('u-nicolas');
    const second = await submitDeliverable('p-parking', 'ms-prop', { file: fileOf('Proposal v2.pdf', 1048576) });

    expect([first.version, second.version]).toEqual([1, 2]);
    const proposal = (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-prop');
    expect(proposal.status).toBe('submitted');
    expect(proposal.versions.map((v) => v.version)).toEqual([2, 1]);
    expect(proposal.versions[1]).toMatchObject({
      kind: 'link',
      link_url: 'https://docs.example.edu/draft',
      submitted_by: 'u-jose',
      submitted_by_name: 'Jose Franco Garza',
    });
    expect(proposal.versions[0]).toMatchObject({
      kind: 'file',
      file_name: 'Proposal v2.pdf',
      file_size: 1048576,
      file_type: 'pdf',
      link_url: null,
    });
    // Stored under a random name in the team's own folder, as the upload
    // policy requires; the original name is only on the version.
    expect(proposal.versions[0].file_path).toMatch(/^p-parking\/ms-prop\/[0-9a-f-]{36}\.pdf$/);
  });

  test('versions are counted per team', async () => {
    as('u-jose');
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://a.example.edu/1' });
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://a.example.edu/2' });
    as('u-alexis');
    const theirs = await submitDeliverable('p-degree', 'ms-prop', { link: 'https://b.example.edu/1' });
    expect(theirs.version).toBe(1);
  });

  test('every milestone that takes a deliverable is listed in due order, and only those', async () => {
    as('u-jose');
    const list = await getDeliverables('p-parking');
    expect(list.map((d) => d.name)).toEqual(['Status report', 'Proposal']);
    expect(list.every((d) => d.status === 'not_submitted' && d.versions.length === 0)).toBe(true);
  });
});

describe('late', () => {
  test('after the due date it is accepted, and marked late', async () => {
    as('u-jose');
    const row = await submitDeliverable('p-parking', 'ms-report', { link: 'https://docs.example.edu/status' });
    expect(row.is_late).toBe(true);
    const report = (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-report');
    expect(report.is_late).toBe(true);
  });

  test('before it, not late', async () => {
    as('u-jose');
    const row = await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/p' });
    expect(row.is_late).toBe(false);
  });
});

describe('who may submit', () => {
  test('another team is refused, for a link and for a file, and nothing is written', async () => {
    as('u-alexis');
    await expect(submitDeliverable('p-parking', 'ms-prop', { link: 'https://x.example.com/y' })).rejects.toThrow(
      'Only members of this team can submit its deliverables'
    );
    // A file is refused at the upload, the way the Storage policy refuses it.
    await expect(submitDeliverable('p-parking', 'ms-prop', { file: fileOf('x.pdf') })).rejects.toThrow(
      'That upload was refused — only this team can upload, and only for a milestone that takes a deliverable'
    );
    expect(deliverableSubmissions).toHaveLength(0);
    expect(deliverableFiles.size).toBe(0);
  });

  test('a student on no team, and an admin, are refused', async () => {
    as('u-sofia');
    await expect(submitDeliverable('p-parking', 'ms-prop', { link: 'https://x.example.com/y' })).rejects.toThrow(
      'Only members of this team can submit its deliverables'
    );
    as('u-instructor');
    await expect(submitDeliverable('p-parking', 'ms-prop', { link: 'https://x.example.com/y' })).rejects.toThrow(
      'Only members of this team can submit its deliverables'
    );
    expect(deliverableSubmissions).toHaveLength(0);
  });

  // The upload policy is its own gate: an admin's file has to be refused
  // there, before anything is stored, not just at the submission after it.
  test('an admin’s file is refused at the upload and never stored', async () => {
    as('u-instructor');
    await expect(submitDeliverable('p-parking', 'ms-prop', { file: fileOf('x.pdf') })).rejects.toThrow(
      'That upload was refused — only this team can upload, and only for a milestone that takes a deliverable'
    );
    expect(deliverableFiles.size).toBe(0);
    expect(deliverableSubmissions).toHaveLength(0);
  });

  test('only an admin can mark a milestone as needing a deliverable', async () => {
    as('u-jose');
    await expect(setMilestoneRequiresDeliverable('ms-demo', true)).rejects.toThrow('Admin access required');
    expect(milestones.find((m) => m.id === 'ms-demo').requires_deliverable).toBeUndefined();
    as('u-instructor');
    await expect(setMilestoneRequiresDeliverable('ms-demo', true)).resolves.toMatchObject({ requires_deliverable: true });
  });

  test('a milestone that takes no deliverable is refused', async () => {
    as('u-jose');
    await expect(submitDeliverable('p-parking', 'ms-demo', { link: 'https://x.example.com/y' })).rejects.toThrow(
      "This milestone doesn't take a deliverable"
    );
  });
});

describe('what may be submitted', () => {
  test('a wrong type or an oversized file never reaches the bucket', async () => {
    as('u-jose');
    await expect(submitDeliverable('p-parking', 'ms-prop', { file: fileOf('notes.txt', 100, 'text/plain') })).rejects.toThrow(WRONG_TYPE);
    await expect(submitDeliverable('p-parking', 'ms-prop', { file: fileOf('big.pdf', DELIVERABLE_MAX_BYTES + 1) })).rejects.toThrow(TOO_LARGE);
    expect(deliverableFiles.size).toBe(0);
    expect(deliverableSubmissions).toHaveLength(0);
  });

  test('exactly 25 MB is accepted, as DOCX and PPTX are', async () => {
    as('u-jose');
    await submitDeliverable('p-parking', 'ms-prop', { file: fileOf('deck.pptx', DELIVERABLE_MAX_BYTES, '') });
    await submitDeliverable('p-parking', 'ms-prop', { file: fileOf('Report.DOCX', 5000, '') });
    expect(deliverableSubmissions.map((s) => s.file_type)).toEqual(['pptx', 'docx']);
    // Sent as the type its extension says, not the browser's empty guess.
    expect([...deliverableFiles.values()].map((f) => f.mimetype)).toEqual([
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);
  });

  test('a file and a link together, or neither, are refused', async () => {
    as('u-jose');
    await expect(
      submitDeliverable('p-parking', 'ms-prop', { file: fileOf('a.pdf'), link: 'https://x.example.com/y' })
    ).rejects.toThrow('Submit a file or a link, not both');
    await expect(submitDeliverable('p-parking', 'ms-prop', {})).rejects.toThrow('Choose a file or paste a link');
  });

  test('a javascript: link is refused', async () => {
    as('u-jose');
    await expect(submitDeliverable('p-parking', 'ms-prop', { link: 'javascript:alert(1)' })).rejects.toThrow(
      'Paste a full link that starts with http:// or https://'
    );
  });
});

describe('who can see a team’s submissions and files', () => {
  async function seed() {
    as('u-nicolas');
    const row = await submitDeliverable('p-parking', 'ms-prop', { file: fileOf('Proposal.pdf') });
    await postDeliverableComment('p-parking', 'ms-prop', 'Budget is in section 4.');
    return row;
  }
  const link = async (row) => (await getDeliverableFileUrls([row]))[row.id];

  test('the team reads its deliverables and gets a download link for its file', async () => {
    const row = await seed();
    as('u-jose');
    const proposal = (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-prop');
    expect(proposal.versions).toHaveLength(1);
    expect(proposal.comments.map((c) => c.body)).toEqual(['Budget is in section 4.']);
    expect(await link(row)).toMatch(/^blob:/);
  });

  test('another team, and a student on no team, are refused both', async () => {
    const row = await seed();
    for (const outsider of ['u-alexis', 'u-sofia']) {
      as(outsider);
      await expect(getDeliverables('p-parking')).rejects.toThrow(
        'Only this team, its adviser and admins can see its deliverables'
      );
      expect(await link(row)).toBeNull();
    }
  });

  test('an admin can read and download', async () => {
    const row = await seed();
    as('u-instructor');
    const proposal = (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-prop');
    expect(proposal.versions).toHaveLength(1);
    expect(await link(row)).toMatch(/^blob:/);
  });

  test('the project’s accepted adviser can read and download', async () => {
    const row = await seed();
    as('u-dana');
    const proposal = (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-prop');
    expect(proposal.versions).toHaveLength(1);
    expect(await link(row)).toMatch(/^blob:/);
  });

  test('the adviser of another project, and one only invited, can do neither', async () => {
    const row = await seed();
    adviserRequests.push({ id: 'ar-test', project_id: 'p-degree', adviser_id: 'u-priya', invited_by: 'u-alexis', status: 'accepted' });
    for (const notTheirs of ['u-priya', 'u-luis']) {
      as(notTheirs);
      await expect(getDeliverables('p-parking')).rejects.toThrow(
        'Only this team, its adviser and admins can see its deliverables'
      );
      expect(await link(row)).toBeNull();
    }
    // u-luis is only invited to p-degree, so not even that one opens up.
    as('u-luis');
    await expect(getDeliverables('p-degree')).rejects.toThrow(
      'Only this team, its adviser and admins can see its deliverables'
    );
  });

  test('a path nobody uploaded reads the same as one you may not see', async () => {
    as('u-jose');
    const ghost = { id: 'v-ghost', kind: 'file', file_path: 'p-parking/ms-prop/nope.pdf', file_name: 'nope.pdf' };
    expect(await getDeliverableFileUrls([ghost])).toEqual({ 'v-ghost': null });
  });
});

describe('the thread', () => {
  test('a member replies; the comment is trimmed and tied to the newest version', async () => {
    as('u-jose');
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/1' });
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/2' });
    await postDeliverableComment('p-parking', 'ms-prop', '  Moved the budget.\r\n ');
    const proposal = (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-prop');
    expect(proposal.comments).toEqual([
      expect.objectContaining({ body: 'Moved the budget.', author_name: 'Jose Franco Garza', version: 2, decision: null }),
    ]);
  });

  test('another team cannot comment, and an empty comment is refused', async () => {
    as('u-alexis');
    await expect(postDeliverableComment('p-parking', 'ms-prop', 'Nice')).rejects.toThrow(
      'Only this team and its adviser can comment on its deliverables'
    );
    as('u-jose');
    await expect(postDeliverableComment('p-parking', 'ms-prop', ' \n ')).rejects.toThrow('Write a comment first');
    expect(deliverableComments).toHaveLength(0);
  });

  test('the adviser comments, and the whole team is told; a member replying tells nobody', async () => {
    as('u-dana');
    await postDeliverableComment('p-parking', 'ms-prop', 'Add the camera costs.');
    expect(notifications.filter((n) => n.kind === 'deliverable_feedback').map((n) => n.user_id).sort()).toEqual([
      'u-jose',
      'u-nicolas',
    ]);
    as('u-jose');
    await postDeliverableComment('p-parking', 'ms-prop', 'On it.');
    expect(notifications.filter((n) => n.kind === 'deliverable_feedback')).toHaveLength(2);
  });
});

describe('the adviser’s review', () => {
  async function twoVersions() {
    as('u-jose');
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/1' });
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/2' });
  }
  const proposal = async () => (await getDeliverables('p-parking')).find((d) => d.milestone_id === 'ms-prop');

  test('only the project’s adviser can decide — not a member, the owner, an admin, or another project’s adviser', async () => {
    await twoVersions();
    adviserRequests.push({ id: 'ar-test', project_id: 'p-degree', adviser_id: 'u-priya', invited_by: 'u-alexis', status: 'accepted' });
    for (const who of ['u-jose', 'u-nicolas', 'u-instructor', 'u-priya', 'u-luis']) {
      as(who);
      await expect(reviewDeliverable('p-parking', 'ms-prop', 2, 'approved')).rejects.toThrow(
        "Only the project's adviser can approve or request changes"
      );
    }
    as('u-jose');
    expect((await proposal()).status).toBe('submitted');
    expect(notifications.filter((n) => n.kind === 'deliverable_feedback')).toEqual([]);
  });

  test('Changes requested needs a note, and a stale version is refused', async () => {
    await twoVersions();
    as('u-dana');
    await expect(reviewDeliverable('p-parking', 'ms-prop', 2, 'changes_requested', ' ')).rejects.toThrow(
      'Say what needs to change'
    );
    await expect(reviewDeliverable('p-parking', 'ms-prop', 1, 'approved')).rejects.toThrow(
      'A newer version has been submitted since — review that one'
    );
    await expect(reviewDeliverable('p-parking', 'ms-final-missing', 2, 'approved')).rejects.toThrow('Milestone not found');
  });

  test('nothing submitted means nothing to review', async () => {
    as('u-dana');
    await expect(reviewDeliverable('p-parking', 'ms-prop', 1, 'approved')).rejects.toThrow(
      'Nothing has been submitted to review yet'
    );
  });

  test('the adviser requests changes, then approves the resubmission; the team hears each time', async () => {
    await twoVersions();
    as('u-dana');
    await reviewDeliverable('p-parking', 'ms-prop', 2, 'changes_requested', 'Split the risks by owner.');
    let p = await proposal();
    expect(p.status).toBe('changes_requested');
    expect(p.versions.map((v) => [v.version, v.status])).toEqual([[2, 'changes_requested'], [1, 'submitted']]);
    expect(p.comments.at(-1)).toMatchObject({ decision: 'changes_requested', body: 'Split the risks by owner.', version: 2 });

    as('u-jose');
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/3' });
    expect((await proposal()).status).toBe('submitted');

    as('u-dana');
    await reviewDeliverable('p-parking', 'ms-prop', 3, 'approved');
    p = await proposal();
    expect(p.status).toBe('approved');
    expect(p.comments.at(-1)).toMatchObject({ decision: 'approved', body: '', version: 3 });
    expect(notifications.filter((n) => n.kind === 'deliverable_feedback')).toHaveLength(4);
  });
});

describe('notifications', () => {
  test('the accepted adviser is told when the team submits', async () => {
    as('u-jose');
    await submitDeliverable('p-parking', 'ms-prop', { link: 'https://docs.example.edu/p' });
    expect(notifications).toEqual([
      expect.objectContaining({ user_id: 'u-dana', kind: 'deliverable_submitted', project_id: 'p-parking', actor_id: 'u-jose' }),
    ]);
  });

  test('a pending adviser is not, and a refused submission tells nobody', async () => {
    as('u-alexis');
    await submitDeliverable('p-degree', 'ms-prop', { link: 'https://docs.example.edu/p' });
    as('u-jose');
    await expect(submitDeliverable('p-parking', 'ms-demo', { link: 'https://x.example.com/y' })).rejects.toThrow();
    expect(notifications.filter((n) => n.kind === 'deliverable_submitted')).toEqual([]);
  });
});
