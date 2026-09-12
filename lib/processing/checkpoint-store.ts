import "server-only";

import type { AIOperationCheckpointStore, AIOperationIdentity, ValidatedCheckpoint } from "@/lib/ai/operation-checkpoint";
import type { ModelCallUsage } from "@/lib/ai/usage";
import type { Json } from "@/lib/db/types";
import { createAdminClient } from "@/lib/db/client";

function checkpointTableMissing(message: string) {
  return message.includes("ai_operation_checkpoints") && (message.includes("schema cache") || message.includes("does not exist"));
}

function identityQuery(identity: AIOperationIdentity) {
  return createAdminClient().from("ai_operation_checkpoints").select("*")
    .eq("campaign_id", identity.campaignId).eq("document_id", identity.documentId)
    .eq("provider_id", identity.providerId).eq("model_id", identity.modelId)
    .eq("processing_mode", identity.processingMode).eq("stage", identity.stage)
    .eq("operation_type", identity.operationType).eq("operation_key", identity.operationKey)
    .eq("input_hash", identity.inputHash).eq("upstream_fingerprint", identity.upstreamFingerprint)
    .eq("behavior_version", identity.behaviorVersion).eq("schema_version", identity.schemaVersion);
}

export function databaseCheckpointStore(): AIOperationCheckpointStore {
  return {
    async load<T>(identity: AIOperationIdentity) {
      const { data, error } = await identityQuery(identity).eq("status", "validated").limit(1).maybeSingle();
      if (error && checkpointTableMissing(error.message)) return null;
      if (error) throw new Error(`Load AI operation checkpoint: ${error.message}`);
      if (!data) return null;
      return { identity, output: data.validated_output as T, usage: (data.usage_diagnostics ?? []) as unknown as ModelCallUsage[], attemptCount: data.attempt_count };
    },
    async saveValidated<T>({ identity, output, usage, attemptCount }: ValidatedCheckpoint<T>) {
      const { error } = await createAdminClient().from("ai_operation_checkpoints").upsert({
        campaign_id: identity.campaignId, document_id: identity.documentId,
        source_extraction_cache_id: identity.sourceExtractionCacheId,
        provider_id: identity.providerId, model_id: identity.modelId, processing_mode: identity.processingMode,
        stage: identity.stage, operation_type: identity.operationType, operation_key: identity.operationKey,
        input_hash: identity.inputHash, upstream_fingerprint: identity.upstreamFingerprint,
        behavior_version: identity.behaviorVersion, schema_version: identity.schemaVersion,
        status: "validated", validated_output: output as Json, usage_diagnostics: usage as unknown as Json,
        error_message: null, attempt_count: attemptCount, completed_at: new Date().toISOString(),
      }, { onConflict: "campaign_id,document_id,provider_id,model_id,processing_mode,stage,operation_type,operation_key,input_hash,upstream_fingerprint,behavior_version,schema_version" });
      if (error) throw new Error(`Save validated AI operation checkpoint: ${error.message}`);
    },
    async saveFailed(identity, usage, errorMessage, attemptCount) {
      const { error } = await createAdminClient().from("ai_operation_checkpoints").upsert({
        campaign_id: identity.campaignId, document_id: identity.documentId,
        source_extraction_cache_id: identity.sourceExtractionCacheId,
        provider_id: identity.providerId, model_id: identity.modelId, processing_mode: identity.processingMode,
        stage: identity.stage, operation_type: identity.operationType, operation_key: identity.operationKey,
        input_hash: identity.inputHash, upstream_fingerprint: identity.upstreamFingerprint,
        behavior_version: identity.behaviorVersion, schema_version: identity.schemaVersion,
        status: "failed", validated_output: null, usage_diagnostics: usage as unknown as Json,
        error_message: errorMessage, attempt_count: attemptCount, completed_at: null,
      }, { onConflict: "campaign_id,document_id,provider_id,model_id,processing_mode,stage,operation_type,operation_key,input_hash,upstream_fingerprint,behavior_version,schema_version" });
      if (error) throw new Error(`Save failed AI operation checkpoint: ${error.message}`);
    },
    async inspect(identity) {
      const exact = await this.load(identity);
      if (exact) return { status: "REUSE", reason: "exact validated identity" };
      const { data, error } = await createAdminClient().from("ai_operation_checkpoints").select("id")
        .eq("campaign_id", identity.campaignId).eq("document_id", identity.documentId)
        .eq("stage", identity.stage).eq("operation_type", identity.operationType).eq("operation_key", identity.operationKey)
        .eq("status", "validated").limit(1);
      if (error && checkpointTableMissing(error.message)) return { status: "RUN", reason: "checkpoint migration not applied" };
      if (error) throw new Error(`Inspect AI operation checkpoint: ${error.message}`);
      return data?.length ? { status: "INVALIDATED", reason: "compatibility identity changed" } : { status: "RUN", reason: "no prior validated checkpoint" };
    },
  };
}
