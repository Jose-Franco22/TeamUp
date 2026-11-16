// Issue #31 — UI tests for Browse: the filters, the ranking, and what the
// page does when the things it depends on fail.
//
// The client is mocked outright rather than run in mock mode, because three of
// these tests are about a rejected promise and the rest need a fixture small
// enough to predict the ranking from. The filter and scoring logic underneath
// is the real thing (lib/browseFilters.js, lib/matching/fit.js), so this file
// only has to prove the wiring.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Browse from './Browse';
import * as client from '../api/client';

const navigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

let session = { status: 'authenticated', user: { id: 'u-jose' } };
vi.mock('../auth/SessionContext', () => ({ useSession: () => session }));

vi.mock('../api/client', () => ({
  getProjects: vi.fn(),
  getCurrentUser: vi.fn(),
  getRoles: vi.fn(),
  createJoinRequest: vi.fn(),
  getFormationDeadline: vi.fn(),
}));

// --- fixtures ------------------------------------------------------------

const REACT = { id: 's-react', name: 'React', category: 'Frontend' };
const PG = { id: 's-pg', name: 'PostgreSQL', category: 'Backend' };
const PYTHON = { id: 's-python', name: 'Python', category: 'Data' };

const role = (role_id, role_name, skill) => ({
  role_id,
  role_name,
  skill_id: skill?.id ?? null,
  skill_name: skill?.name ?? null,
  category: skill?.category ?? null,
  quantity_needed: 1,
});

const ROLES = [
  { id: 'r-frontend', name: 'Frontend Developer', sort_order: 20 },
  { id: 'r-backend', name: 'Backend Developer', sort_order: 30 },
  { id: 'r-pm', name: 'Project Manager', sort_order: 10 },
];

const PARKING = {
  id: 'p-parking',
  creator_id: 'u-nicolas',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy estimated from existing camera feeds.',
  team_size_target: 4,
  member_count: 1,
  status: 'open',
  avg_availability_hours: 12,
  roles_needed: [role('r-frontend', 'Frontend Developer', REACT)],
  members: [],
  viewer_request_status: null,
};

const DEGREE = {
  id: 'p-degree',
  creator_id: 'u-alexis',
  title: 'Degree plan builder',
  description: 'Constraint solver over prerequisites and offering patterns.',
  team_size_target: 3,
  member_count: 1,
  status: 'open',
  avg_availability_hours: 10,
  roles_needed: [role('r-backend', 'Backend Developer', PG), role('r-data', 'Data / ML', PYTHON)],
  members: [],
  viewer_request_status: null,
};

const SCAM = {
  id: 'p-scam',
  creator_id: 'u-maria',
  title: 'Scam text detector',
  description: 'Classifier over reported SMS messages.',
  team_size_target: 2,
  member_count: 2,
  status: 'full',
  avg_availability_hours: 16,
  roles_needed: [role('r-pm', 'Project Manager', null)],
  members: [],
  viewer_request_status: null,
};

const ME = {
  id: 'u-jose',
  name: 'Jose Franco Garza',
  availability_hours: 12,
  skills: [{ ...REACT, source: 'manual' }],
};

beforeEach(() => {
  session = { status: 'authenticated', user: { id: 'u-jose' } };
  client.getProjects.mockResolvedValue([PARKING, DEGREE, SCAM]);
  client.getCurrentUser.mockResolvedValue(ME);
  client.getRoles.mockResolvedValue(ROLES);
  client.createJoinRequest.mockResolvedValue({});
  client.getFormationDeadline.mockResolvedValue(null);
});

async function renderBrowse() {
  render(
    <MemoryRouter>
      <Browse />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Open projects' });
  // The ranking waits on getCurrentUser, so let the profile land before
  // asserting anything about order or scores.
  await waitFor(() => expect(client.getCurrentUser).toHaveBeenCalled());
}

const cardTitles = () =>
  screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent.replace(/\s+\w+$/, '').trim());

// --- the list ------------------------------------------------------------

describe('the project list', () => {
  test('fetches every project, so it can report what the filters hide', async () => {
    await renderBrowse();
    expect(client.getProjects).toHaveBeenCalledWith({ onlyOpen: false });
  });

  test('hides full projects by default and says how many', async () => {
    await renderBrowse();
    expect(screen.queryByText('Scam text detector')).not.toBeInTheDocument();
    expect(screen.getByText(/1 full and hidden/)).toBeInTheDocument();
  });

  test('turning off "Open projects only" brings the full project back', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    await user.click(screen.getByLabelText('Open projects only'));
    expect(screen.getByText('Scam text detector')).toBeInTheDocument();
    expect(screen.queryByText(/full and hidden/)).not.toBeInTheDocument();
  });

  test('shows a loading state first, then the projects', async () => {
    let resolve;
    client.getProjects.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>
    );
    expect(screen.getByRole('status')).toHaveTextContent(/loading projects/i);
    resolve([PARKING]);
    expect(await screen.findByText('Campus parking tracker')).toBeInTheDocument();
  });
});

