import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminTeam from './AdminTeam';
import { getAdminTeam } from '../api/client';
import { OPEN_TEAM } from '../test/adminFixtures';

vi.mock('../api/client', () => ({ getAdminTeam: vi.fn() }));
beforeEach(() => getAdminTeam.mockReset().mockResolvedValue(OPEN_TEAM));

function renderTeam() {
  render(<MemoryRouter initialEntries={['/admin/teams/team-open']}>
    <Routes><Route path="/admin/teams/:teamId" element={<AdminTeam />} /></Routes>
  </MemoryRouter>);
}

test('opens the selected team with its roster, open roles and pending applicants', async () => {
  renderTeam();
  expect(await screen.findByRole('heading', { name: 'Campus parking tracker' })).toBeInTheDocument();
  expect(getAdminTeam).toHaveBeenCalledWith('team-open');
  expect(screen.getByText('Track campus parking availability.')).toBeInTheDocument();
  expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
  expect(screen.getByText('Backend Developer · 14 hrs/wk')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Adan Barrera' })).toHaveAttribute('href', '/admin/students/adan');
  expect(screen.getByRole('link', { name: 'Back to dashboard' })).toHaveAttribute('href', '/admin');
  expect(screen.queryByRole('button', { name: /remove|delete|accept|decline|edit/i })).not.toBeInTheDocument();
});

test('an absent or inaccessible team shows the server error without team data', async () => {
  getAdminTeam.mockRejectedValueOnce(new Error('Team not found'));
  renderTeam();
  expect(await screen.findByRole('alert')).toHaveTextContent('Team not found');
  expect(screen.queryByText('Track campus parking availability.')).not.toBeInTheDocument();
});
