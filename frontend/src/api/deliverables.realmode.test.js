// Issue #57 — the deliverables calls in REAL mode, against a fake Supabase.
//
// Mock mode proves the components work; it can't prove the calls do. These
// pin what goes over the wire — which bucket, what path, which content type,
// that upsert is off, which RPC with which arguments — and that Storage's
// errors come back as the same sentences mock mode throws
// (deliverables.test.js), so a component can't tell the two apart.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const fake = vi.hoisted(() => {
  const state = {
    uploadError: null,
    signed: { data: { signedUrl: 'https://storage.example/signed?token=t' }, error: null },
    rpcResult: { data: null, error: null },
  };
  const bucket = {
    upload: vi.fn(async () => ({ data: { path: 'x' }, error: state.uploadError })),
    createSignedUrl: vi.fn(async () => state.signed),
  };
  const supabase = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'u-me' } } } })) },
    storage: { from: vi.fn(() => bucket) },
    rpc: vi.fn(async () => state.rpcResult),
  };
  return { state, bucket, supabase };
});

vi.mock('../lib/supabaseClient', () => ({ supabase: fake.supabase }));

// USE_MOCKS is read once at import, so the env is set before importing.
async function realMode() {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  return import('./client');
}

function fileOf(name, size = 2048, type = '') {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const P = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.clearAllMocks();
  fake.state.uploadError = null;
  fake.state.signed = { data: { signedUrl: 'https://storage.example/signed?token=t' }, error: null };
  fake.state.rpcResult = { data: { id: 'ds-1', version: 1, is_late: false }, error: null };
});

describe('submitting a file', () => {
  test('uploads to the deliverables bucket under <project>/<milestone>/<uuid>.<ext>, then submits that path', async () => {
    const { submitDeliverable } = await realMode();
    await submitDeliverable(P, M, { file: fileOf('  Final Report.DOCX ', 5000) });

    expect(fake.supabase.storage.from).toHaveBeenCalledWith('deliverables');
    expect(fake.bucket.upload).toHaveBeenCalledTimes(1);
    const [path, body, options] = fake.bucket.upload.mock.calls[0];
    // Exactly the shape the upload policy's regex accepts: lower-case uuids
    // and a lower-case extension.
    expect(path).toMatch(
      new RegExp(`^${P}/${M}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.docx$`)
    );
    expect(body).toBeInstanceOf(File);
    // The type comes from the extension: this File's own type is '', which
    // the bucket's allowed_mime_types would refuse.
    expect(options).toEqual({
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: false,
    });

    expect(fake.supabase.rpc).toHaveBeenCalledWith('submit_deliverable', {
      p_project_id: P,
      p_milestone_id: M,
      p_file_path: path,
      p_file_name: 'Final Report.DOCX',
    });
  });

  test('a file the browser rejects is never uploaded', async () => {
    const { submitDeliverable } = await realMode();
    await expect(submitDeliverable(P, M, { file: fileOf('setup.exe') })).rejects.toThrow('Upload a PDF, DOCX or PPTX file');
    await expect(submitDeliverable(P, M, { file: fileOf('big.pdf', 25 * 1024 * 1024 + 1) })).rejects.toThrow(
      'Files can be at most 25 MB'
    );
    expect(fake.bucket.upload).not.toHaveBeenCalled();
    expect(fake.supabase.rpc).not.toHaveBeenCalled();
  });

  test.each([
    [{ statusCode: '403', message: 'new row violates row-level security policy' },
      'That upload was refused — only this team can upload, and only for a milestone that takes a deliverable'],
    [{ statusCode: '413', message: 'The object exceeded the maximum allowed size' }, 'Files can be at most 25 MB'],
    [{ statusCode: '400', message: 'mime type application/zip is not supported' }, 'Upload a PDF, DOCX or PPTX file'],
    [{ statusCode: '500', message: 'Internal Server Error' }, "The file didn't upload. Check your connection and try again."],
  ])('a Storage refusal %o reads as %s, and nothing is submitted', async (error, sentence) => {
    fake.state.uploadError = error;
    const { submitDeliverable } = await realMode();
    await expect(submitDeliverable(P, M, { file: fileOf('Proposal.pdf') })).rejects.toThrow(sentence);
    expect(fake.supabase.rpc).not.toHaveBeenCalled();
  });

  test('a refusal from submit_deliverable() comes back with the database sentence', async () => {
    fake.state.rpcResult = { data: null, error: { message: 'Files can be at most 25 MB', code: 'P0001' } };
    const { submitDeliverable } = await realMode();
    await expect(submitDeliverable(P, M, { file: fileOf('Proposal.pdf') })).rejects.toMatchObject({
      message: 'Files can be at most 25 MB',
    });
  });
});

