// Issue #40 — what ends up in the cells.
//
// supabase/tests/export_rosters.test.sql decides whose names are in the
// file. This file decides how they read once they are, which is where the
// issue's wording lives: "forming / full", "None" / "Pending", yes/no, a
// bold frozen header, and emails that paste straight into Outlook.
//
// The awkward-name case is not decoration. A roster is full of real names,
// and a spreadsheet writer that mangles one is worse than useless: the
// instructor emails the wrong address, or writes to "Pe?a".
import { describe, expect, test } from 'vitest';
import { buildRosterWorkbook, isoDate, rosterFileName } from './rosterWorkbook';

const EXPORT = {
  scope: 'admin',
  teams: [
    {
      team_id: 't-a',
      team_name: 'Campus parking tracker',
      status: 'open',
      owner_name: 'Olivia Owner',
      owner_email: 'ownera40@utrgv.edu',
      member_count: 2,
      team_size_target: 4,
      adviser_status: 'accepted',
      adviser_name: 'Dr Ana Peña',
      adviser_email: 'adviser40@utrgv.edu',
      github_repo: 'https://github.com/Jose-Franco22/TeamUp',
    },
    {
      team_id: 't-b',
      team_name: 'Degree plan builder',
      status: 'full',
      owner_name: "Bea O'Hare, Jr.",
      owner_email: 'ownerb40@utrgv.edu',
      member_count: 3,
      team_size_target: 3,
      adviser_status: 'none',
      adviser_name: null,
      adviser_email: null,
      github_repo: '',
    },
    {
      team_id: 't-c',
      team_name: 'Scam text detector',
      status: 'open',
      owner_name: 'Caro Coder',
      owner_email: 'ownerc40@utrgv.edu',
      member_count: 1,
      team_size_target: 3,
      adviser_status: 'pending',
      adviser_name: null,
      adviser_email: null,
      github_repo: '',
    },
  ],
  members: [
    {
      user_id: 'u-1',
      team_name: 'Campus parking tracker',
      name: 'Olivia Owner',
      email: 'ownera40@utrgv.edu',
      role_name: 'Project Manager',
      is_owner: true,
      github_url: 'https://github.com/olivia',
      joined_at: '2026-10-02T15:30:00Z',
    },
    {
      user_id: 'u-2',
      team_name: 'Campus parking tracker',
      name: 'Mark Member',
      email: 'membera40@utrgv.edu',
      role_name: 'Backend Developer',
      is_owner: false,
      github_url: '',
      joined_at: '2026-10-05T09:00:00Z',
    },
  ],
  unplaced_students: [
    {
      user_id: 'u-3',
      name: 'Uma Unplaced',
      email: 'unplaced40a@utrgv.edu',
      skills: ['React', 'PostgreSQL'],
      has_pending_request: true,
    },
    {
      user_id: 'u-4',
      name: 'Walt Waiting',
      email: 'unplaced40b@utrgv.edu',
      skills: [],
      has_pending_request: false,
    },
  ],
};

// Row 1 is the header, so data rows start at 2.
const headerOf = (sheet) => sheet.getRow(1).values.slice(1);
const rowOf = (sheet, n) => sheet.getRow(n + 1).values.slice(1);
const columnOf = (sheet, header) => headerOf(sheet).indexOf(header);
const cell = (sheet, n, header) => rowOf(sheet, n)[columnOf(sheet, header)];

describe('the three sheets', () => {
  const wb = buildRosterWorkbook(EXPORT);

  test('are named as the issue names them', () => {
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Teams', 'Members', 'Unplaced students']);
  });

  test('Teams has a row per team, under the columns asked for', () => {
    const sheet = wb.getWorksheet('Teams');
    expect(headerOf(sheet)).toEqual([
      'Team', 'Status', 'Owner', 'Owner email', 'Members', 'Target size',
      'Adviser', 'Adviser email', 'GitHub repo',
    ]);
    expect(sheet.rowCount).toBe(4); // header + 3
    expect(cell(sheet, 1, 'Team')).toBe('Campus parking tracker');
    expect(cell(sheet, 1, 'Members')).toBe(2);
    expect(cell(sheet, 1, 'Target size')).toBe(4);
    expect(cell(sheet, 1, 'GitHub repo')).toBe('https://github.com/Jose-Franco22/TeamUp');
  });

  test('Members has a row per member', () => {
    const sheet = wb.getWorksheet('Members');
    expect(headerOf(sheet)).toEqual([
      'Team', 'Name', 'Email', 'Role', 'Owner', 'GitHub URL', 'Joined',
    ]);
    expect(sheet.rowCount).toBe(3);
    expect(cell(sheet, 1, 'Role')).toBe('Project Manager');
    expect(cell(sheet, 2, 'Name')).toBe('Mark Member');
  });

  test('Unplaced students has a row per student, skills joined up', () => {
    const sheet = wb.getWorksheet('Unplaced students');
    expect(headerOf(sheet)).toEqual(['Name', 'Email', 'Skills', 'Asked to join a team']);
    expect(sheet.rowCount).toBe(3);
    expect(cell(sheet, 1, 'Skills')).toBe('React, PostgreSQL');
    expect(cell(sheet, 2, 'Skills')).toBe('');
  });
});

