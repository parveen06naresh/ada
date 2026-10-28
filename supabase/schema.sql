-- Ada optional sync: one row per signed-in person, readable and writable only by that person.
create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 200000),
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

create policy "read own state" on public.user_state for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own state" on public.user_state for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "update own state" on public.user_state for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "delete own state" on public.user_state for delete to authenticated using ((select auth.uid()) = user_id);

-- Weekly email alerts: one-click unsubscribe from the link in each email, no sign-in needed.
-- The token is a random id the browser stores in the profile when alerts are turned on.
create or replace function public.ada_unsubscribe(token text) returns boolean
language sql security definer set search_path = public as $$
  with hit as (
    update public.user_state
       set data = jsonb_set(jsonb_set(data, '{profile,alerts}', 'false'), '{updated}',
                            to_jsonb((extract(epoch from now()) * 1000)::bigint)),
           updated_at = now()
     where length(token) >= 20 and data->'profile'->>'alertToken' = token
    returning 1)
  select exists (select 1 from hit);
$$;
revoke all on function public.ada_unsubscribe(text) from public;
grant execute on function public.ada_unsubscribe(text) to anon, authenticated;
