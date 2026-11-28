import { describe, expect, test } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import useAsync from './useAsync';

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useAsync', () => {
  test('a reload wins over an older load that answers after it', async () => {
    const first = deferred();
    const second = deferred();
    const answers = [first.promise, second.promise];
    const { result } = renderHook(() => useAsync(() => answers.shift(), []));

    act(() => {
      result.current.reload();
    });
    await act(async () => second.resolve('fresh'));
    await waitFor(() => expect(result.current.data).toBe('fresh'));
    await act(async () => first.resolve('stale'));
    expect(result.current.data).toBe('fresh');
    expect(result.current.loading).toBe(false);
  });

  test('an answer after unmount is ignored', async () => {
    const only = deferred();
    const { result, unmount } = renderHook(() => useAsync(() => only.promise, []));
    expect(result.current.loading).toBe(true);
    unmount();
    await act(async () => only.resolve('late'));
    expect(result.current.data).toBeNull();
  });

  test('reports an error and stops loading', async () => {
    const { result } = renderHook(() => useAsync(() => Promise.reject(new Error('nope')), []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error.message).toBe('nope');
  });
});
