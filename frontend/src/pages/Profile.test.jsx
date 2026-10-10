// Issue #17 — UI tests for the profile form (runs against the mock API).
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Profile from './Profile';
import * as client from '../api/client';
import { users } from '../api/mockData';
import { ValidationError } from '../lib/validation';

// Wrap updateCurrentUser in a spy that still calls the real (mock-mode)
// implementation, so individual tests can force a server error.
vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, updateCurrentUser: vi.fn(actual.updateCurrentUser) };
});

const ME = 'u-jose';

beforeEach(() => {
  client.setSessionUserId(ME);
  Object.assign(
    users.find((u) => u.id === ME),
    { bio: 'Data and computer vision.', availability_hours: 12, github_url: 'https://github.com/Jose-Franco22' }
  );
});

async function renderProfile() {
  render(
    <MemoryRouter>
      <Profile />
    </MemoryRouter>
  );
  await screen.findByRole('heading', { name: 'Your profile' });
  return {
    bio: screen.getByLabelText('Bio'),
    github: screen.getByLabelText('GitHub URL'),
    hours: screen.getByLabelText('Availability'),
    save: screen.getByRole('button', { name: /save changes/i }),
  };
}

describe('availability', () => {
  test('typing 500 shows an inline error and disables Save', async () => {
    const user = userEvent.setup();
    const { hours, save } = await renderProfile();
    await user.clear(hours);
    await user.type(hours, '500');
    expect(screen.getByText('Hours must be between 0 and 40')).toBeInTheDocument();
    expect(hours).toHaveAttribute('aria-invalid', 'true');
    expect(save).toBeDisabled();
  });

  test('an empty value is an error, not a silent 0', async () => {
    const user = userEvent.setup();
    const { hours, save } = await renderProfile();
    await user.clear(hours);
    expect(screen.getByText(/Enter how many hours/)).toBeInTheDocument();
    expect(save).toBeDisabled();
  });
});

describe('GitHub URL', () => {
  test('an invalid link shows an error under that field', async () => {
    const user = userEvent.setup();
    const { github, save } = await renderProfile();
    await user.clear(github);
    await user.type(github, 'gitlab.com/jose');
    const error = screen.getByText(/github\.com\/your-username/, { selector: '.inline-error' });
    expect(github).toHaveAttribute('aria-describedby', error.id);
    expect(save).toBeDisabled();
  });

  test('clearing the link is allowed', async () => {
    const user = userEvent.setup();
    const { github, save } = await renderProfile();
    await user.clear(github);
    expect(github).toHaveAttribute('aria-invalid', 'false');
    expect(save).toBeEnabled();
  });
});

describe('bio', () => {
  test('the counter tracks length and turns to an error past 500', async () => {
    const { bio, save } = await renderProfile();
    const counter = screen.getByTestId('bio-counter');

    fireEvent.change(bio, { target: { value: 'a'.repeat(500) } });
    expect(counter).toHaveTextContent('500/500');
    expect(counter).not.toHaveClass('over');
    expect(save).toBeEnabled();

    fireEvent.change(bio, { target: { value: 'a'.repeat(501) } });
    expect(counter).toHaveTextContent('501/500');
    expect(counter).toHaveClass('over');
    expect(screen.getByText('Bio can be at most 500 characters')).toBeInTheDocument();
    expect(save).toBeDisabled();
  });
});

describe('saving', () => {
  test('valid changes save trimmed values and show "Saved"', async () => {
    const user = userEvent.setup();
    const { bio, hours, save } = await renderProfile();
    await user.clear(bio);
    await user.type(bio, '  Backend and data.  ');
    await user.clear(hours);
    await user.type(hours, '20');
    await user.click(save);

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(client.updateCurrentUser).toHaveBeenCalledWith({
      bio: 'Backend and data.',
      github_url: 'https://github.com/Jose-Franco22',
      availability_hours: 20,
    });
  });

  test('a field error from the server is shown next to that field', async () => {
    client.updateCurrentUser.mockRejectedValueOnce(
      new ValidationError({ github_url: 'Use your GitHub profile link, like https://github.com/your-username' })
    );
    const user = userEvent.setup();
    const { bio, github, save } = await renderProfile();
    await user.type(bio, ' more');
    await user.click(save);

    const error = await screen.findByText(/github\.com\/your-username/, { selector: '.inline-error' });
    expect(github).toHaveAttribute('aria-describedby', error.id);

    // Editing the field clears the server's message for it.
    await user.type(github, '/');
    await waitFor(() => expect(github).toHaveAttribute('aria-invalid', 'false'));
  });

  test('any other server error is shown on the form, not as a blank failure', async () => {
    client.updateCurrentUser.mockRejectedValueOnce(new Error('Network request failed'));
    const user = userEvent.setup();
    const { bio, save } = await renderProfile();
    await user.type(bio, ' more');
    await user.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network request failed');
  });

  test('an invalid value already saved is flagged on load and must be fixed before saving', async () => {
    users.find((u) => u.id === ME).github_url = 'not a link';
    const user = userEvent.setup();
    const { bio, github, save } = await renderProfile();
    expect(github).toHaveAttribute('aria-invalid', 'true');
    await user.type(bio, ' more');
    expect(save).toBeDisabled();
  });
});

describe('client.updateCurrentUser', () => {
  test('rejects invalid input without saving anything', async () => {
    const before = { ...users.find((u) => u.id === ME) };
    await expect(client.updateCurrentUser({ availability_hours: 41 })).rejects.toBeInstanceOf(ValidationError);
    await expect(client.updateCurrentUser({ github_url: 'javascript:alert(1)' })).rejects.toThrow(/GitHub/);
    expect(users.find((u) => u.id === ME)).toMatchObject(before);
  });
});
