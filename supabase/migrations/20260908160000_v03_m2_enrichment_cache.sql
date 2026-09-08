-- v0.3 Milestone 2: deterministic enrichment replay and campaign overview persistence.
create table public.enrichment_cache_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  extraction_cache_run_id uuid references public.extraction_cache_runs(id) on delete set null,
  status text not null check (status in ('started', 'complete', 'failed')),
  enrichment_model text not null,
  cache_schema_version integer not null,
  prompt_version text not null,
  graph_fingerprint text not null,
  output jsonb,
  usage_diagnostics jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index enrichment_cache_complete_identity_idx
  on public.enrichment_cache_runs(campaign_id, document_id, graph_fingerprint, cache_schema_version, prompt_version, enrichment_model)
  where status = 'complete';
create index enrichment_cache_campaign_created_idx on public.enrichment_cache_runs(campaign_id, created_at desc);

alter table public.enrichment_cache_runs enable row level security;
grant select, insert, update, delete on table public.enrichment_cache_runs to service_role;
revoke all privileges on table public.enrichment_cache_runs from anon, authenticated;

create function public.persist_campaign_overviews(
  p_campaign_id uuid,
  p_document_id uuid,
  p_gm_overview text,
  p_player_overview text,
  p_gm_sources jsonb default '[]'::jsonb,
  p_player_sources jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  source_record jsonb;
begin
  if not exists (select 1 from public.documents where id = p_document_id and campaign_id = p_campaign_id) then
    raise exception 'Document does not belong to campaign';
  end if;
  update public.campaigns set gm_overview = p_gm_overview, player_overview = p_player_overview where id = p_campaign_id;
  delete from public.campaign_overview_evidence where campaign_id = p_campaign_id and origin = 'document' and document_id = p_document_id;
  for source_record in select value from jsonb_array_elements(coalesce(p_gm_sources, '[]'::jsonb)) loop
    insert into public.campaign_overview_evidence(campaign_id, summary_kind, origin, document_id, page_number, supporting_text)
    values (p_campaign_id, 'gm', 'document', p_document_id, (source_record->>'page_number')::integer, source_record->>'supporting_text');
  end loop;
  for source_record in select value from jsonb_array_elements(coalesce(p_player_sources, '[]'::jsonb)) loop
    insert into public.campaign_overview_evidence(campaign_id, summary_kind, origin, document_id, page_number, supporting_text)
    values (p_campaign_id, 'player', 'document', p_document_id, (source_record->>'page_number')::integer, source_record->>'supporting_text');
  end loop;
end;
$$;

revoke all on function public.persist_campaign_overviews(uuid, uuid, text, text, jsonb, jsonb) from public;
grant execute on function public.persist_campaign_overviews(uuid, uuid, text, text, jsonb, jsonb) to service_role;
revoke execute on function public.persist_campaign_overviews(uuid, uuid, text, text, jsonb, jsonb) from anon, authenticated;

create function public.replace_campaign_graph_with_enrichment(
  p_campaign_id uuid,
  p_document_id uuid,
  p_entities jsonb,
  p_relationships jsonb,
  p_facts jsonb,
  p_campaign_overview jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  result := public.replace_campaign_graph(p_campaign_id, p_document_id, p_entities, p_relationships, p_facts);
  perform public.persist_campaign_overviews(
    p_campaign_id,
    p_document_id,
    p_campaign_overview->>'gm',
    p_campaign_overview->>'player',
    coalesce(p_campaign_overview->'gmSources', '[]'::jsonb),
    coalesce(p_campaign_overview->'playerSources', '[]'::jsonb)
  );
  return result;
end;
$$;

revoke all on function public.replace_campaign_graph_with_enrichment(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.replace_campaign_graph_with_enrichment(uuid, uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.replace_campaign_graph_with_enrichment(uuid, uuid, jsonb, jsonb, jsonb, jsonb) from anon, authenticated;
