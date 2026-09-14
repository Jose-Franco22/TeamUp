-- Run this in the Supabase SQL editor (or via the CLI) against the project
-- that already has the tables from TODO-backend.md's Schema section.
--
-- What this does: whenever someone signs in with Microsoft (Azure) for the
-- first time, Supabase creates a row in auth.users plus one in
-- auth.identities carrying the raw Azure claims. This trigger reads that
-- identity and provisions the matching public.users row.
--
-- Design choice: public.users.id is set to auth.users.id (i.e. auth.uid())
-- rather than a fresh random uuid, so every RLS policy elsewhere can just
-- compare auth.uid() = <fk column> instead of joining through
-- auth.identities on every check. microsoft_oid still stores the real
-- Entra object id (the `oid` claim — Microsoft's stable per-tenant account
-- id, distinct from the more app-scoped `sub`), exactly as designed; it's
-- just not what RLS keys off of.
--
-- The @utrgv.edu check here is a backstop, not the primary gate — the
-- primary gate should be restricting the Entra app registration itself to
-- the UTRGV tenant. This trigger (and the existing CHECK constraint on
-- users.email) means that even if that's ever misconfigured, a non-UTRGV
-- account can't end up with an app account.

create or replace function public.handle_new_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  claim_email text := new.identity_data->>'email';
  claim_name  text := coalesce(
    new.identity_data->>'name',
    new.identity_data->>'full_name',
    split_part(coalesce(new.identity_data->>'email', ''), '@', 1)
  );
  claim_oid   text := coalesce(new.identity_data->>'oid', new.identity_data->>'sub');
begin
  if new.provider <> 'azure' then
    return new;
  end if;

  if claim_email is null or claim_email !~* '^[^@]+@utrgv\.edu$' then
    raise exception 'Only @utrgv.edu accounts may sign in to TeamUp';
  end if;

  if claim_oid is null then
    raise exception 'Microsoft did not return an account identifier';
  end if;

  insert into public.users (id, email, microsoft_oid, name)
  values (new.user_id, claim_email, claim_oid, claim_name)
  on conflict (id) do update
    set email = excluded.email,
        microsoft_oid = excluded.microsoft_oid,
        name = excluded.name;

  return new;
end;
$$;

drop trigger if exists on_auth_identity_created on auth.identities;
create trigger on_auth_identity_created
  after insert on auth.identities
  for each row execute function public.handle_new_identity();
