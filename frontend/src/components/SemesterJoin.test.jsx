// The "Join <semester>" prompt (50_semesters.sql, decision 9).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const api = vi.hoisted(() => ({
  getCurrentSemester: vi.fn(),
  enrollInCurrentSemester: vi.fn(),
}));
vi.mock('../api/client', () => api);

import SemesterJoin from './SemesterJoin';

const SPRING = { id: 'sem-spring', name: 'Spring 2027', needs_enrollment: true };

beforeEach(() => {
  localStorage.clear();
  api.getCurrentSemester.mockResolvedValue(SPRING);
  api.enrollInCurrentSemester.mockResolvedValue({ ...SPRING, needs_enrollment: false });
});

afterEach(() => localStorage.clear());

describe('SemesterJoin', () => {
  test('asks a student who is not in the semester, and joining makes it go away', async () => {
    render(<SemesterJoin />);
    const join = await screen.findByRole('button', { name: 'Join Spring 2027' });
    await userEvent.click(join);
    expect(api.enrollInCurrentSemester).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Join Spring 2027' })).not.toBeInTheDocument();
  });

  test('says nothing to someone already in it, or when no semester is open', async () => {
    api.getCurrentSemester.mockResolvedValueOnce({ ...SPRING, needs_enrollment: false });
    const { unmount } = render(<SemesterJoin />);
    await vi.waitFor(() => expect(api.getCurrentSemester).toHaveBeenCalled());
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    unmount();

    api.getCurrentSemester.mockResolvedValueOnce(null);
    render(<SemesterJoin />);
    await vi.waitFor(() => expect(api.getCurrentSemester).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  test('"Not this semester" hides it for this semester without enrolling', async () => {
    const { unmount } = render(<SemesterJoin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Not this semester' }));
    expect(api.enrollInCurrentSemester).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Join Spring 2027' })).not.toBeInTheDocument();
    unmount();

    // Still hidden on the next visit in this browser.
    render(<SemesterJoin />);
    await vi.waitFor(() => expect(api.getCurrentSemester).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('region', { name: 'Join Spring 2027' })).not.toBeInTheDocument();
  });

  test("shows the server's refusal and keeps the button", async () => {
    api.enrollInCurrentSemester.mockRejectedValueOnce(new Error('No semester is open right now'));
    render(<SemesterJoin />);
    await userEvent.click(await screen.findByRole('button', { name: 'Join Spring 2027' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No semester is open right now');
    expect(screen.getByRole('button', { name: 'Join Spring 2027' })).toBeEnabled();
  });
});
