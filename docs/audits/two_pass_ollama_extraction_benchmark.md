# Two-pass Ollama extraction benchmark

Date: 2026-09-14
Decision: `TWO_PASS_STILL_OVERLOADED`

## Baseline

- Baseline commit: `3b439430463a6bb774bc10ca5ad90137b28649de` (`Add Ollama single-pass extraction baseline`), package `0.4.8`, committed and pushed before this redesign.
- Baseline decision: `LOCAL_SINGLE_PASS_SCHEMA_OVERLOADED`.
- Qwen single-pass scored calls: `0 / 6` valid across two runs; nine-chunk stress: `0 / 9` valid.
- Every baseline failure was a client-visible transport disconnect around 302–305 seconds. No valid output or reported usage was returned, so recall, precision, F1, and token totals are unavailable rather than zero.

## Architecture

```text
source chunk
  → compact entity inventory
  → validated authoritative inventory
  → rich facts/relationships grounded to inventory IDs
  → current ChunkExtraction candidate assembly
  → existing deterministic grouping/global reconciliation
  → canonical graph
```

The redesign does not change global reconciliation. Pass B must cover every validated inventory ID exactly once, cannot add entities, and cannot reference unknown fact owners or relationship endpoints. A small `suspected_inventory_misses` diagnostic is source-validated but never assembled into campaign knowledge.

## Schemas and validation

`ExtractionInventoryOutput` contains only stable chunk-local ID, name, type, useful explicit aliases, and entity-existence evidence. Duplicate IDs fail validation. Invalid evidence is diagnosed; an entity with no valid existence evidence is excluded before the inventory becomes authoritative.

`ExtractionRichOutput` contains ID-grounded per-entity roles, a compact source-backed compatibility summary, typed facts, relationships, and bounded suspected-inventory-miss diagnostics. Rich output must include every inventory ID exactly once with the same type. Unknown/duplicate IDs, invalid type-specific fact keys, missing inventory coverage, unknown relationship endpoints, and self-relationships fail closed. Invalid evidence removes only the unsupported fact/relationship/diagnostic; it cannot remove an inventory entity.

The two validated outputs are assembled into the existing candidate representation. This preserves the current aggregate, reconciliation, canonical graph, fact, relationship, and persistence contracts.

## Checkpoints and planning

Each chunk now has two M4-style operation identities:

- `extraction / inventory / <chunk-id>`
- `extraction / rich / <chunk-id>`

Inventory and rich checkpoints have independent provider, model, semantic input, behavior, and schema identities. The rich upstream fingerprint includes the validated inventory plus its exact operation identity, so inventory provider/model/input/behavior/schema changes invalidate dependent rich work even if names happen to be identical. A rich-model-only change preserves inventory reuse.

Corrupt inventory forces inventory and rich to rerun; corrupt rich preserves inventory reuse. A later reconciliation or persistence failure leaves both validated extraction checkpoints reusable. Fresh `N`-chunk planning reports `N` inventory operations, `N` rich operations, and `2N` total operations with independent `REUSE`, `RUN`, or `INVALIDATED` state. Both OpenAI substages share the existing server-side call ceiling; local operations consume no OpenAI budget.

## Provider configuration

New server-only overrides:

```text
OPENAI_EXTRACTION_INVENTORY_MODEL
OPENAI_EXTRACTION_RICH_MODEL
LOCAL_AI_EXTRACTION_INVENTORY_MODEL
LOCAL_AI_EXTRACTION_RICH_MODEL
```

Fallback is substage override → existing extraction override → provider-wide model. Production OpenAI choices were not changed. A local failure still has no OpenAI fallback.

## Deterministic verification before inference

All phase-gate checks passed before the live capture:

- `npm run lint`
- `npm run typecheck`
- `npm test` — 32 files / 272 tests at the phase gate
- `npm run build` — Next.js 16.3.4
- `npm run evaluate:recall`
- `npm run evaluate:extraction-workload`
- `npm run evaluate:checkpoints`
- `npm run evaluate:two-pass-extraction`
- `npm run evaluate:extraction-local-two-pass -- --dry-run`

The dense deterministic fixture covers NPCs, locations, a deity, faction, item, quest, event, Other, facts, and relationships. It proves inventory breadth survives independently of rich volume. The curated recall regression proves all 13 source-backed identities survive assembly; Jeanas Clocker and Jesper Clocker remain distinct, while the legitimate Cay Naja cross-type duplicate can still merge and retype through existing reconciliation.

These are contract/regression protections, not real-model recall proof.

## Controlled local environment

| Setting | Value |
|---|---|
| Machine | Ryzen 5 7600X, 32 GB RAM, NVIDIA RTX 3060 12 GB |
| Endpoint | Ollama OpenAI-compatible API at `http://localhost:11434/v1` |
| Model, both passes | `qwen3.5:9b` |
| Digest | `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7` |
| Context | 32,768 |
| Temperature | 0 |
| Reasoning | none |
| Concurrency | 1 |
| Automatic retries | 0 |
| Persistence | false |

The harness used the frozen chunk order `3, 5, 4`, all nine original Test 3 chunks, then `3, 5, 4` again. Source hashes matched the frozen v0.4.8 reference before inference. Raw captures are isolated under ignored `artifacts/extraction-local-two-pass/`.

