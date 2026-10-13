import { beforeEach, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminStudent from './AdminStudent';
import { getAdminStudent } from '../api/client';
import { QUIET_STUDENT, UNPLACED_STUDENT } from '../test/adminFixtures';

vi.mock('../api/client', () => ({ getAdminStudent: vi.fn() }));
beforeEach(() => getAdminStudent.mockReset().mockResolvedValue(UNPLACED_STUDENT));

function renderStudent() {
  render(<MemoryRouter initialEntries={['/admin/students/adan']}>
    <Routes><Route path="/admin/students/:studentId" element={<AdminStudent />} /></Routes>
  </MemoryRouter>);
}

test('opens an unplaced student profile with skills, availability and pending requests', async () => {
  renderStudent();
  expect(await screen.findByRole('heading', { name: 'Adan Barrera' })).toBeInTheDocument();
  expect(getAdminStudent).toHaveBeenCalledWith('adan');
  expect(screen.getByText('React')).toBeInTheDocument();
  expect(screen.getByText('12 hrs/wk')).toBeInTheDocument();
  expect(screen.getByText('Not on a team.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'GitHub profile' })).toHaveAttribute('href', 'https://github.com/adanbarrera');
  expect(screen.getByRole('link', { name: 'Campus parking tracker' })).toHaveAttribute('href', '/admin/teams/team-open');
  expect(screen.queryByRole('button', { name: /save|assign|remove/i })).not.toBeInTheDocument();
});

test('a placed student links to their team and role', async () => {
  getAdminStudent.mockResolvedValueOnce({
    ...UNPLACED_STUDENT, pending_requests: [],
    membership: { team_id: 'team-full', project_title: 'Lab equipment sign-out', role_name: 'Frontend Developer' },
  });
  renderStudent();
  expect(await screen.findByRole('link', { name: 'Lab equipment sign-out' })).toHaveAttribute('href', '/admin/teams/team-full');
  expect(screen.getByText('Frontend Developer')).toBeInTheDocument();
  expect(screen.getByText('No pending requests')).toBeInTheDocument();
});

test('optional profile fields and empty skills/requests have readable empty states', async () => {
  getAdminStudent.mockResolvedValueOnce(QUIET_STUDENT);
  renderStudent();
  expect(await screen.findByText('No bio provided.')).toBeInTheDocument();
  expect(screen.getByText('Not provided')).toBeInTheDocument();
  expect(screen.getByText('No skills listed.')).toBeInTheDocument();
  expect(screen.getByText('No pending requests')).toBeInTheDocument();
});

test('an absent or inaccessible student shows the server error', async () => {
  getAdminStudent.mockRejectedValueOnce(new Error('Student not found'));
  renderStudent();
  expect(await screen.findByRole('alert')).toHaveTextContent('Student not found');
  expect(screen.queryByText('abarrera01@utrgv.edu')).not.toBeInTheDocument();
});
