-- Who advises which team, for the adviser digest (issues #59 and #54). Run
-- after 38_adviser_digest.sql, which defines private.advised_teams() as a
-- stub, and 39_project_advisers.sql, which creates adviser_requests. Nothing
-- here depends on 40, 41 or 42.
--
-- 38 left the body empty because nothing linked an adviser to a team yet, and
-- #54 (40_respond_to_adviser_request.sql) deferred filling it: on the live
-- database migrations apply in merge order, not file order, so a body put in
-- 40 would have been overwritten by the stub if 38 merged afterwards. A file
-- numbered after both, landing with 38, is applied after the stub whichever
-- PR merges first. It needs only 38 and 39, both already on this branch.
--
-- An adviser advises a team when they hold an accepted adviser_requests row
-- for its project. Pending invitations are not advising yet, and declined or
-- cancelled ones (including stepping down and being removed) no longer are,
-- so all three are left out. Teams are keyed by project, one team per
-- project, as everywhere else.
--
-- The signature is unchanged, so everything 38 builds on it
-- (adviser_digest_data, adviser_digest_recipients, send_adviser_digests)
-- picks this up with no change of its own.
begin;

create or replace function private.advised_teams(p_adviser uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
    from public.adviser_requests ar
    join public.teams t on t.project_id = ar.project_id
   where ar.adviser_id = p_adviser
     and ar.status = 'accepted';
$$;

-- `create or replace` keeps the grants 38 set, but restating them means this
-- file is safe on its own: the private schema is visible to signed-in users
-- (18_admin_access.sql), and this answers who advises whom.
revoke all on function private.advised_teams(uuid) from public, anon, authenticated;

commit;