## Three scored chunks — run 1

| Chunk | Pages | Inventory | Inventory latency | Rich | End-to-end |
|---:|---:|---|---:|---|---|
| 3 | 38–53 | transport failure | 303.222 s | not run | failed |
| 5 | 67–84 | transport failure | 304.611 s | not run | failed |
| 4 | 53–67 | transport failure | 303.780 s | not run | failed |

- Inventory success: `0 / 3`.
- Rich success: `0 / 3`; all were dependency-blocked and not attempted.
- End-to-end success: `0 / 3`.
- Aggregate inventory latency: 911.613 seconds.
- Recall, frozen-reference precision, F1, historical-miss recovery, per-type recall, entity/fact/relationship counts, outputs, and usage: unavailable because no inventory returned.

## Nine-chunk stress

| Chunk | Pages | Inventory result | Latency | Rich result | Full chunk |
|---:|---:|---|---:|---|---|
| 1 | 1–21 | transport failure | 304.039 s | not run | failed |
| 2 | 21–38 | transport failure | 303.240 s | not run | failed |
| 3 | 38–53 | transport failure | 303.302 s | not run | failed |
| 4 | 53–67 | transport failure | 303.038 s | not run | failed |
| 5 | 67–84 | transport failure | 303.455 s | not run | failed |
| 6 | 84–99 | transport failure | 304.968 s | not run | failed |
| 7 | 99–114 | transport failure | 302.442 s | not run | failed |
| 8 | 114–153 | transport failure | 303.588 s | not run | failed |
| 9 | 153–160 | transport failure | 304.223 s | not run | failed |

- Inventory success: `0 / 9`; failures: 9 transport, 0 HTTP/schema/evidence failures.
- Rich success: `0 / 9`; all 9 were not run because inventory never validated.
- Full chunk success: `0 / 9`.
- Inventory latency: mean 303.588 s, median 303.455 s, p95 304.968 s, aggregate 2,732.295 s.
- Rich and total two-pass output pressure could not be measured. No response returned model content or usage; tokens and largest output are unavailable (`null`), not zero.

## Three scored chunks — run 2

| Chunk | Inventory | Inventory latency | Rich | End-to-end | Run-1 delta |
|---:|---|---:|---|---|---:|
| 3 | transport failure | 304.363 s | not run | failed | +1.141 s |
| 5 | transport failure | 303.075 s | not run | failed | −1.536 s |
| 4 | transport failure | 302.479 s | not run | failed | −1.301 s |

- Inventory success: `0 / 3`; rich success: `0 / 3`; end-to-end success: `0 / 3`.
- Aggregate inventory latency: 909.917 seconds, 1.696 seconds below run 1.
- Quality and output metrics remain unavailable.

## Before/after comparison

| Metric | Historical Luna | v0.4.8 Luna | v0.4.8 Terra | Qwen single-pass | Qwen two-pass |
|---|---:|---:|---:|---:|---:|
| Valid scored calls/chunks | 3/3 | 3/3 | 3/3 | 0/6 | **0/6** |
| Nine-chunk valid | n/a | n/a | n/a | 0/9 | **0/9** |
| Supported recall | 50.3% | 47.6% | 68.3% | unavailable | **unavailable** |
| Frozen-reference precision | 97.3% | 87.3% | 81.8% | unavailable | **unavailable** |
| F1 | 66.4% | 61.6% | 74.4% | unavailable | **unavailable** |
| Item recall | 9.1% | 0.0% | 27.3% | unavailable | **unavailable** |
| Quest recall | 44.4% | 11.1% | 0.0% | unavailable | **unavailable** |
| Failure mode | none | none | none | stable ~5-minute transport disconnect in full schema | **stable ~5-minute transport disconnect in compact inventory schema** |

The architecture did not materially improve extraction reliability or produce scoreable supported-entity recall with this same local model. The important new attribution is that overload occurs before rich-output pressure: even the intentionally compact inventory operation fails at the stable boundary. Pass B was never exercised by live Qwen inference.

## Safety and integrity

- OpenAI generation calls: `0`.
- Campaign writes: `0`.
- Official extraction-cache/checkpoint writes: `0`.
- Reconciliation persistence/calls: `0`.
- Enrichment calls: `0`.
- Test 2, original Test 3, and Test 3 Recovery were read-only and unchanged by construction.
- The read-only extraction workload still reproduced the Test 3 graph fingerprint `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6` and the cached `112 / 502 / 145` graph remains the protected reference.

## Decision

`TWO_PASS_STILL_OVERLOADED`

Reliability missed both gates (`0 / 6` scored versus required `5 / 6`; `0 / 9` stress versus required `8 / 9`). Recall gates cannot be evaluated. The deterministic architecture is valid, but the controlled live evidence does not validate this local model/runtime configuration for either pass.

## Next recommendation

Evidence is not yet sufficient to justify a paid live OpenAI validation of the unchanged design. First run a separately scoped, no-cost diagnostic that reduces inventory operation pressure—most plausibly smaller source chunks or bounded category-partitioned inventory—while holding the frozen reference and local settings constant. A paid OpenAI validation becomes useful after at least the inventory stage returns reliably enough to exercise Pass B end to end.

V0.4 TWO-PASS EXTRACTION + LOCAL RE-BENCHMARK: FAIL
