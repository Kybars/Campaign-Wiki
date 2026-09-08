create type public.knowledge_visibility as enum ('dm_only', 'player_visible');
create type public.entity_prominence as enum ('major', 'supporting', 'minor');
create type public.provenance_origin as enum ('document', 'manual', 'session');
create type public.knowledge_summary_kind as enum ('gm', 'player');

alter table public.campaigns
  add column gm_overview text,
  add column player_overview text;

alter table public.entities
  add column visibility public.knowledge_visibility not null default 'dm_only',
  add column prominence public.entity_prominence,
  add column prominence_reason text,
  add column gm_summary text,
  add column player_summary text;

update public.entities set gm_summary = summary;

alter table public.relationships
  add column visibility public.knowledge_visibility not null default 'dm_only',
  add column origin public.provenance_origin not null default 'document';

-- Existing source tables continue to represent entity existence and relationship
-- evidence. Their origin columns allow later manual/session evidence without a
-- polymorphic target table or a document/page fiction.
alter table public.entity_sources
  add column origin public.provenance_origin not null default 'document',
  add column source_location jsonb not null default '{}'::jsonb,
  add column origin_metadata jsonb not null default '{}'::jsonb,
  alter column document_id drop not null,
  alter column page_number drop not null,
  alter column supporting_text drop not null,
  add constraint entity_sources_origin_shape check (
    (origin = 'document' and document_id is not null and page_number is not null and supporting_text is not null)
    or (origin <> 'document' and document_id is null and page_number is null)
  );

alter table public.relationship_sources
  add column origin public.provenance_origin not null default 'document',
  add column source_location jsonb not null default '{}'::jsonb,
  add column origin_metadata jsonb not null default '{}'::jsonb,
  alter column document_id drop not null,
  alter column page_number drop not null,
  alter column supporting_text drop not null,
  add constraint relationship_sources_origin_shape check (
    (origin = 'document' and document_id is not null and page_number is not null and supporting_text is not null)
    or (origin <> 'document' and document_id is null and page_number is null)
  );

create table public.entity_facts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  stable_key text not null check (char_length(trim(stable_key)) between 1 and 240),
  field_key text not null check (char_length(trim(field_key)) between 1 and 120),
  content text not null check (char_length(trim(content)) > 0),
  structured_value jsonb,
  visibility public.knowledge_visibility not null default 'dm_only',
  origin public.provenance_origin not null default 'document',
  sort_order integer not null default 0,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(entity_id, stable_key)
);

create table public.fact_evidence (
  id uuid primary key default gen_random_uuid(),
  fact_id uuid not null references public.entity_facts(id) on delete cascade,
  origin public.provenance_origin not null default 'document',
  document_id uuid references public.documents(id) on delete cascade,
  page_number integer check (page_number is null or page_number > 0),
  supporting_text text,
  source_location jsonb not null default '{}'::jsonb,
  origin_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (document_id, page_number) references public.document_pages(document_id, page_number) on delete cascade,
  check (
    (origin = 'document' and document_id is not null and page_number is not null and supporting_text is not null)
    or (origin <> 'document' and document_id is null and page_number is null)
  )
);

create unique index fact_evidence_document_unique
  on public.fact_evidence(fact_id, document_id, page_number, supporting_text)
  where origin = 'document';

create table public.entity_summary_evidence (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  summary_kind public.knowledge_summary_kind not null,
  origin public.provenance_origin not null default 'document',
  document_id uuid references public.documents(id) on delete cascade,
  page_number integer check (page_number is null or page_number > 0),
  supporting_text text,
  source_location jsonb not null default '{}'::jsonb,
  origin_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (document_id, page_number) references public.document_pages(document_id, page_number) on delete cascade,
  check (
    (origin = 'document' and document_id is not null and page_number is not null and supporting_text is not null)
    or (origin <> 'document' and document_id is null and page_number is null)
  )
);

create unique index entity_summary_evidence_document_unique
  on public.entity_summary_evidence(entity_id, summary_kind, document_id, page_number, supporting_text)
  where origin = 'document';

