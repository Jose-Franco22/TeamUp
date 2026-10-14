-- Issue #24 — update_project() is the boundary for editing.
--
-- The edit form applies the same rules (lib/validation.js, shared with the
-- create form), but anyone signed in can call this function directly, so
-- everything the form refuses this has to refuse too — plus the two rules
-- that only exist for an edit: only the creator may do it, and the target
-- cannot drop below the people already seated.
begin;
select plan(33);

select set_config('tests.owner',  tests.sign_in_with_microsoft('owner24@utrgv.edu', 'Owner')::text, true);
select set_config('tests.m1',     tests.sign_in_with_microsoft('m1x24@utrgv.edu', 'Member One')::text, true);
select set_config('tests.m2',     tests.sign_in_with_microsoft('m2x24@utrgv.edu', 'Member Two')::text, true);
select set_config('tests.nobody', tests.sign_in_with_microsoft('nobody24@utrgv.edu', 'Nobody')::text, true);

select set_config('tests.r_pm', (select id from public.roles where name = 'Project Manager')::text, true);
select set_config('tests.r_fe', (select id from public.roles where name = 'Frontend Developer')::text, true);
select set_config('tests.r_be', (select id from public.roles where name = 'Backend Developer')::text, true);
select set_config('tests.s_react', (select id from public.skills where name = 'React')::text, true);
select set_config('tests.s_python', (select id from public.skills where name = 'Python')::text, true);

create or replace function tests.role_row(p_role_id text, p_skill_id text, p_qty int)
returns jsonb language sql as $$
  select jsonb_build_object('role_id', p_role_id, 'skill_id', p_skill_id, 'quantity_needed', p_qty);
$$;
grant execute on function tests.role_row(text, text, int) to authenticated;

-- An edit with everything valid except whatever the caller overrides.
create or replace function tests.edit(
  p_title text default 'A perfectly fine project title',
  p_description text default 'A description that is comfortably longer than twenty characters.',
  p_size int default 4,
  p_role_id text default null,
  p_roles jsonb default '[]'::jsonb
)
returns void language plpgsql as $$
begin
  perform public.update_project(
    current_setting('tests.project')::uuid,
    p_title, p_description, p_size::smallint,
    coalesce(p_role_id, current_setting('tests.r_pm'))::uuid,
    p_roles);
end;
$$;
grant execute on function tests.edit(text, text, int, text, jsonb) to authenticated;

create or replace function tests.open_count(p_role_id uuid)
returns int language sql as $$
  select coalesce((select quantity_needed from public.project_roles_needed
                    where project_id = current_setting('tests.project')::uuid
                      and role_id = p_role_id), -1)::int;
$$;
grant execute on function tests.open_count(uuid) to authenticated;

-- Joins p_user to the project in p_role, through the real request flow.
create or replace function tests.seat(p_user uuid, p_role uuid)
returns void language plpgsql as $$
declare v_req uuid;
begin
  perform tests.authenticate_as(p_user);
  select id into v_req from public.create_join_request(current_setting('tests.project')::uuid);
  perform tests.authenticate_as(current_setting('tests.owner')::uuid);
  perform public.respond_to_join_request(v_req, 'accepted', p_role);
end;
$$;
grant execute on function tests.seat(uuid, uuid) to authenticated;

-- A team of 4: the owner as PM, recruiting two Frontend and one Backend.
select tests.authenticate_as(current_setting('tests.owner')::uuid);
select set_config('tests.project',
  (select (public.create_project(
     'Campus parking tracker',
     'Live lot occupancy estimated from existing camera feeds, with a map.',
     4::smallint,
     current_setting('tests.r_pm')::uuid,
     jsonb_build_array(
       tests.role_row(current_setting('tests.r_fe'), current_setting('tests.s_react'), 2),
       tests.role_row(current_setting('tests.r_be'), null, 1)
     ))).id::text),
  true);

-- --- the creator can edit ------------------------------------------------

select lives_ok(
  $$ select tests.edit('A better title for the project',
       'An updated description, still comfortably over twenty characters.') $$,
  'the creator can edit their own project');
select is(
  (select title from public.projects where id = current_setting('tests.project')::uuid),
  'A better title for the project',
  'and the new title is stored');

select lives_ok(
  $$ select tests.edit('   Padded title for the project   ',
       '   A description padded on both sides but long enough.   ') $$,
  'padded text is accepted');
select is(
  (select title from public.projects where id = current_setting('tests.project')::uuid),
  'Padded title for the project',
  'and stored trimmed, the same as create_project does');

-- --- the same text rules as creating -------------------------------------

select throws_like($$ select tests.edit('abcd') $$,
  '%Title must be between 5 and 100 characters%', 'a 4-character title is rejected');
select throws_like($$ select tests.edit(repeat('x', 101)) $$,
  '%Title must be between 5 and 100 characters%', 'a 101-character title is rejected');
select throws_like($$ select tests.edit('   ab   ') $$,
  '%Title must be between 5 and 100 characters%', 'a title is measured after trimming');
select throws_like($$ select tests.edit('A fine title', repeat('x', 19)) $$,
  '%Description must be between 20 and 2000 characters%', 'a 19-character description is rejected');
select throws_like($$ select tests.edit('A fine title', '') $$,
  '%Description must be between 20 and 2000 characters%', 'an empty description is rejected');

-- --- the same role rules as creating -------------------------------------

