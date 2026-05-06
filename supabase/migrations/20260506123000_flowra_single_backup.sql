create table if not exists public.flowra_backups (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists flowra_backups_updated_at_idx on public.flowra_backups(updated_at desc);

do $$
begin
  if to_regclass('public.flowra_scenarios') is not null then
    insert into public.flowra_backups (user_id, payload, created_at, updated_at)
    select distinct on (user_id)
      user_id,
      payload,
      created_at,
      updated_at
    from public.flowra_scenarios
    where user_id is not null
    order by user_id, updated_at desc, created_at desc
    on conflict (user_id) do update
    set
      payload = excluded.payload,
      updated_at = excluded.updated_at;
  end if;
end
$$;

alter table public.flowra_backups enable row level security;

drop policy if exists "Users can read own flowra backups" on public.flowra_backups;
create policy "Users can read own flowra backups"
on public.flowra_backups
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own flowra backups" on public.flowra_backups;
create policy "Users can insert own flowra backups"
on public.flowra_backups
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own flowra backups" on public.flowra_backups;
create policy "Users can update own flowra backups"
on public.flowra_backups
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own flowra backups" on public.flowra_backups;
create policy "Users can delete own flowra backups"
on public.flowra_backups
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop function if exists public.increment_flowra_share_view_count(text);
drop table if exists public.flowra_share_links;
drop table if exists public.flowra_scenarios;