create table public.campaign_overview_evidence (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  summary_kind public.knowledge_summary_kind not null,
  origin public.provenance_origin not null default 'document',
  document_id uuid references public.documents(id) on delete cascade,
  page_number integer check (page_number is null or page_number > 0),
  supporting_text text,
  source_location jsonb not null default '{}'::jsonb,
  origin_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (document_id, page_number) references public.document_pages(document_id, page_number) on delete cascade,
  check (
    (origin = 'document' and document_id is not null and page_number is not null and supporting_text is not null)
    or (origin <> 'document' and document_id is null and page_number is null)
  )
);

create unique index campaign_overview_evidence_document_unique
  on public.campaign_overview_evidence(campaign_id, summary_kind, document_id, page_number, supporting_text)
  where origin = 'document';

insert into public.entity_summary_evidence (
  entity_id, summary_kind, origin, document_id, page_number, supporting_text, source_location, origin_metadata
)
select entity_id, 'gm', origin, document_id, page_number, supporting_text, source_location, origin_metadata
from public.entity_sources;

create index entity_facts_entity_field_order_idx
  on public.entity_facts(entity_id, field_key, sort_order, id);
create index fact_evidence_fact_idx on public.fact_evidence(fact_id);
create index entity_summary_evidence_entity_idx on public.entity_summary_evidence(entity_id, summary_kind);
create index campaign_overview_evidence_campaign_idx on public.campaign_overview_evidence(campaign_id, summary_kind);
create index entities_campaign_visibility_idx on public.entities(campaign_id, visibility);
create index entities_campaign_prominence_idx on public.entities(campaign_id, prominence);
create index relationships_campaign_visibility_idx on public.relationships(campaign_id, visibility);

create trigger entity_facts_touch_updated_at before update on public.entity_facts
for each row execute function public.touch_updated_at();

alter table public.entity_facts enable row level security;
alter table public.fact_evidence enable row level security;
alter table public.entity_summary_evidence enable row level security;
alter table public.campaign_overview_evidence enable row level security;

grant select, insert, update, delete on table
  public.entity_facts,
  public.fact_evidence,
  public.entity_summary_evidence,
  public.campaign_overview_evidence
to service_role;

revoke all privileges on table
  public.entity_facts,
  public.fact_evidence,
  public.entity_summary_evidence,
  public.campaign_overview_evidence
from anon, authenticated;

drop function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb);

