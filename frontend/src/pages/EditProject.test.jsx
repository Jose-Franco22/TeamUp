// Issue #24 — UI tests for editing a project posting.
//
// The form itself is ProjectForm, shared with CreateProject and covered
// there, so this file is about what makes editing different: it is pre-filled,
// only the creator may see it, and the rules move with the roster — a team of
// four with three people already on it has one seat left, not three.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import EditProject from './EditProject';
import * as client from '../api/client';
import { ValidationError } from '../lib/validation';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate, useParams: () => ({ id: 'p-1' }) };
});

let session = { status: 'authenticated', user: { id: 'u-creator' } };
vi.mock('../auth/SessionContext', () => ({ useSession: () => session }));

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProject: vi.fn(),
    getRoles: vi.fn(),
    getSkills: vi.fn(),
    updateProject: vi.fn(),
  };
});

const ROLES = [
  { id: 'r-frontend', name: 'Frontend Developer', sort_order: 20, skill_categories: ['Frontend'] },
  { id: 'r-backend', name: 'Backend Developer', sort_order: 30, skill_categories: ['Backend'] },
  { id: 'r-pm', name: 'Project Manager', sort_order: 10, skill_categories: ['Tools'] },
];
const SKILLS = [
  { id: 's-react', name: 'React', category: 'Frontend' },
  { id: 's-pg', name: 'PostgreSQL', category: 'Backend' },
];

const TITLE = 'Campus parking tracker';
const DESCRIPTION = 'Live lot occupancy estimated from existing camera feeds, with a map.';

const project = (over = {}) => ({
  id: 'p-1',
  creator_id: 'u-creator',
  title: TITLE,
  description: DESCRIPTION,
  team_size_target: 4,
  member_count: 2,
  status: 'open',
  members: [
    { user_id: 'u-creator', name: 'Creator', role_id: 'r-pm', role: 'Project Manager' },
    { user_id: 'u-other', name: 'Other', role_id: 'r-backend', role: 'Backend Developer' },
  ],
  roles_needed: [
    {
      role_id: 'r-frontend',
      role_name: 'Frontend Developer',
      skill_id: 's-react',
      skill_name: 'React',
      category: 'Frontend',
      quantity_needed: 2,
    },
  ],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  session = { status: 'authenticated', user: { id: 'u-creator' } };
  client.getProject.mockResolvedValue(project());
  client.getRoles.mockResolvedValue(ROLES);
  client.getSkills.mockResolvedValue(SKILLS);
  client.updateProject.mockImplementation(async (_id, values) => project(values));
});

