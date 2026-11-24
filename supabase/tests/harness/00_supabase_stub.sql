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

-- --- storage --------------------------------------------------------------
-- Supabase Storage keeps one row per file in storage.objects, and the
-- Storage server runs every upload, download and signed-URL request as a
-- SQL statement against that table *as the caller* — role `authenticated`,
-- JWT claims set, exactly what tests.authenticate_as() does. So the RLS
-- policies a migration puts on storage.objects are the real gate, and they
-- can be tested here by doing what the server does:
--
--   upload    → insert into storage.objects (bucket_id, name, owner, metadata)
--   download  → select … from storage.objects where bucket_id = … and name = …
--               (no row visible means "Object not found"; signed URLs are
--               minted through the same select)
--   overwrite → insert … on conflict (bucket_id, name) do update, so it needs
--               an update policy as well as an insert one
--
-- What this cannot reproduce is the server's own checks, which run before
-- it touches the database: a bucket's file_size_limit and
-- allowed_mime_types are enforced in the Storage server, not by Postgres.
-- The columns are here so a migration can set them and a test can read
-- them back; nothing here enforces them, and a test that pretends otherwise
-- is lying.
--
-- Column names and types follow Supabase's storage schema for every column
-- a policy or function could reasonably read. Supabase grants the API roles
-- all privileges on both tables and relies on RLS, which is enabled on both
-- with no policies — so until a migration adds one, nobody but the table
-- owner (and service_role, which bypasses RLS) can see a single row.

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  owner_id           text,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  public             boolean default false,
  avif_autodetection boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);
create unique index bname on storage.buckets (name);

create table storage.objects (
  id               uuid primary key default gen_random_uuid(),
  bucket_id        text references storage.buckets(id),
  name             text,
  owner            uuid,
  owner_id         text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  last_accessed_at timestamptz default now(),
  -- Written by the Storage server from the upload itself: size, mimetype,
  -- eTag, cacheControl, lastModified, contentLength, httpStatusCode.
  metadata         jsonb,
  path_tokens      text[] generated always as (string_to_array(name, '/')) stored,
  version          text,
  user_metadata    jsonb
);
create unique index bucketid_objname on storage.objects (bucket_id, name);
create index name_prefix_search on storage.objects (name text_pattern_ops);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;

grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- Supabase's path helpers, which policies use to read the folder a file
-- sits in. Same bodies as Supabase's: foldername('a/b/c.pdf') is {a,b},
-- filename is 'c.pdf', extension is 'pdf' — and extension is case-sensitive,
-- so 'Report.PDF' gives 'PDF'.
create or replace function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create or replace function storage.filename(name text)
returns text
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create or replace function storage.extension(name text)
returns text
language plpgsql
as $$
declare
  _parts text[];
  _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant execute on function storage.foldername(text), storage.filename(text), storage.extension(text)
  to anon, authenticated, service_role;
