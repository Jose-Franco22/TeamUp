// Issue #52 — the first-sign-in walkthrough opens on a choice between
// creating a team and joining one, then shows only that path's steps.
// The session, router navigation and skill widgets are mocked so each test
// can check exactly where the tour sends the student and that finishing or
// skipping marks them onboarded.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Walkthrough from './Walkthrough';
import * as client from '../api/client';

const navigate = vi.fn();
const completeOnboarding = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../auth/SessionContext', () => ({
  useSession: () => ({ user: { id: 'u-jose', name: 'Jose Franco' }, completeOnboarding }),
}));

vi.mock('../api/client', () => ({ getCurrentUser: vi.fn() }));
vi.mock('./SkillPicker', () => ({ default: () => null }));
vi.mock('./ResumeImport', () => ({ default: () => null }));

beforeEach(() => {
  navigate.mockReset();
  completeOnboarding.mockReset();
  client.getCurrentUser.mockResolvedValue({ id: 'u-jose', skills: [] });
});

function renderTour() {
  const { unmount } = render(
    <MemoryRouter>
      <Walkthrough />
    </MemoryRouter>
  );
  return { dialog: screen.getByRole('dialog'), user: userEvent.setup(), unmount };
}

const JOIN_STEPS = ['List your skills', 'Browse open projects', 'Request to join'];
const CREATE_STEPS = ['List your skills', 'Post your project', 'Review join requests'];

// Walks a path from its first step to its last, checking the heading and
// the step counter on each one.
async function walk(user, dialog, steps) {
  for (const [i, title] of steps.entries()) {
    expect(within(dialog).getByRole('heading', { name: title })).toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: `Step ${i + 1} of ${steps.length}` })).toBeInTheDocument();
    if (i < steps.length - 1) await user.click(within(dialog).getByRole('button', { name: 'Next' }));
  }
  expect(within(dialog).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
}

describe('choice screen', () => {
  test('offers exactly Create a team and Join a team, with no step content', async () => {
    const { dialog } = renderTour();

    expect(within(dialog).getByRole('heading', { name: 'Are you creating a team or joining one?' })).toBeInTheDocument();
    const choices = within(dialog)
      .getAllByRole('button')
      .filter((b) => b.classList.contains('tour-choice'));
    expect(choices.map((b) => b.querySelector('b').textContent)).toEqual(['Create a team', 'Join a team']);

    expect(within(dialog).queryByRole('list', { name: /^Step / })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { name: 'List your skills' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(client.getCurrentUser).not.toHaveBeenCalled();
  });

  test('says the choice does not lock the student in', () => {
    const { dialog } = renderTour();
    expect(within(dialog).getByText(/still create or join a team from the menu afterward/)).toBeInTheDocument();
  });
});

describe('join path', () => {
  test('shows the join steps and finishing goes to /browse', async () => {
    const { dialog, user } = renderTour();
    await user.click(within(dialog).getByRole('button', { name: /Join a team/ }));

    await walk(user, dialog, JOIN_STEPS);
    expect(completeOnboarding).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Browse projects' }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/browse');
  });
});

describe('create path', () => {
  test('shows the create steps and finishing goes to /projects/new', async () => {
    const { dialog, user } = renderTour();
    await user.click(within(dialog).getByRole('button', { name: /Create a team/ }));

    await walk(user, dialog, CREATE_STEPS);
    expect(completeOnboarding).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Create your project' }));

    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/projects/new');
  });
});

describe('Back', () => {
  test.each([
    ['Join a team', JOIN_STEPS],
    ['Create a team', CREATE_STEPS],
  ])('from the first step of %s returns to the choice screen', async (choice, steps) => {
    const { dialog, user } = renderTour();
    await user.click(within(dialog).getByRole('button', { name: new RegExp(choice) }));

    // Back from a later step goes one step back, not to the choice screen.
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('heading', { name: steps[0] })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('heading', { name: 'Are you creating a team or joining one?' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('list', { name: /^Step / })).not.toBeInTheDocument();
    expect(completeOnboarding).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  test('switching paths after going back starts the other path at its first step', async () => {
    const { dialog, user } = renderTour();
    await user.click(within(dialog).getByRole('button', { name: /Join a team/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    await user.click(within(dialog).getByRole('button', { name: /Create a team/ }));
    await walk(user, dialog, CREATE_STEPS);
  });
});

describe('Skip', () => {
  test('from the choice screen marks the student onboarded and goes to /browse', async () => {
    const { dialog, user } = renderTour();
    await user.click(within(dialog).getByRole('button', { name: 'Skip tour' }));
    expect(completeOnboarding).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/browse');
  });

  test.each([
    ['Join a team', JOIN_STEPS],
    ['Create a team', CREATE_STEPS],
  ])('from every step of %s marks the student onboarded and goes to /browse', async (choice, steps) => {
    for (let at = 0; at < steps.length; at++) {
      navigate.mockReset();
      completeOnboarding.mockReset();
      const { dialog, user, unmount } = renderTour();
      await user.click(within(dialog).getByRole('button', { name: new RegExp(choice) }));
      for (let i = 0; i < at; i++) await user.click(within(dialog).getByRole('button', { name: 'Next' }));
      expect(within(dialog).getByRole('heading', { name: steps[at] })).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Skip tour' }));
      expect(completeOnboarding).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('/browse');
      unmount();
    }
  });
});
