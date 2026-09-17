-- Persist inspectable deterministic source-frequency metrics. Automatic values
-- are refreshed on every graph replacement; the v0.5 wrapper still restores
-- explicitly manual prominence and quest-status choices afterward.
alter table public.entities
  add column source_mention_count integer not null default 0 check (source_mention_count >= 0),
  add column source_mention_page_count integer not null default 0 check (source_mention_page_count >= 0);

alter function public.replace_campaign_graph_import_v04(uuid, uuid, jsonb, jsonb, jsonb)
  rename to replace_campaign_graph_import_v05_base;

create function public.replace_campaign_graph_import_v04(
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
  entity_record jsonb;
  generated_id uuid;
begin
  result := public.replace_campaign_graph_import_v05_base(
    p_campaign_id, p_document_id, p_entities, p_relationships, p_facts
  );

  for entity_record in select value from jsonb_array_elements(p_entities)
  loop
    generated_id := (result->'entity_id_map'->>(entity_record->>'key'))::uuid;
    update public.entities set
      source_mention_count = coalesce((entity_record->>'sourceMentionCount')::integer, 0),
      source_mention_page_count = coalesce((entity_record->>'sourceMentionPageCount')::integer, 0),
      quest_status = case
        when entity_record ? 'questStatus' then (entity_record->>'questStatus')::public.quest_status
        else quest_status
      end
    where id = generated_id and campaign_id = p_campaign_id;
  end loop;

  return result;
end;
$$;

revoke all on function public.replace_campaign_graph_import_v04(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.replace_campaign_graph_import_v04(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.replace_campaign_graph_import_v04(uuid, uuid, jsonb, jsonb, jsonb) from anon, authenticated;

revoke all on function public.replace_campaign_graph_import_v05_base(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant execute on function public.replace_campaign_graph_import_v05_base(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
revoke execute on function public.replace_campaign_graph_import_v05_base(uuid, uuid, jsonb, jsonb, jsonb) from anon, authenticated;
