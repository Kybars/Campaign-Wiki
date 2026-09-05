-- Supabase projects do not all share the same default table privileges.
-- RLS bypass and SQL grants are separate checks: the server role needs both
-- BYPASSRLS (provided by Supabase) and explicit privileges on these tables.

grant usage on schema public to service_role;

grant select, insert, update, delete on table
  public.campaigns,
  public.documents,
  public.document_pages,
  public.entities,
  public.entity_sources,
  public.relationships,
  public.relationship_sources,
  public.processing_runs
to service_role;

-- v0 deliberately exposes no direct browser database access.
revoke all privileges on table
  public.campaigns,
  public.documents,
  public.document_pages,
  public.entities,
  public.entity_sources,
  public.relationships,
  public.relationship_sources,
  public.processing_runs
from anon, authenticated;

grant execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb)
to service_role;

revoke execute on function public.replace_campaign_graph(uuid, uuid, jsonb, jsonb)
from anon, authenticated;
