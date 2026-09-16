-- v0.5: replay-safe GM curation. Effective values stay in their existing typed
-- columns; explicit flags distinguish imported defaults from manual decisions.
create type public.quest_status as enum ('ongoing', 'not_started', 'finished');

alter table public.entities
  add column type_is_manual boolean not null default false,
  add column prominence_is_manual boolean not null default false,
  add column visibility_is_manual boolean not null default false,
  add column quest_status public.quest_status,
  add column quest_status_is_manual boolean not null default false;

alter table public.relationships
  add column visibility_is_manual boolean not null default false;

alter function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb)
  rename to replace_campaign_graph_import_v04;

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
  result jsonb;
  entity_override jsonb;
  relationship_override jsonb;
  entity_overrides jsonb;
  relationship_overrides jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'type', type,
    'prominence', prominence,
    'visibility', visibility,
    'quest_status', quest_status,
    'type_is_manual', type_is_manual,
    'prominence_is_manual', prominence_is_manual,
    'visibility_is_manual', visibility_is_manual,
    'quest_status_is_manual', quest_status_is_manual
  )), '[]'::jsonb) into entity_overrides
  from public.entities
  where campaign_id = p_campaign_id
    and (type_is_manual or prominence_is_manual or visibility_is_manual or quest_status_is_manual);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'visibility', visibility,
    'visibility_is_manual', visibility_is_manual
  )), '[]'::jsonb) into relationship_overrides
  from public.relationships
  where campaign_id = p_campaign_id and visibility_is_manual;

  result := public.replace_campaign_graph_import_v04(
    p_campaign_id, p_document_id, p_entities, p_relationships, p_facts
  );

  for entity_override in select value from jsonb_array_elements(entity_overrides)
  loop
    update public.entities set
      type = case when (entity_override->>'type_is_manual')::boolean then (entity_override->>'type')::public.entity_type else type end,
      prominence = case when (entity_override->>'prominence_is_manual')::boolean then (entity_override->>'prominence')::public.entity_prominence else prominence end,
      visibility = case when (entity_override->>'visibility_is_manual')::boolean then (entity_override->>'visibility')::public.knowledge_visibility else visibility end,
      quest_status = case when (entity_override->>'quest_status_is_manual')::boolean then (entity_override->>'quest_status')::public.quest_status else quest_status end,
      type_is_manual = (entity_override->>'type_is_manual')::boolean,
      prominence_is_manual = (entity_override->>'prominence_is_manual')::boolean,
      visibility_is_manual = (entity_override->>'visibility_is_manual')::boolean,
      quest_status_is_manual = (entity_override->>'quest_status_is_manual')::boolean
    where id = (entity_override->>'id')::uuid and campaign_id = p_campaign_id;
  end loop;

  for relationship_override in select value from jsonb_array_elements(relationship_overrides)
  loop
    update public.relationships set
      visibility = (relationship_override->>'visibility')::public.knowledge_visibility,
      visibility_is_manual = true
    where id = (relationship_override->>'id')::uuid and campaign_id = p_campaign_id;
  end loop;

  return result;
end;
$$;

revoke all on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb, jsonb) from anon, authenticated;
