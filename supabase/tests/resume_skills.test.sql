-- Issue #19 — what the database guarantees about skills imported from a
-- resume. Every statement runs as a signed-in student through RLS, the same
-- path addResumeSkills() in frontend/src/api/client.js takes.
--
-- The writes below mirror that function exactly: an insert into user_skills
-- with `on conflict do nothing` (supabase-js `ignoreDuplicates: true`), then
-- an upsert into profile_evidence. If the client ever stops matching this,
-- these tests are where it shows.
begin;
select plan(24);

select set_config('tests.me',    tests.sign_in_with_microsoft('importer01@utrgv.edu', 'Importer')::text, true);
select set_config('tests.other', tests.sign_in_with_microsoft('other02@utrgv.edu', 'Other')::text, true);

-- Two skills from the seeded catalog. Picked by name rather than by id so
-- this keeps working as the catalog grows.
select set_config('tests.react',  (select id from public.skills where name = 'React')::text, true);
select set_config('tests.python', (select id from public.skills where name = 'Python')::text, true);

select isnt(current_setting('tests.react'), '', 'the catalog is seeded, so there is something to import');

select tests.authenticate_as(current_setting('tests.me')::uuid);

-- --- an import writes source = 'resume' ----------------------------------

select lives_ok(
  $$ insert into public.user_skills (user_id, skill_id, source)
     values (auth.uid(), current_setting('tests.react')::uuid, 'resume')
     on conflict (user_id, skill_id) do nothing $$,
  'a resume import inserts a user_skills row');

select is(
  (select source from public.user_skills
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.react')::uuid),
  'resume',
  'the row records that it came from a resume, not from the form');

select throws_ok(
  $$ insert into public.user_skills (user_id, skill_id, source)
     values (auth.uid(), current_setting('tests.python')::uuid, 'imported') $$,
  '23514', null,
  'a source other than manual or resume is rejected');

-- --- importing the same skill twice --------------------------------------

select lives_ok(
  $$ insert into public.user_skills (user_id, skill_id, source)
     values (auth.uid(), current_setting('tests.react')::uuid, 'resume')
     on conflict (user_id, skill_id) do nothing $$,
  're-importing the same resume does not error');

select is(
  (select count(*)::int from public.user_skills
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.react')::uuid),
  1,
  'and it does not duplicate the row');

-- A skill the student added by hand keeps saying so after an import. The
-- client ignores duplicates rather than overwriting, so the earlier, stronger
-- claim wins — asserted here because it is a behaviour, not an accident.
select lives_ok(
  $$ insert into public.user_skills (user_id, skill_id, source)
     values (auth.uid(), current_setting('tests.python')::uuid, 'manual') $$,
  'a skill added by hand is stored as manual');
select lives_ok(
  $$ insert into public.user_skills (user_id, skill_id, source)
     values (auth.uid(), current_setting('tests.python')::uuid, 'resume')
     on conflict (user_id, skill_id) do nothing $$,
  'importing a resume that mentions it does not error');
select is(
  (select source from public.user_skills
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.python')::uuid),
  'manual',
  'and it is still recorded as added by hand');

-- --- the evidence behind each imported skill -----------------------------

select lives_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, months, projects, quote)
     values (auth.uid(), current_setting('tests.react')::uuid, 9, 2,
             'Shipped a React dashboard used across the department.')
     on conflict (user_id, skill_id) do update
       set months = excluded.months, projects = excluded.projects, quote = excluded.quote $$,
  'evidence is stored alongside the imported skill');

select is(
  (select months from public.profile_evidence
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.react')::uuid),
  9::smallint,
  'with the months the parser worked out');

select lives_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, months, projects, quote)
     values (auth.uid(), current_setting('tests.react')::uuid, 14, 3, 'An updated resume.')
     on conflict (user_id, skill_id) do update
       set months = excluded.months, projects = excluded.projects, quote = excluded.quote $$,
  'importing an updated resume overwrites the evidence');

select is(
  (select count(*)::int from public.profile_evidence
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.react')::uuid),
  1,
  'rather than leaving two rows for one skill');

select is(
  (select months from public.profile_evidence
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.react')::uuid),
  14::smallint,
  'and the newer figure is the one kept');

-- --- evidence cannot float free of a listed skill ------------------------

select throws_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, months)
     values (auth.uid(), (select id from public.skills where name = 'Git'), 5) $$,
  '23503', null,
  'evidence for a skill the student does not list is rejected');

-- --- the parser's own bounds, enforced here too -------------------------
-- MAX_MONTHS in evidence.js is 72 and quotes are shortened to 160 characters.
-- A bug on the client must not be able to write past either.

select throws_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, months)
     values (auth.uid(), current_setting('tests.python')::uuid, 73) $$,
  '23514', null,
  'more than 72 months of experience is rejected');
select throws_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, months)
     values (auth.uid(), current_setting('tests.python')::uuid, -1) $$,
  '23514', null,
  'negative months are rejected');
select throws_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, projects)
     values (auth.uid(), current_setting('tests.python')::uuid, -1) $$,
  '23514', null,
  'a negative project count is rejected');
select throws_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, quote)
     values (auth.uid(), current_setting('tests.python')::uuid, repeat('x', 201)) $$,
  '23514', null,
  'a quote longer than 200 characters is rejected');

-- --- removing a skill removes its evidence -------------------------------

select lives_ok(
  $$ delete from public.user_skills
      where user_id = auth.uid() and skill_id = current_setting('tests.react')::uuid $$,
  'a student can remove an imported skill');
select is(
  (select count(*)::int from public.profile_evidence
    where user_id = current_setting('tests.me')::uuid
      and skill_id = current_setting('tests.react')::uuid),
  0,
  'and its evidence goes with it, rather than being left orphaned');

-- --- another student is not me -------------------------------------------
-- The quote is a verbatim resume line and can hold contact details, so
-- profile_evidence is own-rows-only for reading as well as writing.

select tests.authenticate_as(current_setting('tests.other')::uuid);

select is(
  (select count(*)::int from public.profile_evidence
    where user_id = current_setting('tests.me')::uuid),
  0,
  'another student cannot read my resume evidence');

select throws_ok(
  $$ insert into public.profile_evidence (user_id, skill_id, months)
     values (current_setting('tests.me')::uuid, current_setting('tests.python')::uuid, 12) $$,
  '42501', null,
  'another student cannot write evidence onto my profile');

select throws_ok(
  $$ insert into public.user_skills (user_id, skill_id, source)
     values (current_setting('tests.me')::uuid, (select id from public.skills where name = 'Git'), 'resume') $$,
  '42501', null,
  'another student cannot import skills onto my profile');

select * from finish();
rollback;
