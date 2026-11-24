// Issue #40 — the button, and the file it hands you.
//
// rosterWorkbook.test.js checks what is in the cells. This checks the part
// a user touches: that pressing the button produces a download with the
// dated name the issue asks for, that it says so while it works, and that a
// refusal lands on screen instead of nothing happening.
//
// jsdom does not download anything, so the test watches the two browser
// calls that a download is made of — createObjectURL and the anchor's
// click — rather than pretending to inspect a saved file.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ExportRosters from './ExportRosters';
import * as client from '../api/client';

const EXPORT = {
  scope: 'admin',
  teams: [
    {
      team_id: 't-a',
      team_name: 'Campus parking tracker',
      status: 'open',
      owner_name: 'Olivia Owner',
      owner_email: 'olivia@utrgv.edu',
      member_count: 2,
      team_size_target: 4,
      adviser_status: 'none',
      adviser_name: null,
      adviser_email: null,
      github_repo: '',
    },
  ],
  members: [],
  unplaced_students: [],
};

let clicked;
let revoked;

beforeEach(() => {
  clicked = [];
  revoked = [];
  // jsdom has neither of these.
  URL.createObjectURL = vi.fn(() => 'blob:fake-url');
  URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
  // Catch the anchor at the moment it is clicked, which is the only place
  // the filename and the href exist together.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function record() {
    clicked.push({ download: this.download, href: this.href });
  });
  vi.spyOn(client, 'exportRosters').mockResolvedValue(EXPORT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the export button', () => {
  test('is offered by its name from the issue', () => {
    render(<ExportRosters />);
    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeInTheDocument();
  });

  // THE CRITERION: a .xlsx with the dated filename.
  test('downloads teamup-teams-<today>.xlsx', async () => {
    const user = userEvent.setup();
    render(<ExportRosters />);

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));

    await waitFor(() => expect(clicked).toHaveLength(1));
    const today = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    expect(clicked[0].download).toBe(`teamup-teams-${stamp}.xlsx`);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  test('and the blob it hands over is a spreadsheet, not an empty file', async () => {
    const user = userEvent.setup();
    render(<ExportRosters />);

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = URL.createObjectURL.mock.calls[0][0];
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(blob.size).toBeGreaterThan(0);
  });

  // The URL pins the whole workbook in memory until it is revoked, and an
  // instructor exports more than once.
  test('releases the object URL afterwards', async () => {
    const user = userEvent.setup();
    render(<ExportRosters />);

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));

    await waitFor(() => expect(revoked).toEqual(['blob:fake-url']));
  });

  test('says it is working, so a slow export does not look dead', async () => {
    let release;
    client.exportRosters.mockReturnValue(new Promise((resolve) => { release = () => resolve(EXPORT); }));
    const user = userEvent.setup();
    render(<ExportRosters />);

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));

    const button = await screen.findByRole('button', { name: 'Preparing…' });
    expect(button).toBeDisabled();
    release();
    await screen.findByRole('button', { name: 'Export to Excel' });
  });

  // A failed export has nothing to show — no half-written file — so the
  // only useful thing is the reason, beside the button that did nothing.
  test('a refusal lands on screen rather than failing silently', async () => {
    client.exportRosters.mockRejectedValue(
      new Error('Only an admin or an adviser can export rosters')
    );
    const user = userEvent.setup();
    render(<ExportRosters />);

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only an admin or an adviser can export rosters'
    );
    expect(clicked).toHaveLength(0);
  });

  test('and the button comes back so it can be tried again', async () => {
    client.exportRosters.mockRejectedValueOnce(new Error('Network down'));
    const user = userEvent.setup();
    render(<ExportRosters />);

    await user.click(screen.getByRole('button', { name: 'Export to Excel' }));
    await screen.findByRole('alert');

    const button = screen.getByRole('button', { name: 'Export to Excel' });
    expect(button).not.toBeDisabled();
    await user.click(button);
    await waitFor(() => expect(clicked).toHaveLength(1));
  });

  // #56's Advising dashboard shows the same button with its own wording.
  // export_rosters() narrows the rows by who is asking, so nothing else
  // about it changes.
  test('takes a label, for the adviser copy of it', () => {
    render(<ExportRosters label="Export my teams" />);
    expect(screen.getByRole('button', { name: 'Export my teams' })).toBeInTheDocument();
  });
});