// --- ranking -------------------------------------------------------------

describe('ranking by fit', () => {
  test('orders the list best fit first', async () => {
    await renderBrowse();
    expect(cardTitles()).toEqual(['Campus parking tracker', 'Degree plan builder']);
  });

  test('shows the score, the band and a reason naming the skill', async () => {
    await renderBrowse();
    const card = screen.getByText('Campus parking tracker').closest('article');
    expect(within(card).getByText('50')).toBeInTheDocument();
    expect(within(card).getByText(/Partial fit/)).toBeInTheDocument();
    expect(within(card).getByText(/You cover Frontend Developer \(React\)/)).toBeInTheDocument();
  });

  test('the evidence loaded with the profile lifts a well-backed skill into the strong band', () => {
    // Without profile_evidence every skill scores as a bare tag and nobody
    // can reach 70, which is why getCurrentUser() loads it.
    client.getCurrentUser.mockResolvedValue({
      ...ME,
      evidence: { 's-react': { months: 14, projects: 3 } },
    });
    return renderBrowse().then(() => {
      const card = screen.getByText('Campus parking tracker').closest('article');
      expect(within(card).getByText(/Strong fit/)).toBeInTheDocument();
    });
  });

  test('a project nothing matches is scored as a long shot, with the reason why', async () => {
    await renderBrowse();
    const card = screen.getByText('Degree plan builder').closest('article');
    expect(within(card).getByText(/Long shot/)).toBeInTheDocument();
    expect(
      within(card).getByText(/None of the roles still open match the skills on your profile/)
    ).toBeInTheDocument();
  });
});

// --- filters -------------------------------------------------------------

describe('filters', () => {
  test('"Only show matches" changes the list and the count', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    expect(screen.getByText(/Showing 2 of 3 projects/)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Only show matches'));

    expect(cardTitles()).toEqual(['Campus parking tracker']);
    expect(screen.getByText(/Showing 1 of 3 projects/)).toBeInTheDocument();
  });

  test('the count of projects the student could fill a role on is shown', async () => {
    await renderBrowse();
    expect(screen.getByText(/1 you could fill a role on/)).toBeInTheDocument();
  });

  test('a project matched through a related skill survives "Only show matches"', async () => {
    const user = userEvent.setup();
    // Figma is Frontend, like React, so the engine credits it and the card
    // says so. The filter has to agree with the card.
    client.getProjects.mockResolvedValue([
      {
        ...PARKING,
        id: 'p-design',
        title: 'Design system',
        roles_needed: [role('r-design', 'UI/UX Designer', { id: 's-figma', name: 'Figma', category: 'Frontend' })],
      },
      DEGREE,
    ]);
    await renderBrowse();
    await user.click(screen.getByLabelText('Only show matches'));
    expect(cardTitles()).toEqual(['Design system']);
  });

  test('the search box filters on title and description', async () => {
    const user = userEvent.setup();
    await renderBrowse();

    await user.type(screen.getByLabelText('Search'), 'solver');
    expect(cardTitles()).toEqual(['Degree plan builder']);

    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), 'PARKING');
    expect(cardTitles()).toEqual(['Campus parking tracker']);
  });

  test('the role filter keeps only projects needing that role', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');
    expect(cardTitles()).toEqual(['Degree plan builder']);
  });

  test('filters stack, and clearing them brings everything back', async () => {
    const user = userEvent.setup();
    await renderBrowse();

    await user.type(screen.getByLabelText('Search'), 'parking');
    await user.selectOptions(screen.getByLabelText('Role'), 'r-backend');
    expect(screen.getByText(/No projects match these filters/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear filters/i }));
    expect(cardTitles()).toEqual(['Campus parking tracker', 'Degree plan builder']);
  });
});

// --- empty states --------------------------------------------------------

describe('empty states', () => {
  test('a search with no results explains how to see more', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    await user.type(screen.getByLabelText('Search'), 'blockchain');
    expect(screen.getByText('No projects match these filters.')).toBeInTheDocument();
    expect(screen.getByText(/Clear the filters, search for something broader/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear filters/i })).toBeInTheDocument();
  });

  test('no projects posted at all is not blamed on the filters', async () => {
    client.getProjects.mockResolvedValue([]);
    await renderBrowse();
    expect(screen.getByText('No projects have been posted yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear filters/i })).not.toBeInTheDocument();
  });

  test('every project full offers the switch that would show them', async () => {
    client.getProjects.mockResolvedValue([SCAM]);
    await renderBrowse();
    expect(screen.getByText('Every project is full right now.')).toBeInTheDocument();
    expect(screen.getByText(/Turn off "Open projects only" to see them anyway/)).toBeInTheDocument();
  });

  test('matches-only with no skills points at the profile, not the filters', async () => {
    const user = userEvent.setup();
    client.getCurrentUser.mockResolvedValue({ ...ME, skills: [] });
    await renderBrowse();
    // The switch is disabled precisely so this cannot be reached by clicking,
    // but the copy has to be right if it ever is.
    expect(screen.getByLabelText('Only show matches')).toBeDisabled();
    await user.click(screen.getByLabelText('Open projects only'));
    expect(screen.getByText('Campus parking tracker')).toBeInTheDocument();
  });
});

