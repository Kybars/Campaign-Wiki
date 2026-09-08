import type {
  EntityProminence,
  KnowledgeSummaryKind,
  KnowledgeVisibility,
  ProvenanceOrigin,
} from "@/lib/knowledge/types";

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];
export type CampaignStatus =
  | "uploaded"
  | "extracting_pages"
  | "extracting_candidates"
  | "reconciling"
  | "persisting"
  | "complete"
  | "failed";
export type EntityType = "npc" | "deity" | "location" | "faction" | "item" | "event" | "quest" | "other";
export type EntityRole = "enemy";

type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export interface Database {
  public: {
    Tables: {
      campaigns: Table<
        { id: string; name: string; status: CampaignStatus; error_message: string | null; processing_stage: string | null; processing_diagnostics: Json; gm_overview: string | null; player_overview: string | null; created_at: string; updated_at: string },
        { id?: string; name: string; status?: CampaignStatus; error_message?: string | null; processing_stage?: string | null; processing_diagnostics?: Json; gm_overview?: string | null; player_overview?: string | null }
      >;
      documents: Table<
        { id: string; campaign_id: string; filename: string; storage_path: string; page_count: number | null; created_at: string },
        { id?: string; campaign_id: string; filename: string; storage_path: string; page_count?: number | null }
      >;
      document_pages: Table<
        { id: string; document_id: string; page_number: number; text: string; created_at: string },
        { id?: string; document_id: string; page_number: number; text: string }
      >;
      entities: Table<
        { id: string; campaign_id: string; name: string; normalized_name: string; type: EntityType; roles: EntityRole[]; aliases: string[]; summary: string; gm_summary: string | null; player_summary: string | null; visibility: KnowledgeVisibility; prominence: EntityProminence | null; prominence_reason: string | null; reconciliation_metadata: Json; created_at: string; updated_at: string },
        { id?: string; campaign_id: string; name: string; normalized_name: string; type: EntityType; roles?: EntityRole[]; aliases?: string[]; summary?: string; gm_summary?: string | null; player_summary?: string | null; visibility?: KnowledgeVisibility; prominence?: EntityProminence | null; prominence_reason?: string | null; reconciliation_metadata?: Json }
      >;
      entity_sources: Table<
        { id: string; entity_id: string; origin: ProvenanceOrigin; document_id: string | null; page_number: number | null; supporting_text: string | null; source_location: Json; origin_metadata: Json; created_at: string },
        { id?: string; entity_id: string; origin?: ProvenanceOrigin; document_id?: string | null; page_number?: number | null; supporting_text?: string | null; source_location?: Json; origin_metadata?: Json }
      >;
      relationships: Table<
        { id: string; campaign_id: string; source_entity_id: string; target_entity_id: string; relationship_type: string; description: string; confidence: number; visibility: KnowledgeVisibility; origin: ProvenanceOrigin; resolution_metadata: Json; created_at: string; updated_at: string },
        { id?: string; campaign_id: string; source_entity_id: string; target_entity_id: string; relationship_type: string; description: string; confidence: number; visibility?: KnowledgeVisibility; origin?: ProvenanceOrigin; resolution_metadata?: Json }
      >;
      relationship_sources: Table<
        { id: string; relationship_id: string; origin: ProvenanceOrigin; document_id: string | null; page_number: number | null; supporting_text: string | null; source_location: Json; origin_metadata: Json; created_at: string },
        { id?: string; relationship_id: string; origin?: ProvenanceOrigin; document_id?: string | null; page_number?: number | null; supporting_text?: string | null; source_location?: Json; origin_metadata?: Json }
      >;
      entity_facts: Table<
        { id: string; entity_id: string; stable_key: string; field_key: string; content: string; structured_value: Json | null; visibility: KnowledgeVisibility; origin: ProvenanceOrigin; sort_order: number; context: Json; created_at: string; updated_at: string },
        { id?: string; entity_id: string; stable_key: string; field_key: string; content: string; structured_value?: Json | null; visibility?: KnowledgeVisibility; origin?: ProvenanceOrigin; sort_order?: number; context?: Json }
      >;
      fact_evidence: Table<
        { id: string; fact_id: string; origin: ProvenanceOrigin; document_id: string | null; page_number: number | null; supporting_text: string | null; source_location: Json; origin_metadata: Json; created_at: string },
        { id?: string; fact_id: string; origin?: ProvenanceOrigin; document_id?: string | null; page_number?: number | null; supporting_text?: string | null; source_location?: Json; origin_metadata?: Json }
      >;
      entity_summary_evidence: Table<
        { id: string; entity_id: string; summary_kind: KnowledgeSummaryKind; origin: ProvenanceOrigin; document_id: string | null; page_number: number | null; supporting_text: string | null; source_location: Json; origin_metadata: Json; created_at: string },
        { id?: string; entity_id: string; summary_kind: KnowledgeSummaryKind; origin?: ProvenanceOrigin; document_id?: string | null; page_number?: number | null; supporting_text?: string | null; source_location?: Json; origin_metadata?: Json }
      >;
      campaign_overview_evidence: Table<
        { id: string; campaign_id: string; summary_kind: KnowledgeSummaryKind; origin: ProvenanceOrigin; document_id: string | null; page_number: number | null; supporting_text: string | null; source_location: Json; origin_metadata: Json; created_at: string },
        { id?: string; campaign_id: string; summary_kind: KnowledgeSummaryKind; origin?: ProvenanceOrigin; document_id?: string | null; page_number?: number | null; supporting_text?: string | null; source_location?: Json; origin_metadata?: Json }
      >;
      processing_runs: Table<
        { id: string; campaign_id: string; stage: string; status: string; input_metadata: Json; output_metadata: Json; error_message: string | null; created_at: string },
        { id?: string; campaign_id: string; stage: string; status: string; input_metadata?: Json; output_metadata?: Json; error_message?: string | null }
      >;
      extraction_cache_runs: Table<
        { id: string; campaign_id: string; document_id: string; status: string; extraction_model: string; cache_schema_version: number; chunking_metadata: Json; error_message: string | null; created_at: string; completed_at: string | null },
        { id?: string; campaign_id: string; document_id: string; status: string; extraction_model: string; cache_schema_version?: number; chunking_metadata?: Json; error_message?: string | null; completed_at?: string | null }
      >;
      extraction_cache_chunks: Table<
        { id: string; cache_run_id: string; chunk_id: string; chunk_index: number; page_numbers: number[]; raw_output: Json; validated_output: Json; validation_diagnostics: Json; model: string; response_id: string | null; input_tokens: number | null; cached_input_tokens: number | null; cache_write_tokens: number | null; output_tokens: number | null; total_tokens: number | null; estimated_cost_usd: number | null; created_at: string },
        { id?: string; cache_run_id: string; chunk_id: string; chunk_index: number; page_numbers: number[]; raw_output: Json; validated_output: Json; validation_diagnostics?: Json; model: string; response_id?: string | null; input_tokens?: number | null; cached_input_tokens?: number | null; cache_write_tokens?: number | null; output_tokens?: number | null; total_tokens?: number | null; estimated_cost_usd?: number | null }
      >;
      reconciliation_cache_results: Table<
        { id: string; cache_run_id: string; decision: Json; model: string | null; response_id: string | null; input_tokens: number | null; cached_input_tokens: number | null; cache_write_tokens: number | null; output_tokens: number | null; total_tokens: number | null; estimated_cost_usd: number | null; created_at: string },
        { id?: string; cache_run_id: string; decision?: Json; model?: string | null; response_id?: string | null; input_tokens?: number | null; cached_input_tokens?: number | null; cache_write_tokens?: number | null; output_tokens?: number | null; total_tokens?: number | null; estimated_cost_usd?: number | null }
      >;
      enrichment_cache_runs: Table<
        { id: string; campaign_id: string; document_id: string; extraction_cache_run_id: string | null; status: string; enrichment_model: string; cache_schema_version: number; prompt_version: string; graph_fingerprint: string; output: Json | null; usage_diagnostics: Json; error_message: string | null; created_at: string; completed_at: string | null },
        { id?: string; campaign_id: string; document_id: string; extraction_cache_run_id?: string | null; status: string; enrichment_model: string; cache_schema_version: number; prompt_version: string; graph_fingerprint: string; output?: Json | null; usage_diagnostics?: Json; error_message?: string | null; completed_at?: string | null }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      replace_campaign_graph: {
        Args: {
          p_campaign_id: string;
          p_document_id: string;
          p_entities: Json;
          p_relationships: Json;
          p_facts?: Json;
        };
        Returns: Json;
      };
      persist_campaign_overviews: {
        Args: { p_campaign_id: string; p_document_id: string; p_gm_overview: string | null; p_player_overview: string | null; p_gm_sources?: Json; p_player_sources?: Json };
        Returns: undefined;
      };
      replace_campaign_graph_with_enrichment: {
        Args: { p_campaign_id: string; p_document_id: string; p_entities: Json; p_relationships: Json; p_facts: Json; p_campaign_overview: Json };
        Returns: Json;
      };
    };
    Enums: { campaign_status: CampaignStatus; entity_type: EntityType; knowledge_visibility: KnowledgeVisibility; entity_prominence: EntityProminence; provenance_origin: ProvenanceOrigin; knowledge_summary_kind: KnowledgeSummaryKind };
    CompositeTypes: Record<string, never>;
  };
}
