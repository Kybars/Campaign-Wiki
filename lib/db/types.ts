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
        { id: string; name: string; status: CampaignStatus; error_message: string | null; processing_stage: string | null; processing_diagnostics: Json; created_at: string; updated_at: string },
        { id?: string; name: string; status?: CampaignStatus; error_message?: string | null; processing_stage?: string | null; processing_diagnostics?: Json }
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
        { id: string; campaign_id: string; name: string; normalized_name: string; type: EntityType; roles: EntityRole[]; aliases: string[]; summary: string; reconciliation_metadata: Json; created_at: string; updated_at: string },
        { id?: string; campaign_id: string; name: string; normalized_name: string; type: EntityType; roles?: EntityRole[]; aliases?: string[]; summary?: string; reconciliation_metadata?: Json }
      >;
      entity_sources: Table<
        { id: string; entity_id: string; document_id: string; page_number: number; supporting_text: string; created_at: string },
        { id?: string; entity_id: string; document_id: string; page_number: number; supporting_text: string }
      >;
      relationships: Table<
        { id: string; campaign_id: string; source_entity_id: string; target_entity_id: string; relationship_type: string; description: string; confidence: number; resolution_metadata: Json; created_at: string; updated_at: string },
        { id?: string; campaign_id: string; source_entity_id: string; target_entity_id: string; relationship_type: string; description: string; confidence: number; resolution_metadata?: Json }
      >;
      relationship_sources: Table<
        { id: string; relationship_id: string; document_id: string; page_number: number; supporting_text: string; created_at: string },
        { id?: string; relationship_id: string; document_id: string; page_number: number; supporting_text: string }
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
    };
    Views: Record<string, never>;
    Functions: {
      replace_campaign_graph: {
        Args: {
          p_campaign_id: string;
          p_document_id: string;
          p_entities: Json;
          p_relationships: Json;
        };
        Returns: Json;
      };
    };
    Enums: { campaign_status: CampaignStatus; entity_type: EntityType };
    CompositeTypes: Record<string, never>;
  };
}
