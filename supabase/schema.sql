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
