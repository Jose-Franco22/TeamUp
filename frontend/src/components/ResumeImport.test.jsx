// Issue #19 — UI tests for importing skills from a resume.
//
// The whole point of this feature is that nothing is uploaded and nothing is
// saved until the student says so, so most of these tests are about what
// *doesn't* happen: no write before Add, no write on Cancel, no write for a
// file we can't read.
//
// A .txt resume is used throughout. The parser treats it exactly like a PDF
// once the text is out, and it avoids dragging pdf.js and a worker into jsdom
// for no extra coverage — the format readers are tested in resume-parsing/.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ResumeImport from './ResumeImport';
import * as client from '../api/client';
import { skills as SKILL_TABLE } from '../api/mockData';

vi.mock('../api/client', () => ({
  getSkills: vi.fn(),
  addResumeSkills: vi.fn(),
}));

const RESUME = `Nicolas Guerra
nguerra01@utrgv.edu

SKILLS
Languages: Python, JavaScript
Frameworks: React, Node.js
Tools: Git, Jest

EXPERIENCE
Undergraduate Research Assistant, Jan 2025 - Present
Built a computer vision pipeline with OpenCV and pandas for a camera feed
project that ran on campus for a full semester.
Shipped a React dashboard the department still uses every week.

PROJECTS
Parking tracker, 2024
Used PostgreSQL and Express to serve lot occupancy to a React front end.
`;

const file = (name, contents = RESUME, type = 'text/plain') =>
  new File([contents], name, { type });

beforeEach(() => {
  // The mocks come from a module factory, so their call history outlives a
  // test unless it is cleared here — `restoreMocks` only restores spies.
  vi.clearAllMocks();
  client.getSkills.mockResolvedValue(SKILL_TABLE);
  client.addResumeSkills.mockResolvedValue({ id: 'u-nicolas', skills: [] });
});

// The input is hidden and aria-hidden on purpose — the visible control is the
// button that clicks it — so it is reached through the DOM rather than by
// label, the same way a real file picker reaches it.
function renderImport(props = {}) {
  const view = render(<ResumeImport {...props} />);
  return { ...view, input: view.container.querySelector('input[type="file"]') };
}

// userEvent.upload() refuses a hidden input, and this one is hidden on
// purpose — the visible control is the button that clicks it. Firing the
// change event directly is what the real file picker does anyway.
function choose(input, theFile) {
  fireEvent.change(input, { target: { files: [theFile] } });
}

async function importFile(input, theFile) {
  choose(input, theFile);
  return waitFor(() => expect(screen.getByText(/characters read in this browser/)).toBeInTheDocument());
}

// --- the review step -----------------------------------------------------

describe('reviewing what was found', () => {
  test('lists detected skills to confirm, and saves nothing yet', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is saved until you choose Add/)).toBeInTheDocument();
    expect(client.addResumeSkills).not.toHaveBeenCalled();
  });

  test('says the file was read in this browser, with a character count', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));
    expect(screen.getByText(/resume\.txt · [\d,]+ characters read in this browser/)).toBeInTheDocument();
  });

  test('everything found is ticked by default, so Add is ready', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(1);
    expect(boxes.every((box) => box.checked)).toBe(true);
    expect(screen.getByRole('button', { name: /^Add \d+ skills?$/ })).toBeEnabled();
  });

  test('skills already on the profile are listed apart, not offered again', async () => {
    const user = userEvent.setup();
    const { input } = renderImport({ mySkills: [{ id: 's-react', name: 'React' }] });
    await importFile(input, file('resume.txt'));

    expect(screen.getByText(/Already on your profile: React/)).toBeInTheDocument();
    const labels = screen.getAllByRole('checkbox').map((box) => box.closest('label').textContent);
    expect(labels.some((text) => text.startsWith('React'))).toBe(false);
  });
});

// --- confirming ----------------------------------------------------------

describe('confirming', () => {
  test('unticking one and confirming sends only the ticked ids', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    const react = screen.getByText('React').closest('label').querySelector('input');
    await user.click(react);
    expect(react).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /^Add \d+ skills?$/ }));

    await waitFor(() => expect(client.addResumeSkills).toHaveBeenCalledTimes(1));
    const [ids] = client.addResumeSkills.mock.calls[0];
    expect(ids).not.toContain('s-react');
    expect(ids).toContain('s-python');
  });

  test('sends the evidence behind each skill, not just the ids', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));
    await user.click(screen.getByRole('button', { name: /^Add \d+ skills?$/ }));

    await waitFor(() => expect(client.addResumeSkills).toHaveBeenCalled());
    const [, evidence] = client.addResumeSkills.mock.calls[0];
    expect(evidence.length).toBeGreaterThan(0);
    for (const row of evidence) {
      expect(row).toHaveProperty('skill_id');
      expect(row).toHaveProperty('months');
      expect(row).toHaveProperty('projects');
      expect(row).toHaveProperty('quote');
    }
  });

  test('reports what was added and hands the updated profile back', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    const updated = { id: 'u-nicolas', skills: [{ id: 's-react' }] };
    client.addResumeSkills.mockResolvedValue(updated);

    const { input } = renderImport({ onImported });
    await importFile(input, file('resume.txt'));
    await user.click(screen.getByRole('button', { name: /^Add \d+ skills?$/ }));

    expect(await screen.findByRole('status')).toHaveTextContent(/Added \d+ skills? from resume\.txt\./);
    expect(onImported).toHaveBeenCalledWith(updated);
    // The panel closes, so the same import cannot be submitted twice.
    expect(screen.queryByText(/characters read in this browser/)).not.toBeInTheDocument();
  });

  test('unticking everything disables Add rather than saving nothing', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    for (const box of screen.getAllByRole('checkbox')) await user.click(box);
    expect(screen.getByRole('button', { name: /^Add 0 skills$/ })).toBeDisabled();
    expect(client.addResumeSkills).not.toHaveBeenCalled();
  });
});

