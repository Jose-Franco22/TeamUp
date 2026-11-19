// Who has been committing (issue #58).
//
// The team page asks this function for one project's recent activity; it
// answers from the cache when the cache is young enough, and otherwise asks
// GitHub and writes down what it said.
//
// Why it is an Edge Function and not a fetch from the browser — the same two
// reasons as fit-review, in the same order:
//
//   1. THE TOKEN. Vite inlines every VITE_* variable into the public bundle,
//      so a browser-side call would publish GITHUB_TOKEN to anyone who opens
//      devtools. It only ever lives here.
//   2. THE RATE LIMIT. GitHub gives a token 5,000 requests an hour — for the
//      whole course, not per team. Thirty teams each refreshing their own
//      page from the browser would have no shared cache to miss, and no way
//      to be told to wait. One function with one cache does.
//
// Everything that could be wrong about the *answer* is in activity.js, which
// CI runs under `node --test`. This file is the shell: who is asking, what
// they are allowed to ask about, and where the answer is kept. The division
// is deliberate — nothing here is reachable by any test we can run, so
// nothing here is allowed to hold a rule.
//
// Secrets (supabase secrets set ...):
//   GITHUB_TOKEN   optional. A fine-grained token with Contents: Read and
//                  Pull requests: Read, and no write access to anything.
//                  Without it public repositories still work, at GitHub's
//                  unauthenticated 60 requests an hour for the whole
//                  function; private ones return not_found.
//
// Deploy:
//   supabase functions deploy github-activity
//
// Until it is deployed the team page shows the link and says the activity
// isn't available yet, so nothing breaks by not having it.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { WINDOW_DAYS, getActivity } from './activity.js';

// GitHub answers in well under a second normally; this is the budget for
// the whole call including however many pages activity.js follows.
const TIMEOUT_MS = 20000;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The sentences project_repo_for_refresh() raises, each mapped to a code the
// page has wording for. Matched on our own text, which is why the migration
// and this list have to be read together — there is a comment saying so at
// both ends.
function refusal(message: string): { status: number; error: string } {
  if (message.includes('Not signed in')) return { status: 401, error: 'signed_out' };
  if (message.includes('Only the team can refresh')) return { status: 403, error: 'not_on_team' };
  if (message.includes('No repository is linked')) return { status: 400, error: 'no_repo' };
  if (message.includes('Project not found')) return { status: 404, error: 'no_project' };
  return { status: 500, error: 'refused' };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  // Supabase's JWT check also passes the public anon key, so it does not
  // mean a signed-in user. The caller's own token is what the RPC below
  // checks team membership with.
  const authorization = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: who, error: authError } = await caller.auth.getUser();
  if (authError || !who?.user) return json({ error: 'signed_out' }, 401);

  if (!serviceKey) {
    // A readable answer rather than a 500: the function can be deployed
    // before its environment is complete, and the page treats this the same
    // as any other failure — show the link, skip the table.
    return json({ error: 'not_configured', message: 'SUPABASE_SERVICE_ROLE_KEY is not set' }, 503);
  }

  const payload = await req.json().catch(() => null);
  const projectId = payload?.project_id;
  if (typeof projectId !== 'string' || !UUID.test(projectId)) {
    return json({ error: 'bad_request' }, 400);
  }
  const force = payload?.force === true;

  // Authorization lives in SQL, where pgTAP can reach it
  // (supabase/tests/github_activity.test.sql). This function does not know
  // the rule, so it cannot get the rule subtly wrong: it asks, with the
  // caller's token, and is told the repo or refused.
  const { data: repo, error: repoError } = await caller.rpc('project_repo_for_refresh', {
    p_project_id: projectId,
  });
  if (repoError) {
    const { status, error } = refusal(repoError.message ?? '');
    if (status >= 500) console.error('github-activity: unexpected refusal:', repoError.message);
    return json({ error }, status);
  }
  if (typeof repo !== 'string' || repo === '') return json({ error: 'no_repo' }, 400);

  // The writing side bypasses RLS, because `repo_activity` deliberately has
  // no write policy at all: save_repo_activity() is granted to service_role
  // and nobody else, so these counts can only have come from here.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const store = {
    read: async () => {
      const { data } = await admin
        .from('repo_activity')
        .select('repo, contributors, last_commit_at, window_days, fetched_at, error')
        .eq('project_id', projectId)
        .maybeSingle();
      return data ?? null;
    },
    write: async (row: Record<string, unknown>) => {
      const { error } = await admin.rpc('save_repo_activity', {
        p_project_id: projectId,
        p_repo: row.repo,
        p_contributors: row.contributors,
        p_last_commit_at: row.last_commit_at,
        p_window_days: row.window_days,
        p_error: row.error,
      });
      // A cache that could not be written is not worth failing the request
      // over: the caller still gets this answer, and the next call fetches
      // again rather than reading a row that was never stored.
      if (error) console.error('github-activity: could not store the answer:', error.message);
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { row, cached } = await getActivity({
      store,
      repo,
      force,
      token: Deno.env.get('GITHUB_TOKEN') ?? null,
      signal: controller.signal,
      windowDays: WINDOW_DAYS,
    });
    // `row.error` is part of a successful answer, not a failure of this
    // request: "we asked, and GitHub said no" is something the page shows
    // alongside whatever it last knew.
    return json({ ok: true, cached, activity: row });
  } catch (error) {
    // Only a code goes back; the details stay in the log, and nothing that
    // could be quoting the Authorization header is returned at all.
    const aborted = error instanceof DOMException && error.name === 'AbortError';
    console.error('github-activity:', aborted ? 'timed out' : error);
    return json({ error: aborted ? 'timeout' : 'unreachable' }, 502);
  } finally {
    clearTimeout(timer);
  }
});
