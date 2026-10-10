-- Test harness only — never run this against the real Supabase project.
--
-- The tables as they were before any numbered file ran (the schema the
-- project was created with, from the original TODO-backend.md). The
-- numbered files in supabase/ are then applied on top, in order, exactly
-- like the live database got them — so the tests also prove that
-- 01_…sql through the newest file still apply cleanly from scratch.
-- 04_roles_and_team_deletion.sql is what moves this to the current schema
-- (adds roles, replaces team_members.role with role_id).

create table public.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text not null unique
                       check (email ~* '^[^@]+@utrgv\.edu$'),
  microsoft_oid      text not null unique,
  name               text not null,
  bio                text not null default '',
  availability_hours smallint not null default 0 check (availability_hours >= 0),
  github_url         text not null default '',
  created_at         timestamptz not null default now()
);

create table public.skills (
  id       uuid primary key default gen_random_uuid(),
  name     text not null unique,
  category text not null check (category in ('Frontend', 'Backend', 'Data', 'Tools'))
);

create table public.user_skills (
  user_id  uuid not null references public.users(id) on delete cascade,
  skill_id uuid not null references public.skills(id) on delete cascade,
  source   text not null check (source in ('manual', 'resume')),
  primary key (user_id, skill_id)
);

create table public.projects (
  id               uuid primary key default gen_random_uuid(),
  creator_id       uuid not null references public.users(id),
  title            text not null,
  description      text not null default '',
  team_size_target smallint not null check (team_size_target > 0),
  status           text not null default 'open' check (status in ('open', 'full')),
  created_at       timestamptz not null default now()
);
create index projects_status_idx on public.projects(status);

create table public.project_roles_needed (
  project_id      uuid not null references public.projects(id) on delete cascade,
  skill_id        uuid not null references public.skills(id),
  quantity_needed smallint not null check (quantity_needed > 0),
  primary key (project_id, skill_id)
);

create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade,
  formed_at  timestamptz
);

create table public.team_members (
  user_id   uuid primary key references public.users(id) on delete cascade,
  team_id   uuid not null references public.teams(id) on delete cascade,
  role      text not null,
  joined_at timestamptz not null default now()
);
create index team_members_team_id_idx on public.team_members(team_id);

create table public.join_requests (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now()
);
create unique index join_requests_one_pending_idx
  on public.join_requests(project_id, user_id) where status = 'pending';
create index join_requests_user_id_idx on public.join_requests(user_id);
