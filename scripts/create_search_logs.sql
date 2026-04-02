-- Run this once in Supabase SQL editor to create the search_logs table.

create table if not exists search_logs (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        references auth.users(id) on delete cascade,
  session_id  text,
  locality    text        not null default '',
  filters     jsonb       not null default '{}'::jsonb,
  searched_at timestamptz not null default now()
);

-- Index for fast per-user locality count queries
create index if not exists search_logs_user_locality
  on search_logs (user_id, lower(locality));

-- RLS
alter table search_logs enable row level security;

create policy "Users can insert own logs"
  on search_logs for insert
  with check (auth.uid() = user_id or user_id is null);

create policy "Users can read own logs"
  on search_logs for select
  using (auth.uid() = user_id);
