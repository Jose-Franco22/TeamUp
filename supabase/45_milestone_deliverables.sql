-- Milestone deliverables (issue #57). Run after 39_project_advisers.sql.
--
-- Numbered 45, not 40: open pull requests already claim 38, 40, 41, 42 and
-- 43, and 44 is left free for whichever of them has to move. On the live
-- database files apply in merge order, not by number, and nothing here
-- depends on 40–43 except the notification kinds restated below.
--
-- An admin marks a milestone as needing a deliverable; every team then has
-- one deliverable for it, submitted as a file in Storage or as a link,
-- resubmitted as often as they like, with a thread underneath for the
-- adviser's feedback and the team's replies.
--
-- What is NOT in this file yet, so nobody reads its absence as a rule:
--
--   THE ADVISER. Reviewing — setting Approved or Changes requested, and
--   commenting as the adviser — needs an accepted adviser, and only #54
--   (PR #90) can produce one. So does the adviser's read access. Both
--   arrive with #90 and use its advised_project_ids() rather than a second
--   way of asking the same question. Until then the only status any
--   function writes is 'submitted', nothing writes deliverable_comments.
--   decision, and can_see_deliverables() below lets in the team and admins
--   and nobody else. The one adviser-facing piece that is here is the
--   'deliverable_submitted' notification: it reads who the project's
--   accepted adviser is, which 39_ already records, rather than what the
--   caller advises, which is #90's question.
--
-- Decisions worth stating, since none of them is visible as a line of code:
--
-- 1. FILE TYPE AND SIZE ARE CHECKED IN THREE PLACES, because each one
--    covers a gap in the others:
--
--      * the bucket's allowed_mime_types and file_size_limit, which the
--        Storage server enforces on the upload itself, before it touches the
--        database. Postgres cannot see the bytes, so this is the only check
--        on the real size of the real file;
--      * the insert policy on storage.objects, which refuses any path that
--        isn't <project>/<milestone>/<uuid>.<pdf|docx|pptx> under a team the
--        caller is on, for a milestone that takes a deliverable. Most
--        refusals therefore happen at upload, before a file is stored;
--      * submit_deliverable(), which reads back the object Storage recorded
--        and checks its extension, MIME type and size again before a
--        submission may point at it — the bucket's limits are settings an
--        admin can change from the dashboard, and this is the line that
--        does not move with them.
--
-- 2. NOTHING IS OVERWRITTEN. A resubmission is a new row with the next
--    version number; earlier rows are never updated. Storage is the same:
--    there is no update or delete policy on storage.objects for this
--    bucket, so an upload with upsert is refused and a stored file stays
--    exactly as submitted. That absence is the rule.
--
-- 3. LATE IS RECORDED, NOT RECOMPUTED. is_late is set when the row is
--    written, against the due date as it stood then. Moving a milestone
--    later does not rewrite a team's history into "on time", and moving it
--    earlier does not turn on-time work late.
--
-- 4. A MILESTONE WITH SUBMISSIONS CANNOT BE DELETED OR UN-FLAGGED. Either
--    would hide every team's work: deleting by cascade, un-flagging by
--    dropping it off the team page. milestone_id is `on delete restrict`
--    and both functions say so in a sentence first.
--
-- 5. FILES OUTLIVE A DELETED PROJECT. Deleting a project cascades its
--    submission rows, but Storage files can't be removed from SQL (deleting
--    the storage.objects row orphans the file in the bucket instead). A
--    deleted project's files become unreachable — no row names them, and
--    the select policy below finds no team for them — but they are not
--    removed. Clearing them needs the Storage API, and is not done here.
--
-- 6. EVERY READ GOES THROUGH project_deliverables(). Submissions and
--    comments carry two foreign keys to `users` each, so a PostgREST embed
--    needs !constraint_name disambiguation — the shape that shipped broken
--    in #47. One function returns exactly what the team page draws, and the
--    mock in client.js returns the same thing.
begin;

-- --- the new kind ---------------------------------------------------------
-- Rewritten in full, as every migration since 21_ has done: the constraint
-- *is* the list. This is the list from 42_check_ins.sql (PR #93), which is
-- 40_respond_to_adviser_request.sql's (PR #90) plus 'check_in_reminder',
-- plus the one kind below. Listing kinds that have not landed yet costs
-- nothing; leaving them out would make this file narrow the constraint
-- under them if it merged after them. Whichever of these merges last has
-- to restate the union.
--
-- 'deliverable_submitted' goes to the project's accepted adviser. The
-- team's notice when the adviser responds arrives with the review half.

alter table public.notifications
  drop constraint if exists notifications_kind_check;

alter table public.notifications
  add constraint notifications_kind_check
  check (kind in ('adviser_accepted', 'adviser_declined', 'adviser_invited',
                  'adviser_removed', 'adviser_stepped_down', 'check_in_reminder',
                  'deadline_reminder', 'deliverable_submitted', 'join_request',
                  'member_added', 'member_assigned', 'member_left',
                  'member_removed', 'project_removed', 'request_accepted',
                  'request_declined', 'team_complete'));

-- --- milestones take a deliverable ----------------------------------------
-- Set through set_milestone_requires_deliverable() below rather than a new
-- argument on save_milestone(): adding one means dropping the five-argument
-- form 28_milestone_messages.sql defines and copying its validation here,
-- and an edit that didn't pass the new argument would quietly reset it.

alter table public.milestones
  add column if not exists requires_deliverable boolean not null default false;

-- --- deliverable_submissions ----------------------------------------------
-- One row per version. (project, milestone) is the deliverable; the newest
-- version's status is its status, and "Not submitted" is having no rows.

create table if not exists public.deliverable_submissions (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id) on delete restrict,
  version      integer not null
                 constraint deliverable_submissions_version_positive check (version >= 1),
  kind         text not null
                 constraint deliverable_submissions_kind_check check (kind in ('file', 'link')),
  file_path    text,
  file_name    text,
  file_size    bigint
                 constraint deliverable_submissions_file_size_check
                 check (file_size between 1 and 26214400),
  file_type    text,
  link_url     text,
  is_late      boolean not null,
  -- Only 'submitted' is ever written until the review half lands.
  status       text not null default 'submitted'
                 constraint deliverable_submissions_status_check
                 check (status in ('submitted', 'changes_requested', 'approved')),
  -- set null, not cascade: a member deleting their account shouldn't take
  -- the team's submitted work with them.
  submitted_by uuid
                 constraint deliverable_submissions_submitted_by_fkey
                 references public.users(id) on delete set null,
  submitted_at timestamptz not null default now(),
  constraint deliverable_submissions_one_version
    unique (project_id, milestone_id, version),
  constraint deliverable_submissions_file_or_link check (
    (kind = 'file'
       and file_path is not null and file_name is not null
       and file_size is not null and file_type is not null
       and link_url is null)
    or
    (kind = 'link'
       and link_url is not null
       and file_path is null and file_name is null
       and file_size is null and file_type is null)
  )
);

-- A version that points at the same file as an earlier one isn't a new
-- version of anything.
create unique index if not exists deliverable_submissions_file_path_idx
  on public.deliverable_submissions(file_path)
  where file_path is not null;

create index if not exists deliverable_submissions_milestone_idx
  on public.deliverable_submissions(milestone_id);

comment on table public.deliverable_submissions is
  'Every version a team has submitted for a milestone that requires a '
  'deliverable. Append-only: a resubmission is a new row.';

-- --- deliverable_comments -------------------------------------------------
-- The thread under a deliverable. submission_id is the version that was
-- newest when the comment was posted, so the thread can say what a comment
-- was about; null means nothing had been submitted yet.

create table if not exists public.deliverable_comments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  milestone_id  uuid not null references public.milestones(id) on delete restrict,
  submission_id uuid references public.deliverable_submissions(id) on delete cascade,
  author_id     uuid
                  constraint deliverable_comments_author_id_fkey
                  references public.users(id) on delete set null,
  body          text not null
                  constraint deliverable_comments_body_check
                  check (char_length(body) between 1 and 2000 and body = btrim(body, E' \t\n')),
  -- Written only by the adviser's review, which arrives with #90.
  decision      text
                  constraint deliverable_comments_decision_check
                  check (decision in ('approved', 'changes_requested')),
  created_at    timestamptz not null default now()
);

