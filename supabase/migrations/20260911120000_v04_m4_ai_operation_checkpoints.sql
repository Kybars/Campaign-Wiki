-- v0.4 M4: private, provider-aware durable checkpoints for validated AI operations.
create table public.ai_operation_checkpoints (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  source_extraction_cache_id uuid references public.extraction_cache_runs(id) on delete set null,
  provider_id text not null,
  model_id text not null,
  processing_mode text not null,
  stage text not null check (stage in ('extraction', 'reconciliation', 'enrichment')),
  operation_type text not null,
  operation_key text not null,
  input_hash text not null check (length(input_hash) = 64),
  upstream_fingerprint text not null,
  behavior_version text not null,
  schema_version integer not null check (schema_version > 0),
  status text not null check (status in ('failed', 'validated')),
  validated_output jsonb,
  usage_diagnostics jsonb not null default '[]'::jsonb,
  error_message text,
  attempt_count integer not null default 1 check (attempt_count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ai_operation_checkpoint_validated_output check (
    (status = 'validated' and validated_output is not null and completed_at is not null and error_message is null)
    or (status = 'failed' and validated_output is null)
  ),
  unique (campaign_id, document_id, provider_id, model_id, processing_mode, stage,
    operation_type, operation_key, input_hash, upstream_fingerprint, behavior_version, schema_version)
);

create index ai_operation_checkpoints_lookup_idx on public.ai_operation_checkpoints
  (campaign_id, document_id, stage, operation_type, operation_key, status);
create index ai_operation_checkpoints_source_idx on public.ai_operation_checkpoints
  (source_extraction_cache_id) where source_extraction_cache_id is not null;

alter table public.ai_operation_checkpoints enable row level security;
grant select, insert, update, delete on table public.ai_operation_checkpoints to service_role;
revoke all privileges on table public.ai_operation_checkpoints from anon, authenticated;
