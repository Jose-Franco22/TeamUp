import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MemberStrip from './MemberStrip';

test('signed-in students see who is on the team before asking to join', () => {
  render(
    <MemberStrip
      members={[{ user_id: 'u1', name: 'Maria Lopez', role: 'Frontend Developer' }]}
      targetSize={3}
    />,
  );
  expect(screen.getByText('Maria Lopez')).toBeInTheDocument();
  expect(screen.getAllByText('Open seat')).toHaveLength(2);
});

test('guests get the seat count and a prompt to sign in, not the roster', () => {
  render(
    <MemoryRouter>
      <MemberStrip members={[]} memberCount={2} targetSize={4} isAuthenticated={false} />
    </MemoryRouter>,
  );
  expect(screen.getByText('2 of 4 seats filled')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: "Sign in to see who's on this team" })).toHaveAttribute('href', '/login');
  expect(screen.queryByText('Open seat')).not.toBeInTheDocument();
});
