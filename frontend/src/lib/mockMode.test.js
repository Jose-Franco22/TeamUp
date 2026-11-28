import { describe, expect, it } from 'vitest';
import { isMisconfigured, mocksOn } from './mockMode';

describe('mocksOn', () => {
  it('follows an explicit setting in any build', () => {
    expect(mocksOn({ VITE_USE_MOCKS: 'true', PROD: true })).toBe(true);
    expect(mocksOn({ VITE_USE_MOCKS: 'false', PROD: false })).toBe(false);
    expect(mocksOn({ VITE_USE_MOCKS: ' TRUE ', PROD: true })).toBe(true);
  });

  it('defaults to mocks in development and to Supabase in a production build', () => {
    expect(mocksOn({ PROD: false })).toBe(true);
    expect(mocksOn({ PROD: true })).toBe(false);
    expect(mocksOn({ VITE_USE_MOCKS: '', PROD: true })).toBe(false);
  });

  it('treats a typo as unset rather than as mocks in production', () => {
    expect(mocksOn({ VITE_USE_MOCKS: 'flase', PROD: true })).toBe(false);
  });
});

describe('isMisconfigured', () => {
  it('is only true in real mode without the Supabase settings', () => {
    expect(isMisconfigured({ PROD: true })).toBe(true);
    expect(isMisconfigured({ PROD: true, VITE_SUPABASE_URL: 'https://x.supabase.co' })).toBe(true);
    expect(
      isMisconfigured({ PROD: true, VITE_SUPABASE_URL: 'https://x.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' })
    ).toBe(false);
    expect(isMisconfigured({ PROD: true, VITE_USE_MOCKS: 'true' })).toBe(false);
  });
});