create index if not exists deliverable_comments_thread_idx
  on public.deliverable_comments(project_id, milestone_id, created_at);

-- --- who is who -----------------------------------------------------------
-- SECURITY DEFINER so a policy can call them without tripping the RLS of
-- the tables they read, and so the answer doesn't depend on what the caller
-- happens to be able to select. Executable by `authenticated` because RLS
-- policies run as the caller; `private` is not an exposed schema, so this
-- is not a way in from the API.

create or replace function private.is_deliverable_team_member(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.project_id = p_project_id
       and tm.user_id = auth.uid()
  );
$$;

-- The team and admins. The project's adviser joins them with #90, through
-- advised_project_ids().
create or replace function private.can_see_deliverables(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin() or private.is_deliverable_team_member(p_project_id);
$$;

-- The project a stored file belongs to: the first folder of its path, when
-- that is a uuid. Anything else is null, which no team owns — a cast that
-- raised instead would turn every listing of the bucket into an error.
create or replace function private.deliverable_path_project(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- What an upload has to be. The path is
--
--   <project id>/<milestone id>/<random uuid>.<pdf|docx|pptx>
--
-- chosen by the client, with the extension lower-cased. The random name
-- means two uploads never collide and nothing user-typed ends up in a
-- storage key; the file's own name is kept on the submission row.
create or replace function private.may_upload_deliverable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/'
                  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]+$'
     and storage.extension(p_name) in ('pdf', 'docx', 'pptx')
     and private.is_deliverable_team_member(split_part(p_name, '/', 1)::uuid)
     and exists (
       select 1 from public.milestones m
        where m.id = split_part(p_name, '/', 2)::uuid
          and m.requires_deliverable
     );
$$;

revoke all on function private.is_deliverable_team_member(uuid) from public, anon;
revoke all on function private.can_see_deliverables(uuid) from public, anon;
revoke all on function private.deliverable_path_project(text) from public, anon;
revoke all on function private.may_upload_deliverable(text) from public, anon;
grant execute on function private.is_deliverable_team_member(uuid) to authenticated;
grant execute on function private.can_see_deliverables(uuid) to authenticated;
grant execute on function private.deliverable_path_project(text) to authenticated;
grant execute on function private.may_upload_deliverable(text) to authenticated;

-- --- who can read the rows ------------------------------------------------
-- A select policy each and no insert, update or delete policy: the
-- functions below are the only way to write, so a direct insert is refused
-- outright and a direct update or delete matches no rows.

alter table public.deliverable_submissions enable row level security;
alter table public.deliverable_comments enable row level security;

drop policy if exists deliverable_submissions_select_viewers on public.deliverable_submissions;
create policy deliverable_submissions_select_viewers
  on public.deliverable_submissions for select
  to authenticated
  using (private.can_see_deliverables(project_id));

drop policy if exists deliverable_comments_select_viewers on public.deliverable_comments;
create policy deliverable_comments_select_viewers
  on public.deliverable_comments for select
  to authenticated
  using (private.can_see_deliverables(project_id));

-- --- the bucket -----------------------------------------------------------
-- Private: every download is a signed URL minted through the select policy
-- below, so a file is never readable by anyone the policy refuses. The
-- limits are restated on conflict so re-running this file puts them back if
-- someone loosened them in the dashboard.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deliverables', 'deliverables', false, 26214400,
  array['application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Download and signed URLs go through select; upload goes through insert.
-- There is deliberately no update or delete policy for this bucket — see
-- decision 2. Policies on storage.objects are shared by every bucket, so
-- each one names its bucket first.

drop policy if exists deliverables_select_viewers on storage.objects;
create policy deliverables_select_viewers
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'deliverables'
    and private.can_see_deliverables(private.deliverable_path_project(name))
  );

drop policy if exists deliverables_insert_team on storage.objects;
create policy deliverables_insert_team
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'deliverables'
    and private.may_upload_deliverable(name)
  );

