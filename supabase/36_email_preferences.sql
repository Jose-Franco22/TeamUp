-- Email preferences (issue #21). Run after 35_join_request_message.sql.
--
-- The notify-email Edge Function (supabase/functions/notify-email/) emails
-- important notifications and admin announcements. Students can turn off the
-- non-essential ones from their profile; this is where that choice lives.
--
--   * users.email_notifications: true (the default) means "email me". When
--     false, notify-email skips join requests, accepted/declined requests and
--     team-complete emails for this user. Deadline reminders and admin
--     announcements go out regardless: the function never reads this flag
--     for them (functions/notify-email/email.js, ESSENTIAL_KINDS).
--
-- No new policy is needed: users_update_own (02_rls_policies.sql) already lets
-- a student update their own row and nobody else's, and the protect_admin_flag
-- trigger (18_admin_access.sql) only guards is_admin.
--
-- The function reads the flag with the service role, so it sees the value
-- even though the app only ever reads it for the signed-in user.

begin;

alter table public.users
  add column if not exists email_notifications boolean not null default true;

comment on column public.users.email_notifications is
  'Whether notify-email sends this user non-essential emails (join requests, '
  'request answers, team complete). Deadline reminders and announcements are '
  'always sent. Set from the Profile page.';

commit;
