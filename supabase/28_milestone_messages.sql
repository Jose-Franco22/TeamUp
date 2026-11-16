-- Milestone messages, and keeping garbage out of every milestone field
-- (issue #38). Run after 27_admin_placement.sql.
--
-- An admin can explain what's expected at a milestone ("Upload the
-- proposal PDF to Blackboard, one per team"). Students read every field in
-- the banner, so each is held to what a person would actually write.
--
-- The name (required, 1-80 characters, from 26_milestones.sql) now also has
-- to contain letters or numbers, and can't hold control characters (line
-- breaks included) or invisible ones.
--
-- The due date has to fall in 2000-2099: a date picker happily accepts
-- 0001 or 275760, and neither is a class deadline.
--
-- The message is optional; when there is one it has to:
--
--   * be 1000 characters or fewer, with no whitespace at either end;
--   * contain letters or numbers — "...", "!!!!", "→→→" or a row of emoji
--     isn't a message;
--   * have no control or invisible characters. Line breaks and tabs are
--     fine; zero-width characters and bidirectional overrides aren't,
--     since they make text read differently from what's stored;
--   * not pile up blank lines: at most one blank line in a row.
--
-- The CHECK constraint is the boundary; save_milestone() raises the same
-- rules first so the admin gets a sentence instead of a constraint name.
-- lib/validation.js mirrors them for the form.
--
-- "Letters or numbers" is checked as "something other than spaces,
-- punctuation, symbols and emoji", so text in any script passes.
-- Postgres's [[:alnum:]] only knows ASCII under the C locale, which would
-- refuse a message written in, say, Chinese — hence the ranges instead.
--
-- None of this is about SQL injection: these functions only ever use the
-- values as parameters (no EXECUTE or dynamic SQL anywhere), so text like
-- "'; drop table milestones; --" is stored as the harmless string it is.
-- The app renders it as text too, never as HTML.
begin;

alter table public.milestones add column message text not null default '';

alter table public.milestones
  add constraint milestones_name_text check (
    name ~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]'
    and name !~ '[[:cntrl:]]'
    and name !~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]'
  ),
  add constraint milestones_due_at_range check (
    due_at >= '2000-01-01 00:00+00' and due_at < '2100-01-01 00:00+00'
  ),
  add constraint milestones_message_text check (
    message = ''
    or (
      char_length(message) <= 1000
      and message = btrim(message, E' \t\n')
      and message ~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]'
      and message !~ '[\x01-\x08\x0B-\x1F\x7F]'
      and message !~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]'
      and message !~ '\n[ \t]*\n[ \t]*\n'
    )
  );

-- --- save_milestone ------------------------------------------------------
-- Same job as in 26_milestones.sql, with a message. The old four-argument
-- form is dropped so a call can't land on it and skip the new checks;
-- callers passing four arguments still work, since p_message defaults to ''.
drop function if exists public.save_milestone(uuid, text, timestamptz, boolean);

create or replace function public.save_milestone(
  p_id uuid,
  p_name text,
  p_due_at timestamptz,
  p_is_formation_deadline boolean default false,
  p_message text default ''
)
returns public.milestones
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  -- Windows line endings become plain ones before anything is checked.
  -- Spaces, tabs and blank lines at either end are trimmed, so a message of
  -- only whitespace is no message.
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), E'\r\n?', E'\n', 'g'), E' \t\n');
  v_flag boolean := coalesce(p_is_formation_deadline, false);
  v_row public.milestones;
begin
  perform public.require_admin();

  if v_name = '' then
    raise exception 'A milestone needs a name';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'Keep the milestone name to 80 characters or fewer';
  end if;
  if v_name ~ '[[:cntrl:]]' or v_name ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]' then
    raise exception 'The milestone name can''t contain line breaks, hidden or control characters';
  end if;
  if v_name !~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]' then
    raise exception 'The milestone name has to include letters or numbers';
  end if;
  if p_due_at is null then
    raise exception 'A milestone needs a due date';
  end if;
  if p_due_at < '2000-01-01 00:00+00' or p_due_at >= '2100-01-01 00:00+00' then
    raise exception 'Pick a due date between 2000 and 2099';
  end if;

  if v_message <> '' then
    if char_length(v_message) > 1000 then
      raise exception 'Keep the message to 1000 characters or fewer';
    end if;
    if v_message ~ '[\x01-\x08\x0B-\x1F\x7F]' or v_message ~ '[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]' then
      raise exception 'The message can''t contain hidden or control characters';
    end if;
    if v_message !~ '[^[:space:][:punct:]\u2000-\u2BFF\u2E00-\u2E7F\u3000-\u303F\uFE00-\uFE0F\U0001F000-\U0001FAFF]' then
      raise exception 'The message has to include letters or numbers';
    end if;
    if v_message ~ '\n[ \t]*\n[ \t]*\n' then
      raise exception 'Leave at most one blank line in a row in the message';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.milestones'));

  if p_id is not null and not exists (select 1 from public.milestones where id = p_id) then
    raise exception 'Milestone not found';
  end if;

  if v_flag then
    update public.milestones
       set is_formation_deadline = false, updated_at = now()
     where is_formation_deadline and id is distinct from p_id;
  end if;

  if p_id is null then
    insert into public.milestones (name, due_at, is_formation_deadline, message)
    values (v_name, p_due_at, v_flag, v_message)
    returning * into v_row;
  else
    update public.milestones
       set name = v_name, due_at = p_due_at, is_formation_deadline = v_flag,
           message = v_message, updated_at = now()
     where id = p_id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

revoke all on function public.save_milestone(uuid, text, timestamptz, boolean, text) from public, anon;
grant execute on function public.save_milestone(uuid, text, timestamptz, boolean, text) to authenticated;

commit;
