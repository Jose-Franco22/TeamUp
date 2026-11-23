// Refreshes public.faculty_directory from the UTRGV CS faculty directory
// (44_faculty_advisers.sql). Only accounts on that list can be asked to
// advise a project. Meant to run on a schedule — setup is in TODO-backend.md
// ("Faculty directory").
//
// Secrets (supabase secrets set ...):
//   SYNC_FACULTY_SECRET  Shared with the caller's x-sync-secret header.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DIRECTORY_URL, facultyEmails } from './faculty.js';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const reply = (body: string, status = 200) => new Response(body, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply('Method not allowed', 405);
  if (req.headers.get('x-sync-secret') !== env('SYNC_FACULTY_SECRET')) return reply('Forbidden', 403);

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
