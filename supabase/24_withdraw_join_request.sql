-- Withdrawing a join request (issue #33). Run after
-- 23_join_request_notifications.sql.
--
-- A student can take back a request that's still pending. The row stays
-- (so it shows as Withdrawn on their Requests page) but drops out of the
-- owner's list, which only shows pending requests. Nothing else changes:
-- create_join_request() only refuses while a *pending* request exists, and
-- join_requests_one_pending_idx is partial on status = 'pending', so the
-- student can ask for the same project again later.

-- --- join_requests.status ------------------------------------------------
alter table public.join_requests
  drop constraint if exists join_requests_status_check;
alter table public.join_requests
  add constraint join_requests_status_check
  check (status in ('pending', 'accepted', 'declined', 'withdrawn'));

-- --- withdraw_join_request -----------------------------------------------
-- Locks the request row so a withdraw and the owner's accept/decline can't
-- both win: respond_to_join_request() locks the same row, and whichever
-- comes second sees the status is no longer 'pending'.
create or replace function public.withdraw_join_request(p_request_id uuid)
returns public.join_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  v_request public.join_requests;
  v_creator uuid;
begin
  if caller is null then
    raise exception 'Not signed in';
  end if;

  select * into v_request from public.join_requests where id = p_request_id for update;
  if not found or v_request.user_id <> caller then
    raise exception 'Only the student who sent this request can withdraw it';
  end if;

  if v_request.status <> 'pending' then
    raise exception 'Only a pending request can be withdrawn';
  end if;

  update public.join_requests set status = 'withdrawn'
  where id = p_request_id
  returning * into v_request;

  -- The creator's "X asked to join" alert is about a request that no longer
  -- needs them, so it stops showing. Marked read rather than deleted.
  select creator_id into v_creator from public.projects where id = v_request.project_id;
  update public.notifications
    set read_at = now()
    where user_id = v_creator
      and kind = 'join_request'
      and project_id = v_request.project_id
      and actor_id = caller
      and read_at is null;

  return v_request;
end;
$$;

grant execute on function public.withdraw_join_request(uuid) to authenticated;
