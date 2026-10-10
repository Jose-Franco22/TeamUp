-- Make 11_profile_validation.sql's rules hold for every existing profile,
-- not just new writes. Run after 13_reprovision_on_sign_in.sql.
--
-- 11_ added its CHECK constraints as NOT VALID, so profiles saved before
-- then could still break a rule. That became a real problem with 13_: it
-- rewrites the student's users row on every sign-in, Postgres re-checks the
-- whole row, and a student with an old invalid value (say github_url =
-- 'my github') could no longer sign in at all.
--
-- VALIDATE checks every existing row. If this fails, some profiles still
-- break a rule: run the query at the top of 11_profile_validation.sql to
-- list them, fix those rows, and run this file again. Nothing changes until
-- it succeeds, so it is safe to retry.

alter table public.users validate constraint users_availability_hours_range_check;
alter table public.users validate constraint users_bio_length_check;
alter table public.users validate constraint users_github_url_format_check;
