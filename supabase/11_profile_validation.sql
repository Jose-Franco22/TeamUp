-- Profile validation (issue #17). Run after 10_bulk_skills.sql.
--
-- The profile form and api/client.js validate these fields
-- (frontend/src/lib/validation.js), but that is only a convenience: anyone
-- signed in can call Supabase directly with their session and skip the
-- form. These CHECK constraints are the real boundary. Keep them identical
-- to validation.js — frontend/src/lib/validation.test.js fails if the
-- GitHub pattern here and there drift apart.
--
-- NOT VALID: the constraints apply to every insert and update from now on,
-- but don't fail this migration if a live row already breaks a rule. A
-- student with an old invalid value just sees the error on their profile
-- the next time they save, and has to fix it then. To find such rows:
--
--   select id, email, availability_hours, github_url, char_length(bio) as bio_chars
--   from public.users
--   where availability_hours not between 0 and 40
--      or char_length(bio) > 500
--      or (github_url <> '' and github_url !~* '^https://(www\.)?github\.com/[A-Za-z0-9-]{1,39}/?$');
--
-- Once that returns nothing, the constraints can be fully validated with
--   alter table public.users validate constraint <name>;

alter table public.users
  add constraint users_availability_hours_range_check
    check (availability_hours between 0 and 40) not valid;

alter table public.users
  add constraint users_bio_length_check
    check (char_length(bio) <= 500) not valid;

-- Empty, or a GitHub profile link: https, github.com (optionally www.), one
-- username segment of letters, digits and hyphens (GitHub's max is 39),
-- optional trailing slash. Case-insensitive, like the JS /i flag.
alter table public.users
  add constraint users_github_url_format_check
    check (
      github_url = ''
      or github_url ~* '^https://(www\.)?github\.com/[A-Za-z0-9-]{1,39}/?$'
    ) not valid;
