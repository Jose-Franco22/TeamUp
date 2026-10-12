import { expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import MemberStrip from './MemberStrip';

test('hidden roster identities do not turn occupied seats into open seats', () => {
  render(<MemberStrip members={[]} memberCount={3} targetSize={4} />);
  expect(screen.getByText('3 of 4 seats filled')).toBeInTheDocument();
  expect(screen.getAllByText('Open seat')).toHaveLength(1);
});
