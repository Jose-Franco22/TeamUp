// Issue #60, the owner's side: what the adviser search results say about
// each candidate now that advisers can state what they advise in and how
// many teams they will take.
//
// AdviserPanel.test.jsx (#53) covers the four states and who gets a control.
// This file is only about the result rows, and the case worth the most is the
// last one: a full adviser is still listed, because an owner who searched a
// name and got nothing back could not tell "not faculty" from "has no room".
// They are shown, marked, sorted last, and not invitable.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdviserPanel from './AdviserPanel';
import * as client from '../api/client';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProjectAdviser: vi.fn(),
    searchAdvisers: vi.fn(),
    inviteAdviser: vi.fn(),
    cancelAdviserRequest: vi.fn(),
    removeAdviser: vi.fn(),
  };
});

const PYTHON = { id: 's-python', name: 'Python', category: 'Data' };
const OPENCV = { id: 's-opencv', name: 'OpenCV', category: 'Data' };
const REACT = { id: 's-react', name: 'React', category: 'Frontend' };

// The project needs Python and a project manager — the second has no skill
// pinned to it, which the schema allows and which matches nothing.
const ROLES = [
  { role_id: 'r-data', role_name: 'Data', skill_id: 's-python', skill_name: 'Python', category: 'Data', quantity_needed: 1 },
  { role_id: 'r-pm', role_name: 'Project Manager', skill_id: null, skill_name: null, category: null, quantity_needed: 1 },
];

const candidate = (over = {}) => ({
  id: 'u-dana',
  name: 'Dana Kim',
  email: 'dkim01@utrgv.edu',
  max_teams: null,
  advising: 0,
  is_full: false,
  expertise: [],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  client.getProjectAdviser.mockResolvedValue(null);
  client.searchAdvisers.mockResolvedValue([]);
  client.inviteAdviser.mockResolvedValue({ status: 'pending' });
});

async function search(found, { rolesNeeded = ROLES } = {}) {
  client.searchAdvisers.mockResolvedValue(found);
  render(<AdviserPanel projectId="p-lab" isOwner rolesNeeded={rolesNeeded} />);
  await userEvent.type(await screen.findByLabelText('Search by name or email'), 'kim');
  // Debounced, so the row arrives after the timer rather than the keystroke.
  await screen.findByText(found[0].name);
  return screen.getByRole('region', { name: 'Adviser' });
}

const rows = () => screen.getAllByRole('listitem');

describe('what a result row says', () => {
  test('the areas this adviser advises in', async () => {
    const panel = await search([candidate({ expertise: [OPENCV, PYTHON] })]);
    expect(within(panel).getByText('OpenCV')).toBeInTheDocument();
    expect(within(panel).getByText('Python')).toBeInTheDocument();
  });

  test('the ones this project asks for are picked out, and the others are not', async () => {
    const panel = await search([candidate({ expertise: [OPENCV, PYTHON] })]);

    expect(within(panel).getByText('Python').className).toContain('match');
    expect(within(panel).getByText('OpenCV').className).not.toContain('match');
  });

  test('a same-category match is picked out too, and says it is the weaker claim', async () => {
    // The project needs Python; OpenCV is Data as well, so it is a neighbour.
    const panel = await search([candidate({ expertise: [OPENCV] })]);

    const area = within(panel).getByText('OpenCV');
    expect(area.className).toContain('match');
    expect(area).toHaveAttribute('title', 'Close to something this project asks for');
  });

  test('a direct match says so', async () => {
    const panel = await search([candidate({ expertise: [PYTHON] })]);
    expect(within(panel).getByText('Python')).toHaveAttribute('title', 'This project asks for this');
  });

  test('nothing is picked out when the project has no open roles left', async () => {
    const panel = await search([candidate({ expertise: [OPENCV, PYTHON] })], { rolesNeeded: [] });

    expect(within(panel).getByText('Python')).toBeInTheDocument();
    expect(within(panel).getByText('Python').className).not.toContain('match');
  });

  test('spots left, in the words the issue asks for', async () => {
    const panel = await search([candidate({ max_teams: 2, advising: 1 })]);
    expect(within(panel).getByText('1 of 2 spots open')).toBeInTheDocument();
  });

  test('and says so plainly when the adviser has set no limit', async () => {
    const panel = await search([candidate()]);
    expect(within(panel).getByText('No limit set')).toBeInTheDocument();
  });
});

describe('an adviser with no room', () => {
  test('is shown as Full and cannot be asked', async () => {
    const panel = await search([candidate({ is_full: true, max_teams: 2, advising: 2 })]);

    expect(within(panel).getByText('Full')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Ask to advise' })).toBeDisabled();
  });

  test('clicking the disabled button sends nothing', async () => {
    const panel = await search([candidate({ is_full: true })]);

    await userEvent.click(within(panel).getByRole('button', { name: 'Ask to advise' }));

    expect(client.inviteAdviser).not.toHaveBeenCalled();
  });

  test('says why, so a disabled button is not a dead end', async () => {
    const panel = await search([candidate({ is_full: true })]);
    expect(within(panel).getByRole('button', { name: 'Ask to advise' })).toHaveAttribute(
      'title',
      'They are already advising as many teams as they take on'
    );
  });

  test('and sorts after everyone who can say yes, whatever the names are', async () => {
    await search([
      candidate({ id: 'u-ada', name: 'Ada Adviser', is_full: true, expertise: [PYTHON] }),
      candidate({ id: 'u-zoe', name: 'Zoe Zepeda' }),
    ]);

    // Ada is first by name and the only one who matches the project at all.
    // Being full outranks both: a perfect fit who cannot be asked is not a
    // useful first row.
    expect(rows().map((li) => li.textContent)).toEqual([
      expect.stringContaining('Zoe Zepeda'),
      expect.stringContaining('Ada Adviser'),
    ]);
  });
});

describe('ordering among advisers who can be asked', () => {
  test('the better fit comes first', async () => {
    await search([
      candidate({ id: 'u-a', name: 'Ada Adviser', expertise: [REACT] }),
      candidate({ id: 'u-z', name: 'Zoe Zepeda', expertise: [PYTHON] }),
    ]);

    // Zoe matches the one role with a skill on it; Ada's React matches
    // nothing, since the project needs Data and a project manager.
    expect(rows()[0].textContent).toContain('Zoe Zepeda');
  });

  test('an owner can still ask the one with room', async () => {
    const panel = await search([candidate({ max_teams: 3, advising: 1 })]);

    await userEvent.click(within(panel).getByRole('button', { name: 'Ask to advise' }));

    expect(client.inviteAdviser).toHaveBeenCalledWith('p-lab', 'u-dana');
  });
});
