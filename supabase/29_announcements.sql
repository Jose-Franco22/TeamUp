-- Announcements (follows #38). Run after 28_milestone_messages.sql.
--
-- Admins and advisers (users.is_admin, 18_admin_access.sql) post
-- announcements; every signed-in user reads them on /announcements, next
-- to the milestones from 26_milestones.sql. The Announcements tab shows a
-- count of what's new since the student last opened the page — new or
-- edited announcements, and new or changed milestones (a moved deadline is
-- news too).
--
--   * public.announcements: title and body, held to the same rules as a
--     milestone message (28_milestone_messages.sql) so nothing a student
--     reads is garbage. Title: 1-120 characters, letters or numbers, no
--     line breaks, control or invisible characters. Body: required, 1-2000
--     characters, line breaks allowed but at most one blank line in a row,
--     no control or invisible characters.
--   * save_announcement() / delete_announcement(): admins only.
--   * announcement_feed(): every announcement with its author's name.
--     Students can't read admin accounts (18_), so the name comes from here.
--   * unseen_announcement_count() / mark_announcements_seen(): the tab's
--     badge, from users.announcements_seen_at.
--
-- No function here builds SQL from text, and every id is typed uuid: an
-- injection attempt is stored, or refused, as the plain value it is.
begin;

-- --- announcements ---------------------------------------------------------
create table public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text not null,
  author_id  uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_text check (
    char_length(title) between 1 and 120
    and title = btrim(title)
    and title ~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]'
    and title !~ '[[:cntrl:]]'
    and title !~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]'
  ),
  constraint announcements_body_text check (
    char_length(body) between 1 and 2000
    and body = btrim(body, E' \t\n')
    and body ~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]'
    and body !~ '[\x01-\x08\x0B-\x1F\x7F]'
    and body !~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]'
    and body !~ '\n[ \t]*\n[ \t]*\n'
  )
);
create index announcements_created_at_idx on public.announcements(created_at desc);

alter table public.announcements enable row level security;

-- Signed-in users only: unlike the milestone dates, announcements can say
-- things meant for the class rather than the public. No write policies —
-- admins go through the functions below.
create policy "announcements_select_authenticated"
  on public.announcements for select
  to authenticated
  using (true);

-- When the user last opened /announcements. Null means never, so
-- everything counts as new. Written only by mark_announcements_seen().
alter table public.users add column announcements_seen_at timestamptz;

-- --- save_announcement -----------------------------------------------------
-- Posts an announcement (p_id null) or edits one. The author stays whoever
-- first posted it; updated_at moves, so an edit shows as new again.
create or replace function public.save_announcement(p_id uuid, p_title text, p_body text)
returns public.announcements
language plpgsql
security definer
set search_path = public
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), E'\r\n?', E'\n', 'g'), E' \t\n');
  v_row public.announcements;
begin
  perform public.require_admin();

  if v_title = '' then
    raise exception 'An announcement needs a title';
  end if;
  if char_length(v_title) > 120 then
    raise exception 'Keep the title to 120 characters or fewer';
  end if;
  if v_title ~ '[[:cntrl:]]' or v_title ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]' then
    raise exception 'The title can''t contain line breaks, hidden or control characters';
  end if;
  if v_title !~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]' then
    raise exception 'The title has to include letters or numbers';
  end if;

  if v_body = '' then
    raise exception 'An announcement needs a message';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'Keep the message to 2000 characters or fewer';
  end if;
  if v_body ~ '[\x01-\x08\x0B-\x1F\x7F]' or v_body ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]' then
    raise exception 'The message can''t contain hidden or control characters';
  end if;
  if v_body !~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]' then
    raise exception 'The message has to include letters or numbers';
  end if;
  if v_body ~ '\n[ \t]*\n[ \t]*\n' then
    raise exception 'Leave at most one blank line in a row in the message';
  end if;

  if p_id is null then
    insert into public.announcements (title, body, author_id)
    values (v_title, v_body, auth.uid())
    returning * into v_row;
  else
    update public.announcements
       set title = v_title, body = v_body, updated_at = now()
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'Announcement not found';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.delete_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.require_admin();
  delete from public.announcements where id = p_id;
  if not found then
    raise exception 'Announcement not found';
  end if;
end;
$$;

-- --- announcement_feed -----------------------------------------------------
-- Newest first, with the author's name filled in.
create or replace function public.announcement_feed()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'title', a.title, 'body', a.body,
      'created_at', a.created_at, 'updated_at', a.updated_at,
      'author_name', u.name
    ) order by a.created_at desc, a.id)
    from public.announcements a
    left join public.users u on u.id = a.author_id
  ), '[]'::jsonb);
end;
$$;

-- --- the tab's badge -------------------------------------------------------
-- Announcements and milestones new or changed since the caller last opened
-- the page. Admins write them, so they're never told about them.
create or replace function public.unseen_announcement_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_seen timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if private.is_admin() then
    return 0;
  end if;
  select announcements_seen_at into v_seen from public.users where id = auth.uid();
  return (select count(*) from public.announcements where v_seen is null or updated_at > v_seen)
       + (select count(*) from public.milestones where v_seen is null or updated_at > v_seen);
end;
$$;

create or replace function public.mark_announcements_seen()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.users set announcements_seen_at = now() where id = auth.uid();
end;
$$;

revoke all on function public.save_announcement(uuid, text, text), public.delete_announcement(uuid),
  public.announcement_feed(), public.unseen_announcement_count(), public.mark_announcements_seen()
from public, anon;
grant execute on function public.save_announcement(uuid, text, text), public.delete_announcement(uuid),
  public.announcement_feed(), public.unseen_announcement_count(), public.mark_announcements_seen()
to authenticated;

commit;