describe('submitting a link', () => {
  test('goes straight to submit_deliverable(), trimmed, with no upload', async () => {
    const { submitDeliverable } = await realMode();
    await submitDeliverable(P, M, { link: '  https://docs.example.edu/proposal ' });
    expect(fake.bucket.upload).not.toHaveBeenCalled();
    expect(fake.supabase.rpc).toHaveBeenCalledWith('submit_deliverable', {
      p_project_id: P,
      p_milestone_id: M,
      p_link_url: 'https://docs.example.edu/proposal',
    });
  });
});

describe('reading', () => {
  test('getDeliverables() is one call to project_deliverables(), with no table embed to get wrong', async () => {
    fake.state.rpcResult = { data: [{ milestone_id: M, status: 'submitted', versions: [], comments: [] }], error: null };
    const { getDeliverables } = await realMode();
    const list = await getDeliverables(P);
    expect(fake.supabase.rpc).toHaveBeenCalledWith('project_deliverables', { p_project_id: P });
    expect(list).toEqual([{ milestone_id: M, status: 'submitted', versions: [], comments: [] }]);
  });

  const VERSIONS = [
    { id: 'v2', kind: 'file', file_path: `${P}/${M}/abc.pdf`, file_name: 'Proposal.pdf' },
    { id: 'v1', kind: 'link', file_path: null, file_name: null, link_url: 'https://docs.example.edu/x' },
  ];

  test('download links are minted up front, one per stored file, named after the original file', async () => {
    const { getDeliverableFileUrls, DELIVERABLE_LINK_TTL_SECONDS } = await realMode();
    const links = await getDeliverableFileUrls(VERSIONS);
    expect(fake.bucket.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(fake.bucket.createSignedUrl).toHaveBeenCalledWith(`${P}/${M}/abc.pdf`, DELIVERABLE_LINK_TTL_SECONDS, {
      download: 'Proposal.pdf',
    });
    // A link version has nothing in the bucket, so nothing is minted for it.
    expect(links).toEqual({ v2: 'https://storage.example/signed?token=t' });
  });

  test('a refused file maps to null — the same answer whether it is missing or not yours', async () => {
    fake.state.signed = { data: null, error: { statusCode: '400', message: 'Object not found' } };
    const { getDeliverableFileUrls } = await realMode();
    await expect(getDeliverableFileUrls(VERSIONS)).resolves.toEqual({ v2: null });
  });
});

describe('writing', () => {
  test('a comment is sent normalised to post_deliverable_comment()', async () => {
    const { postDeliverableComment } = await realMode();
    await postDeliverableComment(P, M, '  Moved the budget.\r\nSee p. 4  ');
    expect(fake.supabase.rpc).toHaveBeenCalledWith('post_deliverable_comment', {
      p_project_id: P,
      p_milestone_id: M,
      p_body: 'Moved the budget.\nSee p. 4',
    });
  });

  test('a review goes to review_deliverable() with the version it is about, and a normalised note', async () => {
    const { reviewDeliverable } = await realMode();
    await reviewDeliverable(P, M, 4, 'changes_requested', '  Split the risks.\r\n ');
    expect(fake.supabase.rpc).toHaveBeenCalledWith('review_deliverable', {
      p_project_id: P,
      p_milestone_id: M,
      p_version: 4,
      p_decision: 'changes_requested',
      p_body: 'Split the risks.',
    });
  });

  test('a review the browser can see is incomplete never reaches the database', async () => {
    const { reviewDeliverable } = await realMode();
    await expect(reviewDeliverable(P, M, 4, 'changes_requested', '  ')).rejects.toThrow('Say what needs to change');
    await expect(reviewDeliverable(P, M, 4, 'rejected')).rejects.toThrow('Choose Approved or Changes requested');
    expect(fake.supabase.rpc).not.toHaveBeenCalled();
  });

  test('the database refusing a review comes back with its sentence', async () => {
    fake.state.rpcResult = { data: null, error: { message: "Only the project's adviser can approve or request changes" } };
    const { reviewDeliverable } = await realMode();
    await expect(reviewDeliverable(P, M, 4, 'approved')).rejects.toMatchObject({
      message: "Only the project's adviser can approve or request changes",
    });
  });

  test('the admin switch calls set_milestone_requires_deliverable()', async () => {
    const { setMilestoneRequiresDeliverable } = await realMode();
    await setMilestoneRequiresDeliverable(M, true);
    expect(fake.supabase.rpc).toHaveBeenCalledWith('set_milestone_requires_deliverable', { p_id: M, p_requires: true });
  });
});
