// Issue #60 — the adviser's own settings on the Profile page.
//
// The first two tests are the ones that are really about the decision rather
// than the code. Criterion 1 says "any user can turn on Available to
// advise", and this card appears for faculty only — because #99 made advising
// faculty-only after that criterion was written, so a student setting a
// maximum would be setting one nobody can reach and listing areas nobody can
// search. The reasoning is in supabase/48_adviser_expertise.sql; what is
// pinned here is that the card is absent, not merely inert.
//
// The third is #60's own UI criterion: the fields appear only while the
// switch is on.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdvisingCard from './AdvisingCard';
import * as client from '../api/client';
import { ValidationError } from '../lib/validation';

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    myAdvising: vi.fn(),
    setAdvisingAvailable: vi.fn(),
    setAdvisingMaxTeams: vi.fn(),
    addExpertise: vi.fn(),
    removeExpertise: vi.fn(),
  };
});

const FACULTY = {
  is_faculty: true,
  available: true,
  max_teams: null,
  advising: 0,
  is_full: false,
  expertise: [],
};

const state = (over = {}) => ({ ...FACULTY, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  client.myAdvising.mockResolvedValue(state());
});

async function renderCard(over) {
  if (over) client.myAdvising.mockResolvedValue(state(over));
  render(<AdvisingCard />);
  await waitFor(() => expect(client.myAdvising).toHaveBeenCalled());
  return screen.queryByRole('region', { name: 'Advising' });
}

const card = () => screen.getByRole('region', { name: 'Advising' });
const switchBox = () => screen.getByRole('checkbox', { name: /Available to advise/ });
const maxField = () => screen.getByLabelText(/Most teams I/);

describe('who sees it', () => {
  test('a faculty account gets the card', async () => {
    await renderCard();
    expect(card()).toBeInTheDocument();
  });

  test('a student gets nothing at all — not an empty card, not a disabled one', async () => {
    await renderCard({ is_faculty: false });
    expect(screen.queryByRole('region', { name: 'Advising' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Available to advise/ })).not.toBeInTheDocument();
  });

  test('says so quietly when the settings cannot be read, rather than taking over the page', async () => {
    client.myAdvising.mockRejectedValue(new Error('network'));
    render(<AdvisingCard />);
    expect(await screen.findByText(/Could not load your advising settings/)).toBeInTheDocument();
  });
});

describe('the switch', () => {
  test('is on by default, which is the opt-out decision made visible', async () => {
    await renderCard();
    expect(switchBox()).toBeChecked();
  });

  test('turning it off saves straight away and says what that did and did not do', async () => {
    client.setAdvisingAvailable.mockResolvedValue(state({ available: false, advising: 2 }));
    await renderCard({ advising: 2 });

    await userEvent.click(switchBox());

    expect(client.setAdvisingAvailable).toHaveBeenCalledWith(false);
    expect(await screen.findByText(/hidden from adviser search/)).toBeInTheDocument();
    expect(screen.getByText(/2 teams you already advise are unaffected/)).toBeInTheDocument();
  });

  test('a failed save says so and leaves the box as the server has it', async () => {
    client.setAdvisingAvailable.mockRejectedValue(new Error('Could not reach the server'));
    await renderCard();

    await userEvent.click(switchBox());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
    expect(switchBox()).toBeChecked();
  });
});

describe('the fields appear only while the switch is on', () => {
  test('on: the maximum and the areas are both there', async () => {
    await renderCard({ available: true });
    expect(maxField()).toBeInTheDocument();
    expect(card()).toHaveTextContent('Areas I advise in');
  });

  test('off: neither is, because there is nothing for them to affect', async () => {
    await renderCard({ available: false });
    expect(screen.queryByLabelText(/Most teams I/)).not.toBeInTheDocument();
    expect(card()).not.toHaveTextContent('Areas I advise in');
  });
});

describe('the maximum', () => {
  test('starts empty for no limit, and saving sends what was typed', async () => {
    client.setAdvisingMaxTeams.mockResolvedValue(state({ max_teams: 3 }));
    await renderCard();

    expect(maxField()).toHaveValue(null);
    await userEvent.type(maxField(), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(client.setAdvisingMaxTeams).toHaveBeenCalledWith('3');
  });

  test('Save is disabled until the number differs from the stored one', async () => {
    await renderCard({ max_teams: 4 });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.clear(maxField());
    await userEvent.type(maxField(), '5');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  test('a rejected number lands next to the field in the words the form would have used', async () => {
    client.setAdvisingMaxTeams.mockRejectedValue(
      new ValidationError({ advising_max_teams: 'The most teams you’ll advise has to be between 1 and 20' })
    );
    await renderCard();

    await userEvent.type(maxField(), '99');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('has to be between 1 and 20');
  });

  test('tells an adviser who is already over their new limit what that means', async () => {
    await renderCard({ max_teams: 1, advising: 1, is_full: true });
    expect(card()).toHaveTextContent('which is your limit');
    expect(card()).toHaveTextContent('Lowering the number below that keeps the teams you have');
  });
});

describe('the areas', () => {
  test('says what an empty list means to an owner searching', async () => {
    await renderCard();
    expect(card()).toHaveTextContent(/Nothing listed yet/);
  });

  test('lists them, and removing one goes through removeExpertise', async () => {
    client.removeExpertise.mockResolvedValue(state({ expertise: [] }));
    await renderCard({
      expertise: [{ id: 's-python', name: 'Python', category: 'Data' }],
    });

    expect(card()).toHaveTextContent('Python');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Python' }));

    expect(client.removeExpertise).toHaveBeenCalledWith('s-python');
    await waitFor(() => expect(card()).toHaveTextContent(/Nothing listed yet/));
  });

  // The picker is shared with the Skills section above it, and the one thing
  // that must not be shared is which table it writes to: an adviser's areas
  // are adviser_expertise, not user_skills, and resume import writes the
  // latter.
  test('the picker adds an area rather than a skill', async () => {
    client.addExpertise.mockResolvedValue(
      state({ expertise: [{ id: 's-react', name: 'React', category: 'Frontend' }] })
    );
    await renderCard();

    await userEvent.click(screen.getByRole('button', { name: 'Add an area' }));
    await userEvent.click(await screen.findByRole('option', { name: /React/ }));

    expect(client.addExpertise).toHaveBeenCalledWith('s-react');
    await waitFor(() => expect(card()).toHaveTextContent('React'));
  });
});
