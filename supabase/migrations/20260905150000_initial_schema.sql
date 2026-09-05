create extension if not exists pgcrypto;

create type public.campaign_status as enum (
  'uploaded',
  'extracting_pages',
  'extracting_candidates',
  'reconciling',
  'persisting',
  'complete',
  'failed'
);

create type public.entity_type as enum (
  'npc', 'location', 'faction', 'item', 'event', 'quest', 'other'
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 200),
  status public.campaign_status not null default 'uploaded',
  error_message text,
  processing_stage text,
  processing_diagnostics jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  filename text not null,
  storage_path text not null unique,
  page_count integer check (page_count is null or page_count > 0),
  created_at timestamptz not null default now()
);

create unique index one_document_per_campaign on public.documents(campaign_id);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  text text not null,
  created_at timestamptz not null default now(),
  unique(document_id, page_number)
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  name text not null,
  normalized_name text not null,
  type public.entity_type not null,
  aliases text[] not null default '{}',
  summary text not null default '',
  reconciliation_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id, normalized_name, type)
);

create table public.entity_sources (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  supporting_text text not null,
  created_at timestamptz not null default now(),
  foreign key (document_id, page_number) references public.document_pages(document_id, page_number) on delete cascade,
  unique(entity_id, document_id, page_number, supporting_text)
);

create table public.relationships (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  source_entity_id uuid not null references public.entities(id) on delete cascade,
  target_entity_id uuid not null references public.entities(id) on delete cascade,
  relationship_type text not null,
  description text not null,
  confidence real not null check (confidence >= 0 and confidence <= 1),
  resolution_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_entity_id <> target_entity_id)
);

create unique index relationships_semantic_unique on public.relationships(
  campaign_id,
  source_entity_id,
  target_entity_id,
  lower(relationship_type)
);

create table public.relationship_sources (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.relationships(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number integer not null check (page_number > 0),
  supporting_text text not null,
  created_at timestamptz not null default now(),
  foreign key (document_id, page_number) references public.document_pages(document_id, page_number) on delete cascade,
  unique(relationship_id, document_id, page_number, supporting_text)
);

create table public.processing_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  stage text not null,
  status text not null check (status in ('started', 'complete', 'failed')),
  input_metadata jsonb not null default '{}'::jsonb,
  output_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index entities_campaign_type_idx on public.entities(campaign_id, type);
create index entities_campaign_name_idx on public.entities(campaign_id, normalized_name);
create index entity_sources_entity_idx on public.entity_sources(entity_id);
create index relationships_source_idx on public.relationships(source_entity_id);
create index relationships_target_idx on public.relationships(target_entity_id);
create index relationship_sources_relationship_idx on public.relationship_sources(relationship_id);
create index processing_runs_campaign_idx on public.processing_runs(campaign_id, created_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger campaigns_touch_updated_at before update on public.campaigns
for each row execute function public.touch_updated_at();
create trigger entities_touch_updated_at before update on public.entities
for each row execute function public.touch_updated_at();
create trigger relationships_touch_updated_at before update on public.relationships
for each row execute function public.touch_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campaign-pdfs', 'campaign-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.campaigns enable row level security;
alter table public.documents enable row level security;
alter table public.document_pages enable row level security;
alter table public.entities enable row level security;
alter table public.entity_sources enable row level security;
alter table public.relationships enable row level security;
alter table public.relationship_sources enable row level security;
alter table public.processing_runs enable row level security;

-- v0 has no browser database access. All reads and writes go through server-only
-- code using the service role. RLS therefore intentionally has no public policies.