create function public.replace_campaign_graph(
  p_campaign_id uuid,
  p_document_id uuid,
  p_entities jsonb,
  p_relationships jsonb,
  p_facts jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entity_record jsonb;
  source_record jsonb;
  relationship_record jsonb;
  fact_record jsonb;
  evidence_record jsonb;
  generated_id uuid;
  generated_relationship_id uuid;
  generated_fact_id uuid;
  entity_id_map jsonb := '{}'::jsonb;
  retained_entity_ids uuid[] := '{}'::uuid[];
  retained_relationship_ids uuid[] := '{}'::uuid[];
  retained_fact_ids uuid[] := '{}'::uuid[];
  entity_count integer := 0;
  relationship_count integer := 0;
  fact_count integer := 0;
begin
  if not exists (
    select 1 from public.documents
    where id = p_document_id and campaign_id = p_campaign_id
  ) then
    raise exception 'Document does not belong to campaign';
  end if;

  for entity_record in select value from jsonb_array_elements(p_entities)
  loop
    generated_id := null;
    if entity_record ? 'id' then
      select id into generated_id from public.entities
      where id = (entity_record->>'id')::uuid and campaign_id = p_campaign_id;
    end if;
    if generated_id is null then
      select id into generated_id from public.entities
      where campaign_id = p_campaign_id
        and normalized_name = entity_record->>'normalizedName'
        and type = (entity_record->>'type')::public.entity_type;
    end if;
    if generated_id is null then
      select existing.id into generated_id
      from public.entities existing
      where existing.campaign_id = p_campaign_id
        and exists (
          select 1
          from jsonb_array_elements_text(coalesce(existing.reconciliation_metadata->'candidateIds', '[]'::jsonb)) old_candidate(id)
          join jsonb_array_elements_text(coalesce(entity_record->'metadata'->'candidateIds', '[]'::jsonb)) new_candidate(id)
            on new_candidate.id = old_candidate.id
        )
      order by existing.created_at
      limit 1;
    end if;

    if generated_id is null then
      generated_id := gen_random_uuid();
      insert into public.entities (
        id, campaign_id, name, normalized_name, type, roles, aliases, summary,
        gm_summary, player_summary, visibility, prominence, prominence_reason,
        reconciliation_metadata
      ) values (
        generated_id,
        p_campaign_id,
        entity_record->>'name',
        entity_record->>'normalizedName',
        (entity_record->>'type')::public.entity_type,
        array(select jsonb_array_elements_text(coalesce(entity_record->'roles', '[]'::jsonb))),
        array(select jsonb_array_elements_text(coalesce(entity_record->'aliases', '[]'::jsonb))),
        coalesce(entity_record->>'summary', ''),
        coalesce(entity_record->>'gmSummary', entity_record->>'summary', ''),
        entity_record->>'playerSummary',
        coalesce((entity_record->>'visibility')::public.knowledge_visibility, 'dm_only'),
        (entity_record->>'prominence')::public.entity_prominence,
        entity_record->>'prominenceReason',
        coalesce(entity_record->'metadata', '{}'::jsonb)
      );
    else
      update public.entities set
        name = entity_record->>'name',
        normalized_name = entity_record->>'normalizedName',
        type = (entity_record->>'type')::public.entity_type,
        roles = array(select jsonb_array_elements_text(coalesce(entity_record->'roles', '[]'::jsonb))),
        aliases = array(select jsonb_array_elements_text(coalesce(entity_record->'aliases', '[]'::jsonb))),
        summary = coalesce(entity_record->>'summary', ''),
        gm_summary = case when entity_record ? 'gmSummary' then entity_record->>'gmSummary' else gm_summary end,
        player_summary = case when entity_record ? 'playerSummary' then entity_record->>'playerSummary' else player_summary end,
        visibility = case when entity_record ? 'visibility' then (entity_record->>'visibility')::public.knowledge_visibility else visibility end,
        prominence = case when entity_record ? 'prominence' then (entity_record->>'prominence')::public.entity_prominence else prominence end,
        prominence_reason = case when entity_record ? 'prominenceReason' then entity_record->>'prominenceReason' else prominence_reason end,
        reconciliation_metadata = coalesce(entity_record->'metadata', '{}'::jsonb)
      where id = generated_id;
    end if;

    retained_entity_ids := array_append(retained_entity_ids, generated_id);
    entity_id_map := entity_id_map || jsonb_build_object(entity_record->>'key', generated_id::text);

    delete from public.entity_sources
    where entity_id = generated_id and origin = 'document' and document_id = p_document_id;
    for source_record in select value from jsonb_array_elements(coalesce(entity_record->'sources', '[]'::jsonb))
    loop
      insert into public.entity_sources (
        entity_id, origin, document_id, page_number, supporting_text, source_location, origin_metadata
      ) values (
        generated_id, 'document', p_document_id,
        (source_record->>'page_number')::integer, source_record->>'supporting_text',
        coalesce(source_record->'source_location', '{}'::jsonb),
        coalesce(source_record->'origin_metadata', '{}'::jsonb)
      );
    end loop;

    delete from public.entity_summary_evidence
    where entity_id = generated_id and summary_kind = 'gm' and origin = 'document' and document_id = p_document_id;
    for source_record in select value from jsonb_array_elements(
      case when entity_record ? 'gmSummarySources' then coalesce(entity_record->'gmSummarySources', '[]'::jsonb)
      else coalesce(entity_record->'sources', '[]'::jsonb) end
    )
    loop
      insert into public.entity_summary_evidence (
        entity_id, summary_kind, origin, document_id, page_number, supporting_text, source_location, origin_metadata
      ) values (
        generated_id, 'gm', 'document', p_document_id,
        (source_record->>'page_number')::integer, source_record->>'supporting_text',
        coalesce(source_record->'source_location', '{}'::jsonb),
        coalesce(source_record->'origin_metadata', '{}'::jsonb)
      );
    end loop;
    if entity_record ? 'playerSummarySources' then
      delete from public.entity_summary_evidence
      where entity_id = generated_id and summary_kind = 'player' and origin = 'document' and document_id = p_document_id;
      for source_record in select value from jsonb_array_elements(coalesce(entity_record->'playerSummarySources', '[]'::jsonb))
      loop
        insert into public.entity_summary_evidence (
          entity_id, summary_kind, origin, document_id, page_number, supporting_text, source_location, origin_metadata
        ) values (
          generated_id, 'player', 'document', p_document_id,
          (source_record->>'page_number')::integer, source_record->>'supporting_text',
          coalesce(source_record->'source_location', '{}'::jsonb),
          coalesce(source_record->'origin_metadata', '{}'::jsonb)
        );
      end loop;
    end if;
    entity_count := entity_count + 1;
  end loop;

  for relationship_record in select value from jsonb_array_elements(p_relationships)
  loop
    if not (entity_id_map ? (relationship_record->>'sourceEntityKey'))
       or not (entity_id_map ? (relationship_record->>'targetEntityKey')) then
      raise exception 'Relationship endpoint is not canonical';
    end if;

    select id into generated_relationship_id from public.relationships
    where campaign_id = p_campaign_id
      and source_entity_id = (entity_id_map->>(relationship_record->>'sourceEntityKey'))::uuid
      and target_entity_id = (entity_id_map->>(relationship_record->>'targetEntityKey'))::uuid
      and lower(relationship_type) = lower(relationship_record->>'relationshipType');

    if generated_relationship_id is null then
      generated_relationship_id := gen_random_uuid();
      insert into public.relationships (
        id, campaign_id, source_entity_id, target_entity_id, relationship_type,
        description, confidence, visibility, origin, resolution_metadata
      ) values (
        generated_relationship_id,
        p_campaign_id,
        (entity_id_map->>(relationship_record->>'sourceEntityKey'))::uuid,
        (entity_id_map->>(relationship_record->>'targetEntityKey'))::uuid,
        relationship_record->>'relationshipType',
        relationship_record->>'description',
        (relationship_record->>'confidence')::real,
        coalesce((relationship_record->>'visibility')::public.knowledge_visibility, 'dm_only'),
        coalesce((relationship_record->>'origin')::public.provenance_origin, 'document'),
        coalesce(relationship_record->'metadata', '{}'::jsonb)
      );
    else
      update public.relationships set
        description = relationship_record->>'description',
        confidence = (relationship_record->>'confidence')::real,
        visibility = case when relationship_record ? 'visibility' then (relationship_record->>'visibility')::public.knowledge_visibility else visibility end,
        resolution_metadata = coalesce(relationship_record->'metadata', '{}'::jsonb)
      where id = generated_relationship_id;
    end if;

    retained_relationship_ids := array_append(retained_relationship_ids, generated_relationship_id);
    delete from public.relationship_sources
    where relationship_id = generated_relationship_id and origin = 'document' and document_id = p_document_id;
    for source_record in select value from jsonb_array_elements(coalesce(relationship_record->'sources', '[]'::jsonb))
    loop
      insert into public.relationship_sources (
        relationship_id, origin, document_id, page_number, supporting_text, source_location, origin_metadata
      ) values (
        generated_relationship_id, 'document', p_document_id,
        (source_record->>'page_number')::integer, source_record->>'supporting_text',
        coalesce(source_record->'source_location', '{}'::jsonb),
        coalesce(source_record->'origin_metadata', '{}'::jsonb)
      );
    end loop;
    relationship_count := relationship_count + 1;
  end loop;

  -- Facts are replaced by stable key only for the document-derived layer.
  -- Manually/session-authored facts survive deterministic graph replay.
  for fact_record in select value from jsonb_array_elements(coalesce(p_facts, '[]'::jsonb))
  loop
    if not (entity_id_map ? (fact_record->>'entityKey')) then
      raise exception 'Fact entity is not canonical';
    end if;
    select id into generated_fact_id from public.entity_facts
    where entity_id = (entity_id_map->>(fact_record->>'entityKey'))::uuid
      and stable_key = fact_record->>'stableKey';

    if generated_fact_id is null then
      generated_fact_id := gen_random_uuid();
      insert into public.entity_facts (
        id, entity_id, stable_key, field_key, content, structured_value,
        visibility, origin, sort_order, context
      ) values (
        generated_fact_id,
        (entity_id_map->>(fact_record->>'entityKey'))::uuid,
        fact_record->>'stableKey', fact_record->>'fieldKey', fact_record->>'content',
        fact_record->'structuredValue',
        coalesce((fact_record->>'visibility')::public.knowledge_visibility, 'dm_only'),
        coalesce((fact_record->>'origin')::public.provenance_origin, 'document'),
        coalesce((fact_record->>'sortOrder')::integer, 0),
        coalesce(fact_record->'context', '{}'::jsonb)
      );
    else
      update public.entity_facts set
        field_key = fact_record->>'fieldKey',
        content = fact_record->>'content',
        structured_value = fact_record->'structuredValue',
        visibility = case when fact_record ? 'visibility' then (fact_record->>'visibility')::public.knowledge_visibility else visibility end,
        sort_order = coalesce((fact_record->>'sortOrder')::integer, 0),
        context = coalesce(fact_record->'context', '{}'::jsonb)
      where id = generated_fact_id;
    end if;

    retained_fact_ids := array_append(retained_fact_ids, generated_fact_id);
    delete from public.fact_evidence
    where fact_id = generated_fact_id and origin = 'document' and document_id = p_document_id;
    for evidence_record in select value from jsonb_array_elements(coalesce(fact_record->'evidence', '[]'::jsonb))
    loop
      insert into public.fact_evidence (
        fact_id, origin, document_id, page_number, supporting_text, source_location, origin_metadata
      ) values (
        generated_fact_id,
        coalesce((evidence_record->>'origin')::public.provenance_origin, 'document'),
        case when coalesce(evidence_record->>'origin', 'document') = 'document' then p_document_id else null end,
        (evidence_record->>'pageNumber')::integer,
        evidence_record->>'supportingText',
        coalesce(evidence_record->'sourceLocation', '{}'::jsonb),
        coalesce(evidence_record->'originMetadata', '{}'::jsonb)
      );
    end loop;
    fact_count := fact_count + 1;
  end loop;

  delete from public.relationships
  where campaign_id = p_campaign_id
    and origin = 'document'
    and id <> all(retained_relationship_ids);

  delete from public.entity_facts
  where origin = 'document'
    and entity_id in (select id from public.entities where campaign_id = p_campaign_id)
    and id <> all(retained_fact_ids);

  delete from public.entities
  where campaign_id = p_campaign_id
    and id <> all(retained_entity_ids)
    and not exists (
      select 1 from public.entity_sources
      where entity_sources.entity_id = entities.id and entity_sources.origin <> 'document'
    )
    and not exists (
      select 1 from public.entity_facts
      where entity_facts.entity_id = entities.id and entity_facts.origin <> 'document'
    )
    and not exists (
      select 1 from public.relationships
      where relationships.origin <> 'document'
        and (relationships.source_entity_id = entities.id or relationships.target_entity_id = entities.id)
    );

  return jsonb_build_object(
    'entity_count', entity_count,
    'relationship_count', relationship_count,
    'fact_count', fact_count,
    'entity_id_map', entity_id_map
  );
end;
$$;

revoke all on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb) from anon, authenticated;
