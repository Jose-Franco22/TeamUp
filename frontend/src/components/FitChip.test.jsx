// The score on a Browse card, and the button that asks an LLM to re-judge it.
//
// The rule the whole feature rests on: the point score is already on screen,
// so the AI review can only ever add to it. Every failure below has to leave
// a working card behind.
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FitChip from './FitChip';
import * as judge from '../lib/matching/judge';

vi.mock('../lib/matching/judge', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, judgeIsAvailable: vi.fn(() => true), requestVerdict: vi.fn() };
});

const PROJECT = {
  id: 'p-1',
  title: 'Campus parking tracker',
  description: 'Live lot occupancy from camera feeds.',
  avg_availability_hours: 12,
  roles_needed: [
    { role_id: 'r-fe', role_name: 'Frontend Developer', skill_id: 's-react', skill_name: 'React', quantity_needed: 2 },
  ],
};
const STUDENT = {
  availability_hours: 12,
  skills: [{ id: 's-react', name: 'React', category: 'Frontend', source: 'manual' }],
  evidence: { 's-react': { months: 14, projects: 3 } },
};
const FIT = {
  status: 'ok',
  points: 86,
  band: 'strong',
  parts: { primaryFit: 1, scarcity: 0.5, depth: 1, hoursFit: 1, extraCoverage: 0.5 },
  reasons: ['You cover Frontend Developer (React) — 14 months, 3 projects behind it.'],
};

const renderChip = (props = {}) =>
  render(<FitChip fit={FIT} project={PROJECT} student={STUDENT} {...props} />);

const ring = () => document.querySelector('.fit-ring');
const ringNumber = () => document.querySelector('.ring-number').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  judge.judgeIsAvailable.mockReturnValue(true);
});

// --- before the button is pressed -----------------------------------------

describe('the point score', () => {
  test('is in the ring, labelled as the point score', () => {
    renderChip();
    expect(ringNumber()).toBe('86');
    expect(screen.getByText('Strong fit')).toBeInTheDocument();
    expect(screen.getByText('Point score')).toBeInTheDocument();
  });

  test('reads as a number out of 100 for a screen reader', () => {
    renderChip();
    expect(ring()).toHaveTextContent('86 out of 100');
  });

  test('the ring is filled in proportion to the score', () => {
    renderChip({ fit: { ...FIT, points: 50 } });
    const value = document.querySelector('.ring-value');
    const [filled, rest] = value.getAttribute('stroke-dasharray').split(' ').map(Number);
    expect(filled / (filled + rest)).toBeCloseTo(0.5, 2);
  });

  test('the reasons the point system gave are still shown', () => {
    renderChip();
    expect(screen.getByText(/You cover Frontend Developer \(React\)/)).toBeInTheDocument();
  });

  test('nothing is asked of the LLM until the button is pressed', () => {
    renderChip();
    expect(judge.requestVerdict).not.toHaveBeenCalled();
  });
});

// --- the verdict arrives ---------------------------------------------------