describe('the words the issue asks for', () => {
  const sheet = buildRosterWorkbook(EXPORT).getWorksheet('Teams');

  test('status reads forming or full, not open or full', () => {
    expect(cell(sheet, 1, 'Status')).toBe('Forming');
    expect(cell(sheet, 2, 'Status')).toBe('Full');
  });

  // THE CRITERION, both halves.
  test('a team with no adviser shows None', () => {
    expect(cell(sheet, 2, 'Adviser')).toBe('None');
  });

  test('and one whose invitation is unanswered shows Pending', () => {
    expect(cell(sheet, 3, 'Adviser')).toBe('Pending');
  });

  // Somebody pastes the whole adviser-email column into a To: field. A
  // column of "Pending" would go with it.
  test('neither puts a word in the email column', () => {
    expect(cell(sheet, 2, 'Adviser email')).toBe('');
    expect(cell(sheet, 3, 'Adviser email')).toBe('');
  });

  test('an accepted adviser gets their name and address', () => {
    expect(cell(sheet, 1, 'Adviser')).toBe('Dr Ana Peña');
    expect(cell(sheet, 1, 'Adviser email')).toBe('adviser40@utrgv.edu');
  });

  test('owner is yes or no, not true or false', () => {
    const members = buildRosterWorkbook(EXPORT).getWorksheet('Members');
    expect(cell(members, 1, 'Owner')).toBe('Yes');
    expect(cell(members, 2, 'Owner')).toBe('No');
  });

  test('and so is whether an unplaced student has asked to join one', () => {
    const unplaced = buildRosterWorkbook(EXPORT).getWorksheet('Unplaced students');
    expect(cell(unplaced, 1, 'Asked to join a team')).toBe('Yes');
    expect(cell(unplaced, 2, 'Asked to join a team')).toBe('No');
  });
});

// A roster is full of real names. One mangled name means an instructor
// writes to the wrong person, or addresses somebody as "Pe?a".
describe('names come through unchanged', () => {
  const wb = buildRosterWorkbook(EXPORT);

  test('an accent survives', () => {
    expect(cell(wb.getWorksheet('Teams'), 1, 'Adviser')).toBe('Dr Ana Peña');
  });

  test('so do an apostrophe and a comma', () => {
    expect(cell(wb.getWorksheet('Teams'), 2, 'Owner')).toBe("Bea O'Hare, Jr.");
  });

  test('and a quotation mark', () => {
    const quoted = buildRosterWorkbook({
      ...EXPORT,
      members: [{ ...EXPORT.members[0], name: 'Sam "Sandy" Reyes' }],
    });
    expect(cell(quoted.getWorksheet('Members'), 1, 'Name')).toBe('Sam "Sandy" Reyes');
  });
});

describe('what makes it usable in Excel', () => {
  const wb = buildRosterWorkbook(EXPORT);

  test('the header row is bold on every sheet', () => {
    for (const sheet of wb.worksheets) {
      expect(sheet.getRow(1).font?.bold, sheet.name).toBe(true);
    }
  });

  test('and frozen, so a long roster keeps its columns', () => {
    for (const sheet of wb.worksheets) {
      expect(sheet.views[0], sheet.name).toMatchObject({ state: 'frozen', ySplit: 1 });
    }
  });

  test('every column is at least as wide as its widest cell', () => {
    const sheet = wb.getWorksheet('Teams');
    const repo = sheet.columns[columnOf(sheet, 'GitHub repo')];
    expect(repo.width).toBeGreaterThanOrEqual('https://github.com/Jose-Franco22/TeamUp'.length);
    // And no column is wider than the header when every cell is shorter.
    const status = sheet.columns[columnOf(sheet, 'Status')];
    expect(status.width).toBeLessThan(20);
  });

  // The issue asks for addresses that can be copied straight into Outlook.
  // ExcelJS writes a hyperlink when handed { text, hyperlink }; a plain
  // string stays a plain string, and that is what this asserts.
  test('emails are plain text, not hyperlink cells', () => {
    const teams = wb.getWorksheet('Teams');
    const value = cell(teams, 1, 'Owner email');
    expect(typeof value).toBe('string');
    expect(value).toBe('ownera40@utrgv.edu');
  });

  test('the workbook serialises to a real xlsx', async () => {
    const buffer = await wb.xlsx.writeBuffer();
    expect(buffer.byteLength).toBeGreaterThan(0);
    // A .xlsx is a zip; every zip starts PK\x03\x04.
    expect(Array.from(new Uint8Array(buffer).slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });
});

describe('an adviser export', () => {
  const wb = buildRosterWorkbook({ ...EXPORT, scope: 'adviser', unplaced_students: [] });

  // A missing sheet reads as "the export broke". An empty one reads as
  // "there are none", which is the true statement for an adviser.
  test('still has the unplaced sheet, with its headers and no rows', () => {
    const sheet = wb.getWorksheet('Unplaced students');
    expect(sheet).toBeDefined();
    expect(headerOf(sheet)).toEqual(['Name', 'Email', 'Skills', 'Asked to join a team']);
    expect(sheet.rowCount).toBe(1);
  });
});

describe('the file name', () => {
  test('is the dated one the issue asks for', () => {
    expect(rosterFileName(new Date(2026, 10, 23, 9, 0))).toBe('teamup-teams-2026-11-23.xlsx');
  });

  // toISOString() would hand an instructor in Texas tomorrow's date for
  // anything exported after 6pm.
  test('uses the local date, not UTC', () => {
    const lateEvening = new Date(2026, 10, 23, 23, 30);
    expect(rosterFileName(lateEvening)).toBe('teamup-teams-2026-11-23.xlsx');
    expect(lateEvening.toISOString().slice(0, 10)).not.toBe('2026-11-23');
  });

  test('isoDate survives something that is not a date', () => {
    expect(isoDate('not a date')).toBe('');
  });
});
