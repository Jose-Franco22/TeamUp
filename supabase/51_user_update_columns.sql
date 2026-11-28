-- Which columns of their own users row a signed-in person may change.
-- Run after 50_semesters.sql.
--
-- users_update_own (02_rls_policies.sql) says *whose* row: your own. It never
-- said *which columns*, and the table's default grant is every column, so a
-- student could rewrite fields that are not theirs to set:
--
--   * email — the account's identity everywhere else. faculty_directory
--     (44_faculty_advisers.sql) is matched on it, so a student who set their
--     email to a professor's not-yet-used address became "faculty": they could
--     be invited to advise a team, then approve its deliverables and read its
--     check-ins. Every email the app sends also goes to it.
--   * microsoft_oid — the Entra account id provisioning matched them on.
--   * name — what everyone sees on rosters; it comes from Microsoft and
--     handle_new_identity() (01_) refreshes it on each sign-in.
--   * created_at.
--
-- is_admin was already guarded by protect_admin_flag (18_), and stays so.
-- Those columns are now written only by provisioning, which runs as the
-- table owner, and by SECURITY DEFINER functions.
--
-- What the app does write directly, and so keeps (client.js, SessionContext):
--   bio, github_url, availability_hours           — the profile form
--   onboarded_at                                  — the first-sign-in walkthrough
--   email_notifications, adviser_digest           — email preferences (36_, 38_)
--   advising_available, advising_max_teams        — adviser settings (48_)
-- announcements_seen_at is written by mark_announcements_seen() (29_), which
-- is SECURITY DEFINER and needs no grant.
--
-- Safe to run again: revoke and grant are idempotent.
begin;

revoke update on table public.users from authenticated, anon;

grant update (
  bio,
  github_url,
  availability_hours,
  onboarded_at,
  email_notifications,
  adviser_digest,
  advising_available,
  advising_max_teams
) on table public.users to authenticated;

commit;
