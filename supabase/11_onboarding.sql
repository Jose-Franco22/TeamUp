-- When the student finished (or skipped) the first-sign-in walkthrough.
-- Null means they haven't seen it yet, so the app shows it on their next
-- visit. Kept on the users row rather than in the browser so the tour shows
-- once per student, not once per device.
--
-- users_update_own (02_rls_policies.sql) already lets a student set this on
-- their own row; no new policy needed.

alter table public.users add column onboarded_at timestamptz;