// --- cancelling ----------------------------------------------------------

describe('cancelling', () => {
  test('saves nothing and clears the review', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/characters read in this browser/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing is saved until/)).not.toBeInTheDocument();
    expect(client.addResumeSkills).not.toHaveBeenCalled();
  });

  test('the same file can be chosen again afterwards', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await importFile(input, file('resume.txt'));
    expect(screen.getByText('React')).toBeInTheDocument();
  });
});

// --- files we cannot read ------------------------------------------------

describe('a file that cannot be read', () => {
  test.each([
    ['resume.png', /can't read \.png files/i],
    ['budget.xlsx', /can't read \.xlsx files/i],
    ['deck.pptx', /can't read \.pptx files/i],
  ])('%s is refused with a message naming the formats that work', async (name, pattern) => {
    const user = userEvent.setup();
    const { input } = renderImport();
    choose(input, file(name, 'not really a resume'));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(pattern);
    expect(error).toHaveTextContent(/PDF/);
    expect(client.addResumeSkills).not.toHaveBeenCalled();
  });

  test('an unreadable file never reaches the review step', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    choose(input, file('resume.png', 'x'));

    await screen.findByRole('alert');
    expect(screen.queryByText(/characters read in this browser/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import from resume' })).toBeEnabled();
  });

  test('an empty file says so', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    choose(input, file('resume.txt', ''));
    expect(await screen.findByRole('alert')).toHaveTextContent(/empty/i);
  });

  test('a file over the size limit is refused before it is read', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    choose(input, file('resume.txt', 'x'.repeat(9 * 1024 * 1024)));

    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(/9 MB/);
    expect(error).toHaveTextContent(/under 8 MB/);
    expect(client.addResumeSkills).not.toHaveBeenCalled();
  });

  test('a file with almost no text is reported, not silently empty', async () => {
    const user = userEvent.setup();
    const { input } = renderImport();
    // Deliberately mentions no skill the catalog knows, so this exercises the
    // "we read it and found nothing" path rather than the "we found React"
    // one. 'React' alone would still be a hit.
    await importFile(input, file('resume.txt', 'A short note, nothing else.'));
    expect(screen.getByText(/holds almost no text/i)).toBeInTheDocument();
    expect(screen.getByText(/Nothing to suggest from this file/)).toBeInTheDocument();
  });
});

// --- the server having a bad day ----------------------------------------

describe('when the server fails', () => {
  test('the skills table failing to load is reported, and nothing is saved', async () => {
    const user = userEvent.setup();
    client.getSkills.mockRejectedValue(new Error('Network down'));
    const { input } = renderImport();
    choose(input, file('resume.txt'));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Network down/);
    expect(client.addResumeSkills).not.toHaveBeenCalled();
  });

  test('a failed save keeps the review on screen so nothing is retyped', async () => {
    const user = userEvent.setup();
    client.addResumeSkills.mockRejectedValue(new Error('row level security'));
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    const add = screen.getByRole('button', { name: /^Add \d+ skills?$/ });
    await user.click(add);

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i);
    expect(screen.getByText(/characters read in this browser/)).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox').some((box) => box.checked)).toBe(true);
  });

  test('an empty skills table says matching is not set up, rather than finding nothing', async () => {
    const user = userEvent.setup();
    client.getSkills.mockResolvedValue([]);
    const { input } = renderImport();
    await importFile(input, file('resume.txt'));

    expect(screen.getByText(/No skills are set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

// --- terms the catalog does not have -------------------------------------

describe('terms TeamUp does not know', () => {
  test('are shown as unaddable rather than silently dropped', async () => {
    const { input } = renderImport();
    await importFile(
      input,
      file(
        'resume.txt',
        `${RESUME}\nSKILLS\nTools: Kubernetes, Terraform, Grafana, Python, React, Git, Jest\n`
      )
    );

    const note = screen.getByText(/cannot be added yet/);
    expect(note).toHaveTextContent(/Kubernetes/);
    expect(note).toHaveTextContent(/Terraform/);
    // Known skills are offered as checkboxes, so they must not also appear
    // in the "we don't have these" list.
    expect(note).not.toHaveTextContent(/React/);
  });
});