async function renderEdit() {
  render(
    <MemoryRouter>
      <EditProject />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Edit project' });
  return {
    title: screen.getByLabelText(/^Title/),
    description: screen.getByLabelText(/^Description/),
    size: screen.getByLabelText(/^Team size target/),
    ownRole: screen.getByLabelText(/^Your role/),
    save: screen.getByRole('button', { name: 'Save changes' }),
  };
}

// --- pre-filled -----------------------------------------------------------

describe('the form opens with the current values', () => {
  test('title, description and team size are filled in', async () => {
    const fields = await renderEdit();
    expect(fields.title).toHaveValue(TITLE);
    expect(fields.description).toHaveValue(DESCRIPTION);
    expect(fields.size).toHaveValue(4);
  });

  test('the creator’s own role is selected, taken from the roster', async () => {
    const fields = await renderEdit();
    expect(fields.ownRole).toHaveValue('r-pm');
  });

  test('the roles being recruited for are listed, with their skill and quantity', async () => {
    await renderEdit();
    expect(screen.getByLabelText('Role')).toHaveValue('r-frontend');
    expect(screen.getByLabelText('Skill')).toHaveValue('s-react');
    expect(screen.getByLabelText('How many people needed for this role')).toHaveValue(2);
  });

  test('nothing is saved just by opening the page', async () => {
    await renderEdit();
    expect(client.updateProject).not.toHaveBeenCalled();
  });
});

// --- only the creator -----------------------------------------------------

describe('someone who did not create the project', () => {
  test('is told so instead of being shown the form', async () => {
    session = { status: 'authenticated', user: { id: 'u-someone-else' } };
    render(
      <MemoryRouter>
        <EditProject />
      </MemoryRouter>
    );

    expect(await screen.findByText("You can't edit this project.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'open projects' })).toHaveAttribute('href', '/browse');
  });

  test('a member of the team who did not create it is refused too', async () => {
    session = { status: 'authenticated', user: { id: 'u-other' } };
    render(
      <MemoryRouter>
        <EditProject />
      </MemoryRouter>
    );
    expect(await screen.findByText("You can't edit this project.")).toBeInTheDocument();
  });
});

// --- the same validation as creating --------------------------------------

describe('validation', () => {
  test('a too-short title shows the same message the create form shows', async () => {
    const user = userEvent.setup();
    const fields = await renderEdit();
    await user.clear(fields.title);
    await user.type(fields.title, 'abcd');

    const error = screen.getByText('Title must be between 5 and 100 characters');
    expect(fields.title).toHaveAttribute('aria-describedby', error.id);
    expect(fields.save).toBeDisabled();
  });

  test('a too-short description is rejected the same way', async () => {
    const user = userEvent.setup();
    const fields = await renderEdit();
    await user.clear(fields.description);
    await user.type(fields.description, 'short');
    expect(screen.getByText('Description must be between 20 and 2000 characters')).toBeInTheDocument();
    expect(fields.save).toBeDisabled();
  });

  test('clearing the title blocks saving rather than wiping it', async () => {
    const user = userEvent.setup();
    const fields = await renderEdit();
    await user.clear(fields.title);
    expect(fields.save).toBeDisabled();
    expect(client.updateProject).not.toHaveBeenCalled();
  });
});

// --- the roster is the thing that differs from creating -------------------

describe('the team size against the current roster', () => {
  // Three seated, so a target of 2 is inside the global 2–4 range and only
  // the roster rule can reject it. A target of 1 would trip the range check
  // first and never reach this message.
  test('cannot drop below the people already on the team', async () => {
    const user = userEvent.setup();
    client.getProject.mockResolvedValue(
      project({
        member_count: 3,
        members: [
          { user_id: 'u-creator', name: 'Creator', role_id: 'r-pm', role: 'Project Manager' },
          { user_id: 'u-other', name: 'Other', role_id: 'r-backend', role: 'Backend Developer' },
          { user_id: 'u-third', name: 'Third', role_id: 'r-frontend', role: 'Frontend Developer' },
        ],
        roles_needed: [],
      })
    );
    const fields = await renderEdit();
    await user.clear(fields.size);
    await user.type(fields.size, '2');

    expect(
      screen.getByText("3 people are already on this team, so the target can't be 2")
    ).toBeInTheDocument();
    expect(fields.save).toBeDisabled();
  });

  test('can be set to exactly the current roster size, once no seats are claimed', async () => {
    const user = userEvent.setup();
    const fields = await renderEdit(); // two members, one role asking for two
    // Dropping to 2 leaves no open seats, so the role row has to go first —
    // and the form says exactly that rather than silently refusing.
    await user.clear(fields.size);
    await user.type(fields.size, '2');
    expect(
      screen.getByText('A team of 2 has 0 open seats besides you, but you listed 2 people')
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(fields.save).toBeEnabled();
  });

  test('the open seats are counted from the roster, not from the whole team', async () => {
    const user = userEvent.setup();
    await renderEdit(); // team of 4, two seated -> two seats left
    const quantity = screen.getByLabelText('How many people needed for this role');
    await user.clear(quantity);
    await user.type(quantity, '3');

    expect(
      screen.getByText('A team of 4 has 2 open seats besides you, but you listed 3 people')
    ).toBeInTheDocument();
  });

  test('the hint says how many people are already on the team', async () => {
    await renderEdit();
    expect(screen.getByText(/2 people are on this team already/)).toBeInTheDocument();
  });
});

// --- saving ---------------------------------------------------------------

describe('saving', () => {
  test('sends the edited values, trimmed, with the roster size', async () => {
    const user = userEvent.setup();
    const fields = await renderEdit();
    await user.clear(fields.title);
    await user.type(fields.title, '  Parking tracker v2  ');
    await user.click(fields.save);

    await waitFor(() => expect(client.updateProject).toHaveBeenCalledTimes(1));
    const [id, values, options] = client.updateProject.mock.calls[0];
    expect(id).toBe('p-1');
    expect(values.title).toBe('Parking tracker v2');
    // Without this the client would count seats from a team of one and
    // accept more people than the project has room for.
    expect(options).toEqual({ memberCount: 2 });
  });

  test('says it saved, and stays on the page', async () => {
    const user = userEvent.setup();
    const fields = await renderEdit();
    await user.clear(fields.description);
    await user.type(fields.description, `${DESCRIPTION} Updated.`);
    await user.click(fields.save);

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a rule only the server knows about is shown on the form', async () => {
    const user = userEvent.setup();
    client.updateProject.mockRejectedValue(new Error('Only the project creator can edit it'));
    const fields = await renderEdit();
    await user.clear(fields.title);
    await user.type(fields.title, 'Another title here');
    await user.click(fields.save);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only the project creator can edit it'
    );
  });

  test('a field-specific rejection lands on its field', async () => {
    const user = userEvent.setup();
    client.updateProject.mockRejectedValue(
      new ValidationError({ title: 'Title must be between 5 and 100 characters' })
    );
    const fields = await renderEdit();
    await user.clear(fields.title);
    await user.type(fields.title, 'Another title here');
    await user.click(fields.save);

    await waitFor(() => expect(fields.title).toHaveAttribute('aria-invalid', 'true'));
  });

  test('a failed save keeps the edits on screen so they can be retried', async () => {
    const user = userEvent.setup();
    client.updateProject.mockRejectedValue(new Error('Network down'));
    const fields = await renderEdit();
    await user.clear(fields.title);
    await user.type(fields.title, 'Parking tracker v2');
    await user.click(fields.save);

    await screen.findByRole('alert');
    expect(fields.title).toHaveValue('Parking tracker v2');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  test('"Back to your team" leaves without saving', async () => {
    const user = userEvent.setup();
    await renderEdit();
    await user.click(screen.getByRole('button', { name: 'Back to your team' }));
    expect(navigate).toHaveBeenCalledWith('/team');
    expect(client.updateProject).not.toHaveBeenCalled();
  });
});

// --- loading failures -----------------------------------------------------

describe('when the page cannot load', () => {
  test.each([
    ['the project', 'getProject'],
    ['the roles list', 'getRoles'],
    ['the skills list', 'getSkills'],
  ])('%s failing shows an error with a retry', async (_label, fn) => {
    client[fn].mockRejectedValueOnce(new Error('Network down'));
    render(
      <MemoryRouter>
        <EditProject />
      </MemoryRouter>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
  });

  test('a project that does not exist is reported, not rendered empty', async () => {
    client.getProject.mockRejectedValue(new Error('Project not found'));
    render(
      <MemoryRouter>
        <EditProject />
      </MemoryRouter>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found');
  });
});