select throws_like(
  $$ select tests.edit(p_roles => jsonb_build_array(
       tests.role_row(current_setting('tests.r_fe'), null, 1),
       tests.role_row(current_setting('tests.r_fe'), null, 1))) $$,
  '%You listed the same role twice%', 'the same role twice is rejected');
select throws_like(
  $$ select tests.edit(p_roles => jsonb_build_array(
       tests.role_row(gen_random_uuid()::text, null, 1))) $$,
  '%Unknown role%', 'an unknown role is rejected');
select throws_like(
  $$ select tests.edit(p_roles => jsonb_build_array(
       tests.role_row(current_setting('tests.r_fe'), current_setting('tests.s_python'), 1))) $$,
  '%That skill does not fit the role you picked%', 'a skill from the wrong category is rejected');
select throws_like(
  $$ select tests.edit(p_roles => jsonb_build_array(
       tests.role_row(current_setting('tests.r_fe'), null, 0))) $$,
  '%Each role needs between 1 and 3 people%', 'a quantity of 0 is rejected');
select throws_like($$ select tests.edit(p_size => 5) $$,
  '%A team has to be between 2 and 4 people%', 'a team of 5 is rejected');
select throws_like($$ select tests.edit(p_size => 1) $$,
  '%A team has to be between 2 and 4 people%', 'a team of 1 is rejected');
select throws_like($$ select tests.edit(p_role_id => gen_random_uuid()::text) $$,
  '%A valid role is required%', 'a role that does not exist is rejected');

-- --- nobody else may edit ------------------------------------------------

select tests.authenticate_as(current_setting('tests.nobody')::uuid);
select throws_like($$ select tests.edit() $$,
  '%Only the project creator can edit it%', 'someone unrelated cannot edit it');

-- --- put the roles back, then fill them ----------------------------------

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok(
  $$ select tests.edit(p_roles => jsonb_build_array(
       tests.role_row(current_setting('tests.r_fe'), current_setting('tests.s_react'), 2),
       tests.role_row(current_setting('tests.r_be'), null, 1))) $$,
  'the roles are restored for the rest of the tests');

select lives_ok(
  $$ select tests.seat(current_setting('tests.m1')::uuid, current_setting('tests.r_fe')::uuid) $$,
  'one Frontend Developer joins');
select lives_ok(
  $$ select tests.seat(current_setting('tests.m2')::uuid, current_setting('tests.r_fe')::uuid) $$,
  'and a second takes the other Frontend seat');
select is(tests.open_count(current_setting('tests.r_fe')::uuid), 0,
  'so the Frontend role has no seats left and is hidden from the edit form');

-- --- a member of the team is still not the creator -----------------------

select tests.authenticate_as(current_setting('tests.m1')::uuid);
select throws_like($$ select tests.edit() $$,
  '%Only the project creator can edit it%', 'a member of the team cannot edit it either');

-- --- the target cannot drop below the roster -----------------------------
-- Three are seated now: the owner and the two Frontend developers.

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select throws_like($$ select tests.edit(p_size => 2) $$,
  '%3 people are already on this team%',
  'a target below the roster is rejected');
select lives_ok($$ select tests.edit(p_size => 3) $$,
  'a target equal to the roster is allowed');

-- --- the seats left are counted from the roster --------------------------

select lives_ok($$ select tests.edit(p_size => 4) $$, 'back up to a team of 4');
select throws_like(
  $$ select tests.edit(p_size => 4, p_roles => jsonb_build_array(
       tests.role_row(current_setting('tests.r_be'), null, 2))) $$,
  '%This team has 1 open seat left, but you listed 2 people%',
  'with three seated, only one seat is left to recruit for');

-- --- a filled role survives an edit --------------------------------------
--
-- The Frontend role sits at 0 and composeProject() hides it, so the edit
-- form never shows it and the creator cannot have meant to remove it.
-- Replacing the roles list wholesale used to delete it anyway, taking the
-- skill pinned to it — and then the seat could never reopen, because
-- restore_project_role() only updates a row that already exists.

select lives_ok(
  $$ select tests.edit(p_size => 4, p_roles => jsonb_build_array(
       tests.role_row(current_setting('tests.r_be'), null, 1))) $$,
  'the creator edits, listing only the Backend role');
select is(
  (select skill_id from public.project_roles_needed
    where project_id = current_setting('tests.project')::uuid
      and role_id = current_setting('tests.r_fe')::uuid),
  current_setting('tests.s_react')::uuid,
  'the filled Frontend role is still there, with its skill intact');
select is(tests.open_count(current_setting('tests.r_fe')::uuid), 0,
  'and still at zero, so it is not advertised');

-- ...and because the row survived, the seat reopens when someone leaves.
select tests.authenticate_as(current_setting('tests.m1')::uuid);
select lives_ok($$ select public.leave_team() $$, 'one of them leaves the team');
select is(tests.open_count(current_setting('tests.r_fe')::uuid), 1,
  'their Frontend seat is open again — which only works because the row was kept');

-- --- a role the creator really did remove stays removed ------------------
-- The rule only protects rows the form could not show. A role still open is
-- one the creator can see, so dropping it from the form means dropping it.

select tests.authenticate_as(current_setting('tests.owner')::uuid);
select lives_ok($$ select tests.edit(p_size => 4, p_roles => '[]'::jsonb) $$,
  'the creator removes the Backend role, which was still open');
select is(tests.open_count(current_setting('tests.r_be')::uuid), -1,
  'and it is gone, because they could see it when they decided');

select * from finish();
rollback;
