// Issue #23 — UI tests for posting a project.
//
// Covers the four UI criteria and the paths around them: a form that refuses
// to submit, each field explaining itself, a rule only the server knows
// about, and the one case where the form shouldn't be shown at all.
//
// The client is mocked so the rejections can be driven directly; the
// validation underneath is the real lib/validation.js, so this file only has
// to prove the wiring.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CreateProject from './CreateProject';
import * as client from '../api/client';
import { ValidationError } from '../lib/validation';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMyTeam: vi.fn(),
    getRoles: vi.fn(),
    getSkills: vi.fn(),
    createProject: vi.fn(),
  };
});

const ROLES = [
  { id: 'r-frontend', name: 'Frontend Developer', sort_order: 20, skill_categories: ['Frontend'] },
  { id: 'r-backend', name: 'Backend Developer', sort_order: 30, skill_categories: ['Backend'] },
  { id: 'r-data', name: 'Data / ML', sort_order: 60, skill_categories: ['Data'] },
];
const SKILLS = [
  { id: 's-react', name: 'React', category: 'Frontend' },
  { id: 's-pg', name: 'PostgreSQL', category: 'Backend' },
];

const TITLE = 'Campus parking tracker';
const DESCRIPTION = 'Live lot occupancy estimated from existing camera feeds, with a map.';

beforeEach(() => {
  vi.clearAllMocks();
  client.getMyTeam.mockResolvedValue(null);
  client.getRoles.mockResolvedValue(ROLES);
  client.getSkills.mockResolvedValue(SKILLS);
  client.createProject.mockResolvedValue({ id: 'p-new' });
});

async function renderForm() {
  render(
    <MemoryRouter>
      <CreateProject />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Create a project' });
  return {
    title: screen.getByLabelText(/^Title/),
    description: screen.getByLabelText(/^Description/),
    size: screen.getByLabelText(/^Team size target/),
    ownRole: screen.getByLabelText(/^Your role/),
    submit: screen.getByRole('button', { name: 'Create project' }),
  };
}

// The minimum a project needs: valid text, your own role, and the one
// default role row either filled in or removed.
async function fillValid(user, fields) {
  await user.type(fields.title, TITLE);
  await user.type(fields.description, DESCRIPTION);
  await user.selectOptions(fields.ownRole, 'r-frontend');
  await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');
}

// --- submit stays disabled until the form is valid ------------------------

describe('the submit button', () => {
  test('starts disabled on an empty form', async () => {
    const { submit } = await renderForm();
    expect(submit).toBeDisabled();
  });

  test('stays disabled while any required field is still wrong', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();

    await user.type(fields.title, TITLE);
    expect(fields.submit).toBeDisabled(); // no description, no role

    await user.type(fields.description, DESCRIPTION);
    expect(fields.submit).toBeDisabled(); // still no role for yourself

    // Title, description and your own role are everything that is required;
    // the blank "roles needed" row is optional and does not hold it back.
    await user.selectOptions(fields.ownRole, 'r-frontend');
    expect(fields.submit).toBeEnabled();

    // Breaking the size closes it again.
    await user.clear(fields.size);
    expect(fields.submit).toBeDisabled();
  });

  test('goes back to disabled when a valid field is broken again', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await fillValid(user, fields);
    expect(fields.submit).toBeEnabled();

    await user.clear(fields.title);
    expect(fields.submit).toBeDisabled();
  });
});

// --- each field explains itself ------------------------------------------

