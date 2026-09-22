alter table public.campaigns
  add column if not exists processing_progress jsonb not null default '{}'::jsonb;
