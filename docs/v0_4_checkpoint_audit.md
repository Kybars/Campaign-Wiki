# v0.4 M4 durable AI checkpoint audit

Central rule: **validated AI work is durable work**. A response is reusable only after its operation-specific Zod and semantic validation succeeds. Raw, malformed, incomplete, cross-owner, or otherwise invalid output is never returned as a cache hit.

## Pre-M4 durability audit

| Stage / operation | Current persisted object before M4 | When persisted | Reusable after interruption before M4? | Compatibility identity before M4 | Gap found |
|---|---|---|---|---|---|
| Extraction run | `extraction_cache_runs` | Before chunk calls; marked complete only after all chunks | Only complete runs were loadable | campaign, document, model, cache schema, chunk metadata | Failed runs were excluded from replay even when they contained valid chunks |
| Individual extraction chunk | `extraction_cache_chunks` | Immediately after Zod and provenance/source validation | Persisted, but not reusable from an incomplete run | run ID plus chunk ID/index | No provider, exact input, behavior, or upstream fingerprint identity |
| Raw parsed extraction output | chunk `raw_output` | With validated chunk | Debuggable only | inherited run identity | Existence did not prove compatibility |
| Validated extraction output | chunk `validated_output` | With validated chunk | Only through a complete parent run | inherited run identity and cache schema | Correct validation boundary, incomplete resume path |
| Extraction diagnostics | chunk `validation_diagnostics` | With validated chunk | Historical/debug only | inherited run identity | No semantic checkpoint lookup |
| Deterministic reconciliation groups | reconstructed, not stored independently | Before reconciliation | Yes, deterministically | current aggregate | No explicit input hash/version identity |
| Reconciliation model decision | `reconciliation_cache_results` | After exact group coverage validation and before graph construction | Yes only when its complete extraction run was selected | extraction run ID and response model | Missing provider, exact input, prompt, schema, and upstream identity |
| Validated reconciliation decision | same row | Same boundary | Partially | same as above | Could not safely reuse across an equivalent reconstructed run |
| Canonical graph construction | database graph replacement | After reconciliation and optional enrichment | Transactional final output only | campaign/document persistence | A persistence failure could cause reconciliation to be repurchased in a fresh live run |
| Entity classification | monolithic `enrichment_cache_runs.output` | Only after every enrichment operation succeeded | No | campaign, document, graph fingerprint, model, whole-run prompt/schema versions | Valid early work was lost after a later failure |
| Fact visibility batch | same monolithic output | End of whole enrichment run | No | whole-run identity | No batch checkpoint |
| Relationship visibility batch | same monolithic output | End of whole enrichment run | No | whole-run identity | No batch checkpoint |
| GM summary batch | same monolithic output | End of whole enrichment run | No | whole-run identity | No batch checkpoint |
| Player summary batch | same monolithic output | End of whole enrichment run | No | whole-run identity | No batch checkpoint |
| GM overview | same monolithic output | End of whole enrichment run | No | whole-run identity | No operation checkpoint |
| Player overview | same monolithic output | End of whole enrichment run | No | whole-run identity | No operation checkpoint |
| Lean mode | no post-reconciliation model operations | N/A | N/A | processing mode diagnostics | No empty enrichment checkpoints should be created |

Extraction was therefore **chunk-persistent but not sufficiently chunk-resumable before M4**. Its validation and immediate-write boundary was already correct; M4 adds compatible lookup across interrupted runs instead of rebuilding its historical cache tables.

## M4 architecture

M4 adds the private `ai_operation_checkpoints` table as a compatibility index and durable validated-output store shared by extraction, reconciliation, and full enrichment. Existing extraction, reconciliation, and monolithic enrichment history remains unchanged and readable.

A checkpoint identity contains:

- campaign and document identity;
- source extraction cache reference as lineage metadata;
- provider and model IDs;
- processing mode where it changes operation semantics (`core` for extraction/reconciliation, `full` for enrichment);
- stage, operation type, and stable operation key;
- SHA-256 of the exact semantic system prompt and payload using recursively key-sorted serialization;
- upstream page/input or canonical-graph fingerprint;
- explicit behavior/prompt version;
- explicit output/schema contract version.

Provider, model, semantic input, behavior version, schema version, upstream fingerprint, and existing operation-key compatibility changes cannot reuse a checkpoint. A genuinely new operation key reports `RUN`; an existing key with changed compatibility reports `INVALIDATED`.

Behavior versions are explicit constants, not runtime hashes of source files. A semantically relevant prompt change must increment the applicable behavior version. A contract/schema change must increment its separate contract version.

## Final reusable boundaries

- Extraction: one validated chunk. Concurrent completion cannot change its stable chunk key/index; a new extraction-cache run may copy reused validated chunks into its own complete historical run without another model call.
- Reconciliation: one validated global decision with exact deterministic-group input identity, persisted before graph construction and graph persistence.
- Full enrichment: entity classification; each fact-visibility batch; each relationship-visibility batch; each GM-summary batch; each Player-summary batch; GM overview; Player overview.
- Lean mode: no enrichment operation exists, so no enrichment checkpoint row is created.

Downstream enrichment hashes use their fully resolved inputs. Classification changes therefore invalidate summaries naturally, and changed summaries/classified state invalidate overview reuse naturally.

## Validation and failure boundary

On both database and in-memory test stores, cached output is parsed and its semantic rules are checked again before reuse. Extraction must pass schema plus source/provenance validation. Reconciliation must pass exact group coverage. Enrichment batches must pass schema, exact key coverage, evidence ownership, and Player-safe operation rules. Overviews must cite only supplied evidence.

Failed operations store no `validated_output`. Their error, attempt count, and any usage available to the caller may be retained. A later valid retry upserts the same exact identity to `validated`; it does not create ambiguous duplicate successes. A reused operation contributes no new model call or new-run token/cost usage. Unknown local usage remains `null`, and local calls never receive OpenAI pricing.

## Resume planning and historical compatibility

The checkpoint planner is read-only: it reports `REUSE`, `RUN`, or `INVALIDATED` with a reason and performs zero writes and zero model calls. The full-recovery preflight reports compatible classification batches directly; dependency-aware summary and overview inputs are conservatively shown as work to resolve during execution. Runtime checkpoint diagnostics report their final exact reuse/run result.

Old extraction caches remain readable under their existing schema rules. Old reconciliation decisions remain readable but are not fabricated into new checkpoint identities. Old monolithic enrichment rows remain valid historical or whole-run cache records; failed runs are never converted to successful operation checkpoints. No Test 2/Test 3 or historical enrichment rows are rewritten.

The migration enables RLS, grants only `service_role`, revokes `anon` and `authenticated`, and adds no public policy. Checkpoint output is private campaign data.