describe('inline errors', () => {
  test('an empty form shows nothing until a field is used', async () => {
    await renderForm();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('a too-short title says so, under the title field', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, 'abcd');

    const error = screen.getByText('Title must be between 5 and 100 characters');
    expect(fields.title).toHaveAttribute('aria-invalid', 'true');
    expect(fields.title).toHaveAttribute('aria-describedby', error.id);
  });

  test('a title of only spaces is too short, not accepted as eight characters', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, '   ab   ');
    expect(screen.getByText('Title must be between 5 and 100 characters')).toBeInTheDocument();
  });

  test('a too-short description says so, under the description field', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.description, 'too short');

    const error = screen.getByText('Description must be between 20 and 2000 characters');
    expect(fields.description).toHaveAttribute('aria-describedby', error.id);
  });

  test('a team size outside 2 to 4 says so, under the size field', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.clear(fields.size);
    await user.type(fields.size, '9');

    const error = screen.getByText('A team has to be between 2 and 4 people');
    expect(fields.size).toHaveAttribute('aria-describedby', error.id);
  });

  test('more people than seats is reported against the roles, with the arithmetic', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.clear(fields.size);
    await user.type(fields.size, '2'); // you plus one
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');

    const quantity = screen.getByLabelText('How many people needed for this role');
    await user.clear(quantity);
    await user.type(quantity, '3');

    expect(
      screen.getByText('A team of 2 has 1 open seat besides you, but you listed 3 people')
    ).toBeInTheDocument();
  });

  // Roles are optional and the form opens with one blank row. An untouched
  // row must not block Submit — the student has not made a mistake, they
  // have just not used an optional field.
  test('the blank role row the form opens with does not block anything', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, TITLE);
    await user.type(fields.description, DESCRIPTION);
    await user.selectOptions(fields.ownRole, 'r-frontend');

    expect(screen.queryByText('Every role you list needs a role selected')).not.toBeInTheDocument();
    expect(fields.submit).toBeEnabled();

    await user.click(fields.submit);
    await waitFor(() => expect(client.createProject).toHaveBeenCalled());
    expect(client.createProject.mock.calls[0][0].roles_needed).toEqual([]);
  });

  // ...but a row that was started and left without a role is a real
  // omission, and would otherwise be silently dropped on submit.
  test('a role row that was started but has no role is called out', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, TITLE);
    await user.type(fields.description, DESCRIPTION);
    await user.selectOptions(fields.ownRole, 'r-frontend');

    const quantity = screen.getByLabelText('How many people needed for this role');
    await user.clear(quantity);
    await user.type(quantity, '2');

    expect(screen.getByText('Every role you list needs a role selected')).toBeInTheDocument();
    expect(fields.submit).toBeDisabled();
    expect(client.createProject).not.toHaveBeenCalled();
  });

  test('every broken field reports at once, each in its own place', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, 'ab');
    await user.type(fields.description, 'short');
    await user.clear(fields.size);
    await user.type(fields.size, '7');

    expect(screen.getByText('Title must be between 5 and 100 characters')).toBeInTheDocument();
    expect(screen.getByText('Description must be between 20 and 2000 characters')).toBeInTheDocument();
    expect(screen.getByText('A team has to be between 2 and 4 people')).toBeInTheDocument();
  });

  test('an error clears as soon as the field is put right', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, 'ab');
    expect(screen.getByText('Title must be between 5 and 100 characters')).toBeInTheDocument();

    await user.type(fields.title, 'cdef');
    expect(screen.queryByText('Title must be between 5 and 100 characters')).not.toBeInTheDocument();
  });
});

// --- a successful post ----------------------------------------------------

describe('posting the project', () => {
  test('sends what was filled in, trimmed, and goes to the team page', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, `  ${TITLE}  `);
    await user.type(fields.description, DESCRIPTION);
    await user.selectOptions(fields.ownRole, 'r-frontend');
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');

    await user.click(fields.submit);

    await waitFor(() => expect(client.createProject).toHaveBeenCalledTimes(1));
    expect(client.createProject).toHaveBeenCalledWith({
      title: TITLE,
      description: DESCRIPTION,
      team_size_target: 4,
      creator_role_id: 'r-frontend',
      roles_needed: [{ role_id: 'r-backend', skill_id: null, quantity_needed: 1 }],
    });
    expect(navigate).toHaveBeenCalledWith('/team', { replace: true });
  });

  test('a skill pinned to a role is sent with it', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await fillValid(user, fields);
    await user.selectOptions(screen.getByLabelText('Skill'), 's-pg');
    await user.click(fields.submit);

    await waitFor(() => expect(client.createProject).toHaveBeenCalled());
    expect(client.createProject.mock.calls[0][0].roles_needed).toEqual([
      { role_id: 'r-backend', skill_id: 's-pg', quantity_needed: 1 },
    ]);
  });

  test('the button reads "Creating…" and is disabled while it is in flight', async () => {
    const user = userEvent.setup();
    let release;
    client.createProject.mockReturnValue(new Promise((r) => { release = r; }));

    const fields = await renderForm();
    await fillValid(user, fields);
    await user.click(fields.submit);

    const pending = await screen.findByRole('button', { name: 'Creating…' });
    expect(pending).toBeDisabled();
    release({ id: 'p-new' });
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });
});

