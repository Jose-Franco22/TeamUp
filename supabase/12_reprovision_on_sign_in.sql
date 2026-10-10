-- Re-run provisioning on every sign-in, not just the first.
--
-- 01_auth_provisioning.sql fires only on insert into auth.identities, which
-- happens once per account. Later sign-ins update that identity instead, so
-- if the public.users row is ever deleted (e.g. while testing) the account
-- is stuck: it has a session but no profile, and the app treats it as
-- signed out. handle_new_identity() already upserts, so firing it on update
-- too recreates a missing row and refreshes name/email on an existing one.
-- onboarded_at isn't touched, so the walkthrough doesn't come back.

drop trigger if exists on_auth_identity_created on auth.identities;
create trigger on_auth_identity_created
  after insert or update on auth.identities
  for each row execute function public.handle_new_identity();
