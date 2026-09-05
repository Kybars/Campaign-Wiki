create or replace function public.replace_campaign_graph(
  p_campaign_id uuid,
  p_document_id uuid,
  p_entities jsonb,
  p_relationships jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  entity_record jsonb;
  source_record jsonb;
  relationship_record jsonb;
  generated_id uuid;
  generated_relationship_id uuid;
  entity_id_map jsonb := '{}'::jsonb;
  entity_count integer := 0;
  relationship_count integer := 0;
begin
  if not exists (
    select 1 from public.documents
    where id = p_document_id and campaign_id = p_campaign_id
  ) then
    raise exception 'Document does not belong to campaign';
  end if;

  delete from public.entities where campaign_id = p_campaign_id;

  for entity_record in select value from jsonb_array_elements(p_entities)
  loop
    generated_id := gen_random_uuid();
    insert into public.entities (
      id, campaign_id, name, normalized_name, type, aliases, summary, reconciliation_metadata
    ) values (
      generated_id,
      p_campaign_id,
      entity_record->>'name',
      entity_record->>'normalizedName',
      (entity_record->>'type')::public.entity_type,
      array(select jsonb_array_elements_text(coalesce(entity_record->'aliases', '[]'::jsonb))),
      coalesce(entity_record->>'summary', ''),
      coalesce(entity_record->'metadata', '{}'::jsonb)
    );
    entity_id_map := entity_id_map || jsonb_build_object(entity_record->>'key', generated_id::text);

    for source_record in select value from jsonb_array_elements(coalesce(entity_record->'sources', '[]'::jsonb))
    loop
      insert into public.entity_sources (entity_id, document_id, page_number, supporting_text)
      values (generated_id, p_document_id, (source_record->>'page_number')::integer, source_record->>'supporting_text');
    end loop;
    entity_count := entity_count + 1;
  end loop;

  for relationship_record in select value from jsonb_array_elements(p_relationships)
  loop
    if not (entity_id_map ? (relationship_record->>'sourceEntityKey'))
       or not (entity_id_map ? (relationship_record->>'targetEntityKey')) then
      raise exception 'Relationship endpoint is not canonical';
    end if;
    generated_relationship_id := gen_random_uuid();
    insert into public.relationships (
      id, campaign_id, source_entity_id, target_entity_id, relationship_type,
      description, confidence, resolution_metadata
    ) values (
      generated_relationship_id,
      p_campaign_id,
      (entity_id_map->>(relationship_record->>'sourceEntityKey'))::uuid,
      (entity_id_map->>(relationship_record->>'targetEntityKey'))::uuid,
      relationship_record->>'relationshipType',
      relationship_record->>'description',
      (relationship_record->>'confidence')::real,
      coalesce(relationship_record->'metadata', '{}'::jsonb)
    );

    for source_record in select value from jsonb_array_elements(coalesce(relationship_record->'sources', '[]'::jsonb))
    loop
      insert into public.relationship_sources (relationship_id, document_id, page_number, supporting_text)
      values (generated_relationship_id, p_document_id, (source_record->>'page_number')::integer, source_record->>'supporting_text');
    end loop;
    relationship_count := relationship_count + 1;
  end loop;

  return jsonb_build_object(
    'entity_count', entity_count,
    'relationship_count', relationship_count,
    'entity_id_map', entity_id_map
  );
end;
$$;

revoke all on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb) from public;
grant execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb) to service_role;
