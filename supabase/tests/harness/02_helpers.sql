-- Test harness only — helpers the *.test.sql files call. Loaded after every
-- numbered file and pgTAP, into a `tests` schema the app never sees.

create schema if not exists tests;

-- Simulates a Microsoft sign-in: writes the auth.users row and the Azure
-- auth.identities row Supabase would, which fires the provisioning trigger
-- from 01_auth_provisioning.sql. Returns the new user's id.
create or replace function tests.sign_in_with_microsoft(
  p_email text,
  p_name  text default 'Test Student',
  p_oid   text default null
)
returns uuid
language plpgsql
as $$
declare
  v_id  uuid := gen_random_uuid();
  v_oid text := coalesce(p_oid, 'oid-' || v_id);
begin
  insert into auth.users (id, email) values (v_id, p_email);
  insert into auth.identities (user_id, provider, provider_id, identity_data)
  values (
    v_id, 'azure', v_oid,
    jsonb_build_object('email', p_email, 'name', p_name, 'oid', v_oid)
  );
  return v_id;
end;
$$;

-- Makes the rest of the current transaction run as that signed-in user,
-- the way a request through supabase-js would: the `authenticated` role
-- (so RLS applies) with auth.uid() returning p_user_id.
create or replace function tests.authenticate_as(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Back to the test's own (superuser) role, e.g. to check what got written.
create or replace function tests.clear_authentication()
returns void
language plpgsql
as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
end;
$$;

-- A two-seat project created by p_creator with p_member accepted onto it,
-- built through the same functions the app calls — so it comes back full,
-- with teams.formed_at set. Returns the project id. Leaves the transaction
-- unauthenticated.
create or replace function tests.create_full_team(p_creator uuid, p_member uuid)
returns uuid
language plpgsql
as $$
declare
  v_role uuid := (select id from public.roles where name = 'Backend Developer');
  v_project public.projects;
  v_request public.join_requests;
begin
  perform tests.authenticate_as(p_creator);
  v_project := public.create_project('Test project', '', 2::smallint, v_role, '[]'::jsonb);
  perform tests.authenticate_as(p_member);
  v_request := public.create_join_request(v_project.id);
  perform tests.authenticate_as(p_creator);
  perform public.respond_to_join_request(v_request.id, 'accepted', v_role);
  perform tests.clear_authentication();
  return v_project.id;
end;
$$;

grant usage on schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;
