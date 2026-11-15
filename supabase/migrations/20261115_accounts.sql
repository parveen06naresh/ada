-- Ada accounts, Nov 2026: let a signed-in person delete their own account (login and data).
-- Safe to run more than once. Paste into Supabase > SQL Editor > Run.
create or replace function public.ada_delete_account() returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  delete from auth.users where id = auth.uid();  -- user_state goes with it (on delete cascade)
end;
$$;
revoke all on function public.ada_delete_account() from public, anon;
grant execute on function public.ada_delete_account() to authenticated;
