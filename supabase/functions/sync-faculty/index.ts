// Refreshes public.faculty_directory from the UTRGV CS faculty directory
// (44_faculty_advisers.sql). Only accounts on that list can be asked to
// advise a project. Meant to run on a schedule — setup is in TODO-backend.md
// ("Faculty directory").
//
// Secrets (supabase secrets set ...):
//   SYNC_FACULTY_SECRET  Shared with the caller's x-sync-secret header.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Deploy with --no-verify-jwt:
//   supabase functions deploy sync-faculty --no-verify-jwt
// The caller is a Cron job, not a signed-in user, and the shared secret below
// is the whole of the check. With Supabase's default JWT verification on, a
// job that sends only x-sync-secret is refused with a 401 before this code
// ever runs, and the list silently stops being refreshed.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DIRECTORY_URL, facultyEmails } from './faculty.js';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const reply = (body: string, status = 200) => new Response(body, { status });

// Compared as SHA-256 digests, in constant time, so the response time says
// nothing about how much of a guess was right.
async function sameSecret(given: string, expected: string) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply('Method not allowed', 405);

  // A readable answer rather than a crash when the function is deployed
  // before its secret is set, the way fit-review handles a missing key.
  const secret = Deno.env.get('SYNC_FACULTY_SECRET');
  if (!secret) {
    console.error('sync-faculty: SYNC_FACULTY_SECRET is not set');
    return reply('Not configured: SYNC_FACULTY_SECRET is not set', 503);
  }
  if (!(await sameSecret(req.headers.get('x-sync-secret') ?? '', secret))) return reply('Forbidden', 403);

  let emails: string[];
  try {
    const res = await fetch(DIRECTORY_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`directory answered ${res.status}`);
    emails = facultyEmails(await res.json());
  } catch (err) {
    console.error('sync-faculty: could not read the directory:', err);
    return reply('Could not read the faculty directory', 502);
  }

  // sync_faculty_directory() refuses an empty list too; stopping here just
  // gives a clearer log line. Either way last sync's list stays in place.
  if (emails.length === 0) {
    console.error('sync-faculty: the directory listed nobody; keeping the current list');
    return reply('The faculty directory listed nobody', 502);
  }

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const { data, error } = await db.rpc('sync_faculty_directory', { p_emails: emails });
  if (error) {
    console.error('sync-faculty: sync_faculty_directory failed:', error);
    return reply('Could not save the faculty list', 500);
  }

  console.log(`sync-faculty: ${data} faculty listed`);
  return reply(`${data} faculty listed`);
});
