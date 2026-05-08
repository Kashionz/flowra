-- supabase/migrations/20260508120000_flowra_ai_usage_log.sql
-- Daily per-user counter for AI scenario calls.
-- Used by ai-scenario edge function to enforce 20 req/user/day quota.

create table if not exists public.ai_usage_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, day)
);

create index if not exists ai_usage_log_day_idx on public.ai_usage_log(day desc);

alter table public.ai_usage_log enable row level security;

-- Users can read their own usage; only the service role writes.
create policy "ai_usage_log_select_own"
  on public.ai_usage_log
  for select
  using (auth.uid() = user_id);

-- No insert/update/delete policies for end users — Edge Function uses service role.
