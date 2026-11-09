// Emails important updates to students (issues #26, #21). Called by two
// Supabase database webhooks — setup steps are in TODO-backend.md ("Email
// notifications"):
//
//   * every insert into public.notifications: emails the one recipient, if
//     email.js knows the kind and their preference allows it;
//   * every insert into public.announcements: emails everyone but the author.
//     Announcements are essential, so nobody's preference stops them.
//
// Email goes out after the row is committed (webhooks are asynchronous), so a
// Resend failure never touches the notification itself; it's logged and
// retried here (send.js), and shows under Edge Functions → notify-email → Logs.
//
// Secrets (supabase secrets set ...):
//   RESEND_API_KEY       Resend API key used to send.
//   EMAIL_FROM           Sender, e.g. "TeamUp <notify@your-domain>".
//   APP_URL              Where the app is hosted, for the link back.
//   NOTIFY_EMAIL_SECRET  Shared with the webhooks' x-webhook-secret header.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { composeEmail, isEmailedKind, shouldEmail } from './email.js';
import { chunk, resendRequest, sendWithRetry } from './send.js';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const reply = (body: string, status = 200) => new Response(body, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply('Method not allowed', 405);
  if (req.headers.get('x-webhook-secret') !== env('NOTIFY_EMAIL_SECRET')) return reply('Forbidden', 403);

  // Only the id is taken from the payload: everything that goes into an
  // email is read back from the database with the service role.
  const payload = await req.json().catch(() => null);
  const id = payload?.type === 'INSERT' ? payload.record?.id : null;
  if (!id) return reply('Not an insert', 400);

  const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

  if (payload.table === 'notifications') return emailNotification(db, id);
  if (payload.table === 'announcements') return emailAnnouncement(db, id);
  return reply('Not a table notify-email handles', 400);
});

async function emailNotification(db: SupabaseClient, id: string) {
  const { data: n, error } = await db
    .from('notifications')
    .select(
      'kind, recipient:users!user_id ( email, email_notifications ), actor:users!actor_id ( name ), project:projects ( title )'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return reply(error.message, 500);
  if (!n) return reply('Notification not found', 404);

  const recipient = n.recipient as { email?: string; email_notifications?: boolean } | null;
  if (!isEmailedKind(n.kind)) return reply('Skipped: not emailed', 200);
  if (!recipient?.email) return reply('Skipped: no address', 200);
  if (!shouldEmail({ kind: n.kind, emailNotifications: recipient.email_notifications })) {
    return reply('Skipped: opted out', 200);
  }

  let deadline: string | undefined;
  if (n.kind === 'deadline_reminder') {
    const { data: m } = await db.from('milestones').select('due_at').eq('is_formation_deadline', true).maybeSingle();
    deadline = m?.due_at;
  }

  const email = composeEmail({
    kind: n.kind,
    actorName: (n.actor as { name?: string } | null)?.name,
    projectTitle: (n.project as { title?: string } | null)?.title,
    appUrl: env('APP_URL'),
    deadline,
  });
  if (!email) return reply('Skipped: not emailed', 200);

  const { url, init } = resendRequest({
    apiKey: env('RESEND_API_KEY'),
    idempotencyKey: `notification-${id}`,
    email: { from: env('EMAIL_FROM'), to: recipient.email, ...email },
  });
  const result = await sendWithRetry(() => fetch(url, init), { label: `notification ${id} (${n.kind})` });
  return result.ok ? reply('Sent') : reply(`Resend: ${result.body}`, 502);
}

async function emailAnnouncement(db: SupabaseClient, id: string) {
  const { data: a, error } = await db
    .from('announcements')
    .select('title, body, author_id')
    .eq('id', id)
    .maybeSingle();
  if (error) return reply(error.message, 500);
  if (!a) return reply('Announcement not found', 404);

  // Everyone with an address but the admin who posted it. Essential, so
  // email_notifications isn't read.
  const { data: users, error: usersError } = await db
    .from('users')
    .select('email')
    .neq('id', a.author_id)
    .not('email', 'is', null);
  if (usersError) return reply(usersError.message, 500);

  const email = composeEmail({ kind: 'announcement', appUrl: env('APP_URL'), announcement: a });
  if (!email || !users?.length) return reply('Skipped: nobody to email', 200);

  // One email per person (never everyone in one To: line), 100 per call.
  const from = env('EMAIL_FROM');
  const batches = chunk(users.map((u) => ({ from, to: u.email, ...email })));
  let failed = 0;
  for (const [i, emails] of batches.entries()) {
    const { url, init } = resendRequest({
      apiKey: env('RESEND_API_KEY'),
      idempotencyKey: `announcement-${id}-${i}`,
      emails,
    });
    const result = await sendWithRetry(() => fetch(url, init), { label: `announcement ${id} batch ${i + 1}/${batches.length}` });
    if (!result.ok) failed++;
  }
  return failed
    ? reply(`${failed} of ${batches.length} batches failed; see logs`, 502)
    : reply(`Sent to ${users.length}`);
}
