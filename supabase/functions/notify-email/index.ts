// Emails important updates to students (issues #26, #21). Called by two
// Supabase database webhooks — setup steps are in TODO-backend.md ("Email
// notifications"):
//
//   * every insert into public.notifications: emails the one recipient, if
//     email.js knows the kind and their preference allows it;
//   * every insert into public.announcements: emails everyone but the author.
//     Announcements are essential, so nobody's preference stops them.
//   * every insert into public.adviser_digests: emails that adviser their
//     weekly digest (#59), unless they've turned it off since the job ran.
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
import { composeDigest } from './digest.js';
import { sameSecret } from '../_shared/secret.js';

const env = (name: string) => {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
};

const reply = (body: string, status = 200) => new Response(body, { status });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply('Method not allowed', 405);

  // A readable answer rather than a crash when the function is deployed
  // before its secret is set, the way sync-faculty handles it. Compared in
  // constant time (../_shared/secret.js): this URL is public.
  const secret = Deno.env.get('NOTIFY_EMAIL_SECRET');
  if (!secret) {
    console.error('notify-email: NOTIFY_EMAIL_SECRET is not set');
    return reply('Not configured: NOTIFY_EMAIL_SECRET is not set', 503);
  }
  if (!(await sameSecret(req.headers.get('x-webhook-secret') ?? '', secret))) return reply('Forbidden', 403);

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
  if (payload.table === 'adviser_digests') return emailAdviserDigest(db, id);
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

  // This semester's deadline, through the same function the database's
  // rules use. Not a read of milestones: there is a flagged milestone per
  // semester (50_semesters.sql), and the service role sees all of them.
  let deadline: string | undefined;
  if (n.kind === 'deadline_reminder') {
    const { data: due, error: dueError } = await db.rpc('formation_deadline');
    if (dueError) console.error('notify-email: could not read the formation deadline:', dueError.message);
    deadline = typeof due === 'string' ? due : undefined;
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
    .select('title, body')
    .eq('id', id)
    .maybeSingle();
  if (error) return reply(error.message, 500);
  if (!a) return reply('Announcement not found', 404);

  // Everyone with an address but the admin who posted it, leaving out
  // students who aren't in the announcement's semester — the rule is
  // announcement_recipients() in 50_semesters.sql, ordered so each
  // announcement-<id>-<batch> idempotency key covers the same people if the
  // webhook fires twice. Essential, so email_notifications isn't read.
  const { data: users, error: usersError } = await db.rpc('announcement_recipients', {
    p_announcement_id: id,
  });
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

// One adviser's weekly digest (#59). The job (38_adviser_digest.sql) already
// left out advisers with the digest off; it's checked again here in case they
// turned it off in the minutes since.
async function emailAdviserDigest(db: SupabaseClient, id: string) {
  const { data: d, error } = await db
    .from('adviser_digests')
    .select('data, adviser:users!adviser_id ( email, name, adviser_digest )')
    .eq('id', id)
    .maybeSingle();
  if (error) return reply(error.message, 500);
  if (!d) return reply('Digest not found', 404);

  const adviser = d.adviser as { email?: string; name?: string; adviser_digest?: boolean } | null;
  if (!adviser?.email) return reply('Skipped: no address', 200);
  if (adviser.adviser_digest === false) return reply('Skipped: opted out', 200);

  const email = composeDigest({ data: d.data, appUrl: env('APP_URL'), adviserName: adviser.name });
  const { url, init } = resendRequest({
    apiKey: env('RESEND_API_KEY'),
    idempotencyKey: `adviser-digest-${id}`,
    email: { from: env('EMAIL_FROM'), to: adviser.email, ...email },
  });
  const result = await sendWithRetry(() => fetch(url, init), { label: `adviser digest ${id}` });
  return result.ok ? reply('Sent') : reply(`Resend: ${result.body}`, 502);
}