// --- the server refusing --------------------------------------------------

describe('when the server refuses', () => {
  test('a rule only the server knows about is shown on the form', async () => {
    const user = userEvent.setup();
    client.createProject.mockRejectedValue(
      new Error('You are already on a team and cannot create another project')
    );
    const fields = await renderForm();
    await fillValid(user, fields);
    await user.click(fields.submit);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You are already on a team and cannot create another project'
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  test('a field-specific rejection lands next to that field, not at the bottom', async () => {
    const user = userEvent.setup();
    client.createProject.mockRejectedValue(
      new ValidationError({ title: 'Title must be between 5 and 100 characters' })
    );
    const fields = await renderForm();
    await fillValid(user, fields);
    await user.click(fields.submit);

    await waitFor(() => expect(fields.title).toHaveAttribute('aria-invalid', 'true'));
    expect(fields.title).toHaveAttribute('aria-describedby', 'title-error');
  });

  test('nothing is lost — the form keeps what was typed so it can be retried', async () => {
    const user = userEvent.setup();
    client.createProject.mockRejectedValue(new Error('Network down'));
    const fields = await renderForm();
    await fillValid(user, fields);
    await user.click(fields.submit);

    await screen.findByRole('alert');
    expect(fields.title).toHaveValue(TITLE);
    expect(fields.description).toHaveValue(DESCRIPTION);
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled();
  });
});

// --- the form shouldn't always be shown -----------------------------------

describe('a student who already has a team', () => {
  test('is told so instead of being offered the form', async () => {
    client.getMyTeam.mockResolvedValue({ id: 't-1', project: { id: 'p-1' } });
    render(
      <MemoryRouter>
        <CreateProject />
      </MemoryRouter>
    );

    expect(await screen.findByText("You're already on a team.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'your team' })).toHaveAttribute('href', '/team');
  });
});

describe('when the page cannot load', () => {
  test.each([
    ['the roster check', 'getMyTeam'],
    ['the roles list', 'getRoles'],
    ['the skills list', 'getSkills'],
  ])('%s failing shows an error with a retry', async (_label, fn) => {
    client[fn].mockRejectedValueOnce(new Error('Network down'));
    render(
      <MemoryRouter>
        <CreateProject />
      </MemoryRouter>
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
  });

  test('retrying after a failure loads the form', async () => {
    const user = userEvent.setup();
    client.getRoles.mockRejectedValueOnce(new Error('Network down'));
    render(
      <MemoryRouter>
        <CreateProject />
      </MemoryRouter>
    );
    await screen.findByRole('alert');

    client.getRoles.mockResolvedValue(ROLES);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByLabelText(/^Title/)).toBeInTheDocument();
  });
});

// --- the role rows --------------------------------------------------------

describe('the roles needed rows', () => {
  test('a role already chosen is not offered again, so it cannot be listed twice', async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');
    await user.click(screen.getByRole('button', { name: 'Add a role' }));

    const [, second] = screen.getAllByLabelText('Role');
    const options = within(second).getAllByRole('option').map((o) => o.value);
    expect(options).not.toContain('r-backend');
  });

  test('the skill list only offers skills that fit the chosen role', async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');

    const options = within(screen.getByLabelText('Skill'))
      .getAllByRole('option')
      .map((o) => o.value);
    expect(options).toContain('s-pg');
    expect(options).not.toContain('s-react');
  });

  test('changing the role clears a skill that no longer fits it', async () => {
    const user = userEvent.setup();
    await renderForm();
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');
    await user.selectOptions(screen.getByLabelText('Skill'), 's-pg');
    expect(screen.getByLabelText('Skill')).toHaveValue('s-pg');

    await user.selectOptions(screen.getByLabelText('Role'), 'r-frontend');
    expect(screen.getByLabelText('Skill')).toHaveValue('');
  });

  test('removing the empty row makes the form valid without listing any role', async () => {
    const user = userEvent.setup();
    const fields = await renderForm();
    await user.type(fields.title, TITLE);
    await user.type(fields.description, DESCRIPTION);
    await user.selectOptions(fields.ownRole, 'r-frontend');
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(fields.submit).toBeEnabled();
    await user.click(fields.submit);
    await waitFor(() => expect(client.createProject).toHaveBeenCalled());
    expect(client.createProject.mock.calls[0][0].roles_needed).toEqual([]);
  });
});
