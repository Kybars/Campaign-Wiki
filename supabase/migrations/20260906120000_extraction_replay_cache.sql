create table public.extraction_cache_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  status text not null check (status in ('started', 'complete', 'failed')),
  extraction_model text not null,
  cache_schema_version integer not null default 1 check (cache_schema_version > 0),
  chunking_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.extraction_cache_chunks (
  id uuid primary key default gen_random_uuid(),
  cache_run_id uuid not null references public.extraction_cache_runs(id) on delete cascade,
  chunk_id text not null,
  chunk_index integer not null check (chunk_index >= 0),
  page_numbers integer[] not null,
  raw_output jsonb not null,
  validated_output jsonb not null,
  validation_diagnostics jsonb not null default '[]'::jsonb,
  model text not null,
  response_id text,
  input_tokens integer,
  cached_input_tokens integer,
  cache_write_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric(14, 8),
  created_at timestamptz not null default now(),
  unique(cache_run_id, chunk_id),
  unique(cache_run_id, chunk_index)
);

create table public.reconciliation_cache_results (
  id uuid primary key default gen_random_uuid(),
  cache_run_id uuid not null references public.extraction_cache_runs(id) on delete cascade,
  decision jsonb,
  model text,
  response_id text,
  input_tokens integer,
  cached_input_tokens integer,
  cache_write_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_usd numeric(14, 8),
  created_at timestamptz not null default now()
);

create index extraction_cache_runs_campaign_idx
  on public.extraction_cache_runs(campaign_id, created_at desc);
create index extraction_cache_chunks_run_idx
  on public.extraction_cache_chunks(cache_run_id, chunk_index);
create index reconciliation_cache_results_run_idx
  on public.reconciliation_cache_results(cache_run_id, created_at desc);

alter table public.extraction_cache_runs enable row level security;
alter table public.extraction_cache_chunks enable row level security;
alter table public.reconciliation_cache_results enable row level security;

grant select, insert, update, delete on table
  public.extraction_cache_runs,
  public.extraction_cache_chunks,
  public.reconciliation_cache_results
to service_role;

revoke all privileges on table
  public.extraction_cache_runs,
  public.extraction_cache_chunks,
  public.reconciliation_cache_results
from anon, authenticated;
