import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Only constructed when mocks are off — see api/client.js and
// auth/SessionContext.jsx, the only two places that import this.
export const supabase =
  url && anonKey
    ? createClient(url, anonKey)
    : null;