// --- a student with no skills -------------------------------------------

describe('a student with no skills listed', () => {
  beforeEach(() => {
    client.getCurrentUser.mockResolvedValue({ ...ME, skills: [] });
  });

  test('is told what to do about it, once, not on every card', async () => {
    await renderBrowse();
    expect(screen.getByText(/Add skills to your profile, or import your resume/)).toBeInTheDocument();
    expect(screen.queryByText(/Partial fit/)).not.toBeInTheDocument();
  });

  test('cannot filter to matches, because there is nothing to match on', async () => {
    await renderBrowse();
    expect(screen.getByLabelText('Only show matches')).toBeDisabled();
  });

  test('still sees every open project in the original order', async () => {
    await renderBrowse();
    expect(cardTitles()).toEqual(['Campus parking tracker', 'Degree plan builder']);
  });
});

// --- sad paths -----------------------------------------------------------

describe('when something fails to load', () => {
  test('the project list failing shows an error with a retry', async () => {
    client.getProjects.mockRejectedValueOnce(new Error('Network down'));
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Network down');

    client.getProjects.mockResolvedValue([PARKING]);
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Campus parking tracker')).toBeInTheDocument();
  });

  test('the roles list failing hides the role filter and nothing else', async () => {
    client.getRoles.mockRejectedValue(new Error('roles unavailable'));
    await renderBrowse();
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument();
    expect(cardTitles()).toEqual(['Campus parking tracker', 'Degree plan builder']);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  test('the profile failing drops the ranking but keeps the projects', async () => {
    client.getCurrentUser.mockRejectedValue(new Error('profile unavailable'));
    await renderBrowse();
    expect(await screen.findByText(/aren't ranked/)).toBeInTheDocument();
    expect(screen.queryByText(/Partial fit/)).not.toBeInTheDocument();
    expect(cardTitles()).toEqual(['Campus parking tracker', 'Degree plan builder']);
  });

  test('a failed profile can be retried without reloading the page', async () => {
    client.getCurrentUser.mockRejectedValueOnce(new Error('profile unavailable'));
    await renderBrowse();
    await screen.findByText(/aren't ranked/);

    client.getCurrentUser.mockResolvedValue(ME);
    await userEvent.setup().click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText(/Partial fit/)).toBeInTheDocument();
  });
});

// --- guests --------------------------------------------------------------

describe('a guest', () => {
  beforeEach(() => {
    session = { status: 'guest', user: null };
  });

  test('sees the projects but no scores and no match filter', async () => {
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>
    );
    await screen.findByText('Campus parking tracker');
    expect(client.getCurrentUser).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Only show matches')).not.toBeInTheDocument();
    expect(screen.queryByText(/Partial fit/)).not.toBeInTheDocument();
  });

  test('can still search', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>
    );
    await screen.findByText('Campus parking tracker');
    await user.type(screen.getByLabelText('Search'), 'solver');
    expect(cardTitles()).toEqual(['Degree plan builder']);
  });

  test('is sent to sign in instead of being allowed to request', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Browse />
      </MemoryRouter>
    );
    await screen.findByText('Campus parking tracker');
    await user.click(screen.getAllByRole('button', { name: /sign in to request/i })[0]);
    expect(navigate).toHaveBeenCalledWith('/login', {
      state: { from: { pathname: '/browse' } },
    });
    expect(client.createJoinRequest).not.toHaveBeenCalled();
  });
});

// --- requesting to join --------------------------------------------------

describe('requesting to join', () => {
  test('sends the request for the project whose button was pressed', async () => {
    const user = userEvent.setup();
    await renderBrowse();
    const card = screen.getByText('Campus parking tracker').closest('article');
    await user.click(within(card).getByRole('button', { name: /request to join/i }));
    await user.click(within(card).getByRole('button', { name: /send request/i }));
    await waitFor(() => expect(client.createJoinRequest).toHaveBeenCalledWith('p-parking', ''));
    expect(within(card).getByRole('button', { name: /request pending/i })).toBeDisabled();
  });

  test('a rejected request shows the reason on that card, and leaves the rest alone', async () => {
    const user = userEvent.setup();
    client.createJoinRequest.mockRejectedValue(new Error('You already have a pending request'));
    await renderBrowse();
    const card = screen.getByText('Campus parking tracker').closest('article');
    await user.click(within(card).getByRole('button', { name: /request to join/i }));
    await user.click(within(card).getByRole('button', { name: /send request/i }));

    expect(await within(card).findByRole('alert')).toHaveTextContent(
      'You already have a pending request'
    );
    const other = screen.getByText('Degree plan builder').closest('article');
    expect(within(other).queryByRole('alert')).not.toBeInTheDocument();
  });
});