describe('when the AI review comes back', () => {
  test('its score replaces the number in the ring', async () => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValue({
      ok: true,
      verdict: { points: 41, band: 'partial', verdict: 'They need two React developers; you are one.' },
    });
    renderChip();

    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));

    await waitFor(() => expect(ringNumber()).toBe('41'));
    expect(screen.getByText('Partial fit')).toBeInTheDocument();
  });

  // The two numbers can disagree — that is the point of a second opinion —
  // so the one it started from stays readable rather than vanishing.
  test('the point score it started from is still stated', async () => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValue({
      ok: true,
      verdict: { points: 41, band: 'partial', verdict: 'Fine.' },
    });
    renderChip();
    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));

    expect(await screen.findByText('AI review · point score was 86')).toBeInTheDocument();
  });

  test('the verdict is on the ring, so a disagreeing number can explain itself', async () => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValue({
      ok: true,
      verdict: { points: 41, band: 'partial', verdict: 'They need two React developers; you are one.' },
    });
    renderChip();
    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));

    await waitFor(() =>
      expect(ring()).toHaveAttribute('title', 'They need two React developers; you are one.')
    );
  });

  test('the button goes away — one verdict per card is enough', async () => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValue({ ok: true, verdict: { points: 41, band: 'partial', verdict: 'x' } });
    renderChip();
    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: /AI verdict/ })).not.toBeInTheDocument());
    expect(judge.requestVerdict).toHaveBeenCalledTimes(1);
  });

  test('it says it is working while it waits', async () => {
    const user = userEvent.setup();
    let release;
    judge.requestVerdict.mockReturnValue(new Promise((r) => { release = r; }));
    renderChip();

    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));
    const pending = screen.getByRole('button', { name: 'Reviewing…' });
    expect(pending).toBeDisabled();

    release({ ok: true, verdict: { points: 41, band: 'partial', verdict: 'x' } });
    await waitFor(() => expect(ringNumber()).toBe('41'));
  });

  test('what it is given carries the project, the student and the jury working', async () => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValue({ ok: true, verdict: { points: 41, band: 'partial', verdict: 'x' } });
    renderChip();
    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));

    await waitFor(() => expect(judge.requestVerdict).toHaveBeenCalled());
    expect(judge.requestVerdict).toHaveBeenCalledWith({ project: PROJECT, student: STUDENT, fit: FIT });
  });
});

// --- when it cannot be had -------------------------------------------------

describe('when the AI review fails', () => {
  test.each([
    ['the key is not set', 'The AI review isn’t set up yet, so this is the point score.'],
    ['the rate limit is hit', 'The AI review is busy right now — try again in a minute.'],
    ['it times out', 'The AI review took too long, so this is the point score.'],
  ])('%s: the point score stays and the reason is shown', async (_label, message) => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValue({ ok: false, reason: 'whatever', message });
    renderChip();

    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));

    expect(await screen.findByText(message)).toBeInTheDocument();
    // The thing that matters: the card still has its score.
    expect(ringNumber()).toBe('86');
    expect(screen.getByText('Point score')).toBeInTheDocument();
  });

  test('it can be tried again', async () => {
    const user = userEvent.setup();
    judge.requestVerdict.mockResolvedValueOnce({ ok: false, reason: 'timeout', message: 'Too slow.' });
    renderChip();
    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));
    await screen.findByText('Too slow.');

    judge.requestVerdict.mockResolvedValue({ ok: true, verdict: { points: 70, band: 'strong', verdict: 'x' } });
    await user.click(screen.getByRole('button', { name: 'Get AI verdict' }));
    await waitFor(() => expect(ringNumber()).toBe('70'));
  });
});

// --- when the button should not be there at all ----------------------------

describe('the button is not offered', () => {
  test('when Supabase is not configured, so the call could not be made', () => {
    judge.judgeIsAvailable.mockReturnValue(false);
    renderChip();
    expect(screen.queryByRole('button', { name: /AI verdict/ })).not.toBeInTheDocument();
    expect(ringNumber()).toBe('86');
  });

  test('when nothing matched — the point system is already sure, so it would waste a call', () => {
    renderChip({ fit: { ...FIT, points: 0, band: 'long-shot', reasons: ['None of the roles still open match.'] } });
    expect(screen.queryByRole('button', { name: /AI verdict/ })).not.toBeInTheDocument();
  });

  test('on a guest card, where there is no student to judge', () => {
    render(<FitChip fit={FIT} project={PROJECT} student={null} />);
    expect(screen.queryByRole('button', { name: /AI verdict/ })).not.toBeInTheDocument();
  });
});

// --- the states that are not scores ----------------------------------------

describe('the cases with nothing to score', () => {
  test('no fit at all renders nothing', () => {
    const { container } = render(<FitChip fit={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a student with no skills gets no ring — the page prompts them instead', () => {
    const { container } = render(<FitChip fit={{ status: 'no-skills', points: 0, band: null, reasons: ['Add skills'] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  test('a project with no open roles says so, with no number', () => {
    render(
      <FitChip fit={{ status: 'no-open-roles', points: 0, band: null, reasons: ['This project has no open roles listed.'] }} />
    );
    expect(screen.getByText('This project has no open roles listed.')).toBeInTheDocument();
    expect(document.querySelector('.fit-ring')).toBeNull();
  });
});
