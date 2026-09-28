-- Evidence behind a resume-imported skill: how many months the student used
-- it, how many projects it appeared in, and the resume line it was found on.
-- Run after 06_seed_skills.sql. The resume importer computes these in the
-- browser (frontend/src/lib/resume/evidence.js, toProfileRows in parse.js);
-- this is where they land once the student confirms, and what the matching
-- engine scores.
--
-- One row per (student, skill), keyed to user_skills rather than to users and
-- skills separately: evidence for a skill the student no longer lists is
-- meaningless, so removing the user_skills row removes this one with it.
-- Re-importing an updated resume overwrites the row.

create table public.profile_evidence (
  user_id    uuid not null,
  skill_id   uuid not null,
  months     smallint not null default 0 check (months between 0 and 72), -- MAX_MONTHS in evidence.js
  projects   smallint not null default 0 check (projects >= 0),
  quote      text check (char_length(quote) <= 200),                     -- shortened to 160 client-side
  updated_at timestamptz not null default now(),
  primary key (user_id, skill_id),
  foreign key (user_id, skill_id)
    references public.user_skills (user_id, skill_id) on delete cascade
);

alter table public.profile_evidence enable row level security;

-- Own rows only, for reading too. The quote is a verbatim resume line and can
-- be the contact header (a GitHub link, a phone number), so it is not
-- published the way user_skills is. When the matching engine needs other
-- students' months/projects, expose those columns through a SECURITY DEFINER
-- function rather than widening this policy.
create policy "profile_evidence_manage_own"
  on public.profile_evidence for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