-- --- set_milestone_requires_deliverable -----------------------------------
-- The admin's switch. Turning it off is refused once any team has submitted
-- (decision 4). Bumps updated_at, which is what puts a changed milestone on
-- the Announcements tab: "this now needs a deliverable" is news to students.

create or replace function public.set_milestone_requires_deliverable(p_id uuid, p_requires boolean)
returns public.milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.milestones;
begin
  perform public.require_admin();

  if p_requires is null then
    raise exception 'Say whether the milestone needs a deliverable';
  end if;

  -- The same lock save_milestone() and delete_milestone() take.
  perform pg_advisory_xact_lock(hashtext('public.milestones'));

  select * into v_row from public.milestones where id = p_id for update;
  if not found then
    raise exception 'Milestone not found';
  end if;

  if not p_requires and exists (
    select 1 from public.deliverable_submissions where milestone_id = p_id
  ) then
    raise exception 'Teams have already submitted for this milestone, so it has to keep taking deliverables';
  end if;

  update public.milestones
     set requires_deliverable = p_requires, updated_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_milestone_requires_deliverable(uuid, boolean) from public, anon;
grant execute on function public.set_milestone_requires_deliverable(uuid, boolean) to authenticated;

-- --- delete_milestone -----------------------------------------------------
-- 26_milestones.sql's, with decision 4 in front of it. Same signature, so
-- the existing grants stand. Without the check the foreign key still holds,
-- but the admin would read a constraint name instead of a reason.

