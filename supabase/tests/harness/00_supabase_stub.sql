-- Test harness only — never run this against the real Supabase project.
--
-- The database tests run on plain Postgres (no Docker or Supabase CLI
-- needed), so this recreates the small slice of Supabase our SQL relies on:
-- the anon/authenticated/service_role roles with Supabase's default grants,
-- auth.users, auth.identities (what the Microsoft sign-in writes), and
-- auth.uid(), which reads the signed-in user from the same setting
-- PostgREST sets on every request.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

-- Supabase grants the API roles everything in public by default and relies
-- on RLS to narrow it down; mirror that so RLS is what the tests exercise.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id         uuid primary key,
  email      text,
  created_at timestamptz not null default now()
);

-- Same shape as Supabase's auth.identities for the columns our trigger
-- reads. One row is written per sign-in provider the first time a user
-- signs in with it.
create table auth.identities (
  id            uuid primary key default gen_random_uuid(),
  provider_id   text not null,
  user_id       uuid not null references auth.users(id) on delete cascade,
  identity_data jsonb not null,
  provider      text not null,
  email         text generated always as (lower(identity_data ->> 'email')) stored,
  created_at    timestamptz not null default now(),
  unique (provider_id, provider)
);

-- Supabase's auth.uid(): the `sub` claim of the request's JWT.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

grant execute on function auth.uid() to anon, authenticated, service_role;
