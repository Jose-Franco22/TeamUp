// Turning export_rosters() into the .xlsx an instructor actually opens
// (issue #40).
//
// The database decides whose names are in the file (supabase/46_export_rosters.sql
// and its pgTAP cases); this decides how they read. Keeping the two apart is
// what lets "None" and "Pending" be written once, here, instead of in SQL
// where a spreadsheet word has no business being.
//
// THE POINT OF THE FILE is that it leaves the application. An instructor
// sorts it, filters it, and pastes a column of addresses into Outlook. So
// the choices below are all about what survives that:
//
//   * emails are plain strings, never hyperlink objects — a hyperlink cell
//     pastes as a link with display text, and the issue asks for addresses
//     that go straight into a To: field;
//   * the header row is bold and frozen, so scrolling a long roster keeps
//     the columns legible;
//   * every column is sized to its widest cell, because an unsized column
//     shows `####` for anything long and that is what people photograph and
//     send back as a bug;
//   * dates are written as `yyyy-mm-dd` text rather than as date cells. A
//     real date cell is stored as a number and rendered against whatever
//     timezone and locale the reader's Excel is in, which can show the day
//     before. Sorting is the only thing anyone does with this column and
//     `yyyy-mm-dd` sorts correctly as text.
import ExcelJS from 'exceljs';

// Local time, not toISOString(). An instructor in Texas exporting at 7pm
// gets today's date; UTC would hand them tomorrow's.
export function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `teamup-teams-2026-11-23.xlsx`, the name the issue asks for. */
export function rosterFileName(now = new Date()) {
  return `teamup-teams-${isoDate(now)}.xlsx`;
}

// "forming" and "full" are the words the issue uses; the database says
// 'open' and 'full'. Anything else is passed through rather than blanked,
// so a status added later shows up as itself instead of vanishing.
const STATUS_TEXT = { open: 'Forming', full: 'Full' };
const yesNo = (value) => (value ? 'Yes' : 'No');

// Sized to the widest cell, within reason: narrow enough that the sheet
// fits on a screen, wide enough that nothing shows as ####.
const MIN_WIDTH = 10;
const MAX_WIDTH = 48;

function fit(worksheet) {
  worksheet.columns.forEach((column) => {
    let widest = String(column.header ?? '').length;
    // eachCell skips empty cells unless asked, which is what we want: an
    // empty cell cannot be too narrow for its contents.
    column.eachCell({ includeEmpty: false }, (cell) => {
      const text = cell.value == null ? '' : String(cell.value);
      // A cell can hold a newline; the column only has to fit the longest
      // line in it.
      for (const line of text.split('\n')) widest = Math.max(widest, line.length);
    });
    column.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, widest + 2));
  });
}

function addSheet(workbook, name, columns, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns;
  // Frozen first, bold second: setting views before the rows exist means
  // the pane is fixed whatever gets added afterwards.
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  fit(sheet);
  return sheet;
}

/**
 * Builds the three-sheet workbook from what export_rosters() returned.
 *
 * Returns the ExcelJS workbook rather than a buffer, so a test can read the
 * cells and the caller decides when to pay for serialising it.
 *
 * An adviser's export carries no unplaced students. The sheet is still
 * created, empty under its headers: a missing sheet reads as "the export
 * broke", and an empty one reads as "there are none to show you", which is
 * the true statement for an adviser.
 */
export function buildRosterWorkbook(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TeamUp';
  workbook.created = new Date();

  const teams = data?.teams ?? [];
  const members = data?.members ?? [];
  const unplaced = data?.unplaced_students ?? [];

  addSheet(
    workbook,
    'Teams',
    [
      { header: 'Team', key: 'team_name' },
      { header: 'Status', key: 'status' },
      { header: 'Owner', key: 'owner_name' },
      { header: 'Owner email', key: 'owner_email' },
      { header: 'Members', key: 'member_count' },
      { header: 'Target size', key: 'team_size_target' },
      { header: 'Adviser', key: 'adviser_name' },
      { header: 'Adviser email', key: 'adviser_email' },
      { header: 'GitHub repo', key: 'github_repo' },
    ],
    teams.map((t) => ({
      team_name: t.team_name ?? '',
      status: STATUS_TEXT[t.status] ?? t.status ?? '',
      owner_name: t.owner_name ?? '',
      owner_email: t.owner_email ?? '',
      member_count: t.member_count ?? 0,
      team_size_target: t.team_size_target ?? 0,
      // The word goes in the name column only. A column of "Pending" in the
      // email column would be pasted into a To: field by somebody in a
      // hurry; an empty cell cannot be.
      adviser_name:
        t.adviser_status === 'accepted'
          ? (t.adviser_name ?? '')
          : t.adviser_status === 'pending'
            ? 'Pending'
            : 'None',
      adviser_email: t.adviser_status === 'accepted' ? (t.adviser_email ?? '') : '',
      github_repo: t.github_repo ?? '',
    }))
  );

  addSheet(
    workbook,
    'Members',
    [
      { header: 'Team', key: 'team_name' },
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Role', key: 'role_name' },
      { header: 'Owner', key: 'is_owner' },
      { header: 'GitHub URL', key: 'github_url' },
      { header: 'Joined', key: 'joined_at' },
    ],
    members.map((m) => ({
      team_name: m.team_name ?? '',
      name: m.name ?? '',
      email: m.email ?? '',
      role_name: m.role_name ?? '',
      is_owner: yesNo(m.is_owner),
      github_url: m.github_url ?? '',
      joined_at: m.joined_at ? isoDate(m.joined_at) : '',
    }))
  );

  addSheet(
    workbook,
    'Unplaced students',
    [
      { header: 'Name', key: 'name' },
      { header: 'Email', key: 'email' },
      { header: 'Skills', key: 'skills' },
      { header: 'Asked to join a team', key: 'has_pending_request' },
    ],
    unplaced.map((s) => ({
      name: s.name ?? '',
      email: s.email ?? '',
      skills: (s.skills ?? []).join(', '),
      has_pending_request: yesNo(s.has_pending_request),
    }))
  );

  return workbook;
}