create or replace function public.delete_milestone(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();

  perform pg_advisory_xact_lock(hashtext('public.milestones'));

  if exists (select 1 from public.deliverable_submissions where milestone_id = p_id) then
    raise exception 'Teams have already submitted for this milestone, so it can''t be deleted';
  end if;

  delete from public.milestones where id = p_id;
  if not found then
    raise exception 'Milestone not found';
  end if;
end;
$$;

-- --- submit_deliverable ---------------------------------------------------
-- A file (already uploaded to the bucket by the client) or a link — exactly
-- one. Checks run in this order, and every refusal raises before the
-- insert, so a refused submission notifies nobody:
--
--   signed in → project exists → caller is on its team → milestone exists
--   → it takes a deliverable → one of file or link → that one is valid.
--
-- Any member may submit, whether or not the team has filled: the issue
-- says "any team member", and a proposal can be due before a roster is.

create or replace function public.submit_deliverable(
  p_project_id   uuid,
  p_milestone_id uuid,
  p_file_path    text default null,
  p_file_name    text default null,
  p_link_url     text default null
)
returns public.deliverable_submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_milestone public.milestones;
  v_path text := nullif(btrim(coalesce(p_file_path, '')), '');
  v_name text := nullif(btrim(coalesce(p_file_name, '')), '');
  v_link text := nullif(btrim(coalesce(p_link_url, '')), '');
  v_metadata jsonb;
  v_ext text;
  v_type text;
  v_size bigint;
  v_version integer;
  v_row public.deliverable_submissions;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  if not private.is_deliverable_team_member(p_project_id) then
    raise exception 'Only members of this team can submit its deliverables';
  end if;

  select * into v_milestone from public.milestones where id = p_milestone_id;
  if not found then
    raise exception 'Milestone not found';
  end if;

  if not v_milestone.requires_deliverable then
    raise exception 'This milestone doesn''t take a deliverable';
  end if;

  if v_path is null and v_link is null then
    raise exception 'Choose a file or paste a link';
  end if;
  if v_path is not null and v_link is not null then
    raise exception 'Submit a file or a link, not both';
  end if;

  if v_link is not null then
    if char_length(v_link) > 2000 then
      raise exception 'Keep the link to 2000 characters or fewer';
    end if;
    -- A scheme, a host with a dot in it, and no whitespace. Not a full URL
    -- grammar: the point is that what the adviser clicks is a web address
    -- and not "javascript:" or a sentence.
    if v_link !~* '^https?://[^[:space:]/?#]+\.[^[:space:]/?#]+([/?#][^[:space:]]*)?$' then
      raise exception 'Paste a full link that starts with http:// or https://';
    end if;
  else
    -- The folder is what the storage policies read, so a file stored under
    -- another deliverable — or another team — can't be borrowed by naming it.
    if left(v_path, 74) <> p_project_id::text || '/' || p_milestone_id::text || '/' then
      raise exception 'That file isn''t in this deliverable''s folder';
    end if;

    select o.metadata into v_metadata
      from storage.objects o
     where o.bucket_id = 'deliverables' and o.name = v_path;
    if not found then
      raise exception 'That file hasn''t been uploaded';
    end if;

    -- What Storage recorded about the upload, not what the client says.
    -- Storage fills metadata in once the bytes have arrived, so a row
    -- without it is an upload still in flight (or one that failed), and
    -- there is nothing yet to check the type or size of.
    v_size := (v_metadata ->> 'size')::bigint;
    if v_size is null or v_size < 1 then
      raise exception 'That file is empty or hasn''t finished uploading';
    end if;

    -- The MIME type is compared without parameters (";charset=…").
    v_ext := lower(storage.extension(v_path));
    v_type := lower(btrim(split_part(coalesce(v_metadata ->> 'mimetype', ''), ';', 1)));
    if (v_ext, v_type) not in (
      ('pdf',  'application/pdf'),
      ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      ('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    ) then
      raise exception 'Upload a PDF, DOCX or PPTX file';
    end if;

    if v_size > 26214400 then
      raise exception 'Files can be at most 25 MB';
    end if;

    if v_name is null then
      raise exception 'Give the file a name';
    end if;
    if char_length(v_name) > 200 then
      raise exception 'Keep the file name to 200 characters or fewer';
    end if;
    if v_name ~ '[[:cntrl:]]' or v_name ~ '[​-‏‪-‮⁠-⁩﻿]' then
      raise exception 'The file name can''t contain hidden or control characters';
    end if;

    -- Read first only to say it in a sentence; the unique index holds it.
    if exists (select 1 from public.deliverable_submissions where file_path = v_path) then
      raise exception 'That file has already been submitted';
    end if;
  end if;

  -- Two members submitting at once take turns, so they get versions n and
  -- n+1 instead of one of them failing on the unique constraint.
  perform pg_advisory_xact_lock(
    hashtext('public.deliverable_submissions:' || p_project_id::text || ':' || p_milestone_id::text));

  select coalesce(max(version), 0) + 1 into v_version
    from public.deliverable_submissions
   where project_id = p_project_id and milestone_id = p_milestone_id;

  insert into public.deliverable_submissions (
    project_id, milestone_id, version, kind,
    file_path, file_name, file_size, file_type, link_url,
    is_late, submitted_by
  )
  values (
    p_project_id, p_milestone_id, v_version,
    case when v_link is null then 'file' else 'link' end,
    v_path,
    case when v_link is null then v_name end,
    case when v_link is null then v_size end,
    case when v_link is null then v_ext end,
    v_link,
    -- Decision 3. On the due moment itself is on time.
    now() > v_milestone.due_at,
    caller
  )
  returning * into v_row;

  -- The accepted adviser, if the project has one. Reads 39_'s table
  -- directly: the question is "who advises this project", not "what does
  -- the caller advise", which is what #90's advised_project_ids() answers.
  insert into public.notifications (user_id, kind, project_id, actor_id)
  select ar.adviser_id, 'deliverable_submitted', p_project_id, caller
    from public.adviser_requests ar
   where ar.project_id = p_project_id
     and ar.status = 'accepted';

  return v_row;
end;
$$;

revoke all on function public.submit_deliverable(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.submit_deliverable(uuid, uuid, text, text, text) to authenticated;

-- --- post_deliverable_comment ---------------------------------------------
-- The team's side of the thread. The adviser's side, with a decision,
-- arrives with #90. A comment is allowed before anything is submitted —
-- "the draft is coming Friday" is a reasonable thing to say — and is then
-- about no version.

create or replace function public.post_deliverable_comment(
  p_project_id   uuid,
  p_milestone_id uuid,
  p_body         text
)
returns public.deliverable_comments
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_milestone public.milestones;
  -- Same normalising as a milestone message (28_): Windows line endings
  -- become plain ones, and whitespace at either end goes.
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), E'\r\n?', E'\n', 'g'), E' \t\n');
  v_latest uuid;
  v_row public.deliverable_comments;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  if not private.is_deliverable_team_member(p_project_id) then
    raise exception 'Only members of this team can comment on its deliverables';
  end if;

  select * into v_milestone from public.milestones where id = p_milestone_id;
  if not found then
    raise exception 'Milestone not found';
  end if;
  if not v_milestone.requires_deliverable then
    raise exception 'This milestone doesn''t take a deliverable';
  end if;

  if v_body = '' then
    raise exception 'Write a comment first';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Keep the comment to 2000 characters or fewer';
  end if;
  if v_body ~ '[\x01-\x08\x0B-\x1F\x7F]' or v_body ~ '[​-‏‪-‮⁠-⁩﻿]' then
    raise exception 'The comment can''t contain hidden or control characters';
  end if;

  select s.id into v_latest
    from public.deliverable_submissions s
   where s.project_id = p_project_id and s.milestone_id = p_milestone_id
   order by s.version desc
   limit 1;

  insert into public.deliverable_comments (project_id, milestone_id, submission_id, author_id, body)
  values (p_project_id, p_milestone_id, v_latest, caller, v_body)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.post_deliverable_comment(uuid, uuid, text) from public, anon;
grant execute on function public.post_deliverable_comment(uuid, uuid, text) to authenticated;

-- --- project_deliverables -------------------------------------------------
-- What the team page draws: every milestone that takes a deliverable, in
-- due order, each with its status, every version newest first and the
-- thread oldest first. One call, one shape, and client.js's mock builds the
-- same one.
--
-- This is SECURITY DEFINER and reachable as /rpc/project_deliverables, so
-- it walks straight past the select policies above — which is why it
-- checks can_see_deliverables() itself, first, and refuses rather than
-- returning an empty list. project_adviser() shipped without that check
-- once (#88); this one is tested for it.

create or replace function public.project_deliverables(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_result jsonb;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'Project not found';
  end if;

  if not private.can_see_deliverables(p_project_id) then
    raise exception 'Only this team, its adviser and admins can see its deliverables';
  end if;

  select coalesce(jsonb_agg(d.item order by d.due_at, d.name), '[]'::jsonb)
    into v_result
    from (
      select m.due_at, m.name,
             jsonb_build_object(
               'milestone_id', m.id,
               'name', m.name,
               'due_at', m.due_at,
               'message', m.message,
               'status', coalesce(latest.status, 'not_submitted'),
               'is_late', coalesce(latest.is_late, false),
               'versions', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', s.id,
                          'version', s.version,
                          'kind', s.kind,
                          'file_path', s.file_path,
                          'file_name', s.file_name,
                          'file_size', s.file_size,
                          'file_type', s.file_type,
                          'link_url', s.link_url,
                          'is_late', s.is_late,
                          'status', s.status,
                          'submitted_by', s.submitted_by,
                          'submitted_by_name', u.name,
                          'submitted_at', s.submitted_at
                        ) order by s.version desc)
                   from public.deliverable_submissions s
                   left join public.users u on u.id = s.submitted_by
                  where s.project_id = p_project_id and s.milestone_id = m.id
               ), '[]'::jsonb),
               'comments', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id', c.id,
                          'author_id', c.author_id,
                          'author_name', u.name,
                          'body', c.body,
                          'decision', c.decision,
                          'version', s.version,
                          'created_at', c.created_at
                        ) order by c.created_at, c.id)
                   from public.deliverable_comments c
                   left join public.users u on u.id = c.author_id
                   left join public.deliverable_submissions s on s.id = c.submission_id
                  where c.project_id = p_project_id and c.milestone_id = m.id
               ), '[]'::jsonb)
             ) as item
        from public.milestones m
        left join lateral (
          select s.status, s.is_late
            from public.deliverable_submissions s
           where s.project_id = p_project_id and s.milestone_id = m.id
           order by s.version desc
           limit 1
        ) latest on true
       where m.requires_deliverable
    ) d;

  return v_result;
end;
$$;

revoke all on function public.project_deliverables(uuid) from public, anon;
grant execute on function public.project_deliverables(uuid) to authenticated;

commit;
