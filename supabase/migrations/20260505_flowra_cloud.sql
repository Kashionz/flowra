create extension if not exists pgcrypto;

create table if not exists public.flowra_scenarios (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text not null default '',
  base_month text not null,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.flowra_share_links (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  owner_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null,
  readonly boolean not null default true,
  expires_at timestamptz not null,
  view_count integer not null default 0,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists flowra_scenarios_user_id_idx on public.flowra_scenarios(user_id);
create index if not exists flowra_share_links_slug_idx on public.flowra_share_links(slug);
create index if not exists flowra_share_links_expires_at_idx on public.flowra_share_links(expires_at);

alter table public.flowra_scenarios enable row level security;
alter table public.flowra_share_links enable row level security;

drop policy if exists "Users can read own flowra scenarios" on public.flowra_scenarios;
create policy "Users can read own flowra scenarios"
on public.flowra_scenarios
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert own flowra scenarios" on public.flowra_scenarios;
create policy "Users can insert own flowra scenarios"
on public.flowra_scenarios
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own flowra scenarios" on public.flowra_scenarios;
create policy "Users can update own flowra scenarios"
on public.flowra_scenarios
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete own flowra scenarios" on public.flowra_scenarios;
create policy "Users can delete own flowra scenarios"
on public.flowra_scenarios
for delete
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Anyone can read active share links" on public.flowra_share_links;
create policy "Anyone can read active share links"
on public.flowra_share_links
for select
to anon, authenticated
using (expires_at > timezone('utc', now()));

drop policy if exists "Authenticated users can insert share links" on public.flowra_share_links;
create policy "Authenticated users can insert share links"
on public.flowra_share_links
for insert
to authenticated
with check (((select auth.uid()) = owner_user_id) or owner_user_id is null);

drop policy if exists "Owners can update share links" on public.flowra_share_links;
create policy "Owners can update share links"
on public.flowra_share_links
for update
to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

drop policy if exists "Owners can delete share links" on public.flowra_share_links;
create policy "Owners can delete share links"
on public.flowra_share_links
for delete
to authenticated
using ((select auth.uid()) = owner_user_id);
