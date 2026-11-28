// Whether the app runs on fixture data (src/api/mockData.js) or on Supabase.
//
// Set VITE_USE_MOCKS to 'true' or 'false' to choose. Left unset, a dev
// server and the tests use mocks (no setup needed for UI work), but a
// production build does not: a deploy that forgot the variable must not
// quietly ship the stub sign-in, where anyone can pick any seeded account.
// It runs against Supabase instead, and says so if that isn't configured
// (see isMisconfigured below). A demo deploy that wants mocks sets 'true'.
export function mocksOn(env = import.meta.env) {
  const flag = String(env.VITE_USE_MOCKS ?? '').trim().toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return !env.PROD;
}

// Real mode with nowhere to send requests: the build is missing
// VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.
export function isMisconfigured(env = import.meta.env) {
  return !mocksOn(env) && !(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
}
