// Emails a notification to the student it's for (issue #26). Called by a
// Supabase database webhook on every insert into public.notifications —
// setup steps are in TODO-backend.md ("Email notifications"). Only kinds
// composeEmail() knows are sent; the rest are acknowledged and skipped, so
// other stories can add theirs there without touching the webhook.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY       Resend API key used to send.
//   EMAIL_FROM           Sender, e.g. "TeamUp <notify@your-domain>".
//   APP_URL              Where the app is hosted, for the link back.
//   NOTIFY_EMAIL_SECRET  Shared with the webhook's x-webhook-secret header.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { composeEmail } from './email.js';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (req.headers.get('x-webhook-secret') !== env('NOTIFY_EMAIL_SECRET')) {
    return new Response('Forbidden', { status: 403 });
  }

  const payload = await req.json().catch(() => null);
  const id = payload?.type === 'INSERT' && payload?.table === 'notifications' ? payload.record?.id : null;
  if (!id) return new Response('Not a notifications insert', { status: 400 });

  // Only the id is taken from the payload: everything that goes into the
  // email is read back from the database.
  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });
  const { data: n, error } = await db
    .from('notifications')
    .select('kind, recipient:users!user_id ( email ), actor:users!actor_id ( name ), project:projects ( title )')
    .eq('id', id)
    .maybeSingle();
  if (error) return new Response(error.message, { status: 500 });
  if (!n) return new Response('Notification not found', { status: 404 });

  const email = composeEmail({
    kind: n.kind,
    actorName: n.actor?.name,
    projectTitle: n.project?.title,
    appUrl: env('APP_URL'),
  });
  if (!email || !n.recipient?.email) return new Response('Skipped', { status: 200 });

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: env('EMAIL_FROM'), to: n.recipient.email, ...email }),
  });
  if (!sent.ok) return new Response(`Resend: ${await sent.text()}`, { status: 502 });
  return new Response('Sent', { status: 200 });
});
