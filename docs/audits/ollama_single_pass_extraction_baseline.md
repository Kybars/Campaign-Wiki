# Ollama single-pass extraction baseline

Date: 2026-09-13
Decision: `LOCAL_SINGLE_PASS_SCHEMA_OVERLOADED`

## Baseline

- Starting commit: `ca87efc2aa6c5c37533a8af7d31e83fa40235e0d`.
- Package version: `0.4.8`.
- Dirty files at start: `lib/ai/structured-model-provider.ts` only.
- The user's intentional local-provider compatibility changes were preserved and finalized: local structured calls send `reasoning_effort: "none"` and strict JSON Schema derived from the supplied Zod schema.
- The current production extraction prompt, schema, ontology, chunking, evidence validator, and single-pass architecture were unchanged.
- Raw captures and the manifest are isolated under ignored `artifacts/extraction-local-baseline/`.

## Local environment

| Setting | Value |
|---|---|
| Machine | Ryzen 5 7600X, 32 GB RAM, NVIDIA RTX 3060 12 GB |
| Endpoint | Ollama OpenAI-compatible API at `http://localhost:11434/v1` |
| Model | `qwen3.5:9b` |
| Digest | `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7` |
| Model details observed after capture | Qwen 3.5 family, 9.7B, Q4_K_M |
| Context | 32,768, confirmed by `/api/ps` after capture |
| Loaded size / placement | 6,584,805,620 bytes VRAM; prior manual observation was 100% GPU |
| Reasoning | `none` |
| Temperature | `0` |
| Extraction concurrency | `1` |
| Local persistence | `false` |

The Ollama service remained healthy after the experiment: `/api/tags` returned the configured model and `/api/ps` reported the runner at context length 32,768.

## Manual compatibility findings

These pre-existing manual findings are part of the baseline:

1. Plain JSON mode returned parseable JSON after enabling 32K context, but the model invented a simpler entity/fact/relationship shape. The unchanged Campaign Wiki Zod schema correctly rejected it.
2. A tiny strict schema succeeded with `{ "name": "Hanna", "type": "npc" }`. This proves endpoint reachability, model operation, reasoning-disabled operation, and basic strict JSON-schema compatibility.
3. The full production extraction schema previously ran for roughly five minutes, generated roughly 15K tokens, and ended in Ollama HTTP 500. Ollama logged `truncated = 0`, unloaded the runner, and left the service healthy.

The controlled run below did not receive an HTTP response body or status. All failures were therefore classified by the client as `transport failure`, not retroactively relabeled as HTTP 500. Their duration and the still-healthy Ollama service are consistent with the manual full-schema failure, but that relationship is an inference.

## Harness

`npm run evaluate:extraction-local` runs the frozen experiment and, after a completed manifest exists, reads and summarizes the saved captures without making more model calls. `--dry-run` verifies the plan without generation.

The capture used the same frozen scored chunks in order `3, 5, 4`, then all nine historical Test 3 chunks, then a second `3, 5, 4` scored run. Each chunk was a separate operation. A failed operation did not abort later operations. There were no automatic retries, repair calls, fallback models, reconciliation calls, enrichment calls, checkpoint writes, extraction-cache writes, or campaign writes.

Each attempt records chunk/page identity, normalized source hash, provider/model/context, outcome and failure class, HTTP status when available, latency, reported usage when available, output size when available, candidate counts when valid, and validation diagnostics when valid. Large model content is not printed by default.

## Three-chunk scored benchmark

### Run 1

| Chunk | Pages | Source SHA-256 | Result | Failure class | Latency |
|---:|---:|---|---|---|---:|
| 3 | 38–53 | `f169ec9cb51907a354c4d9475089bc164265df0d9b0aa23c4a9d21918e25f2dd` | Failed | transport failure | 302.225 s |
| 5 | 67–84 | `e12a4e059fb984a1c3bbb51a33ae84ebd2a9a8fc6190f25c9827ce01f79b1155` | Failed | transport failure | 302.454 s |
| 4 | 53–67 | `5069e943412f9855eb4448b222d247343d7514d915d58776ff90b386551ba095` | Failed | transport failure | 304.599 s |

- Valid structured outputs: `0 / 3`.
- Aggregate latency: `909.278 s` (15m 9.278s).
- Supported-entity recall, frozen-reference precision, F1, historical-miss recovery, and per-type recall: **unavailable** because no chunk returned a valid extraction.
- Entity, fact, relationship, output-size, and token totals: **unavailable**. Failed responses reported no usage or model content; unknown usage is `null`, not zero.

These failures are not scored as empty extractions. A valid `{ entities: [], relationships: [] }` would be a success with zero candidates; no such output occurred.

## Nine-chunk stress run

| Chunk | Pages | Result | Failure class | Latency |
|---:|---:|---|---|---:|
| 1 | 1–21 | Failed | transport failure | 304.252 s |
| 2 | 21–38 | Failed | transport failure | 305.008 s |
| 3 | 38–53 | Failed | transport failure | 304.842 s |
| 4 | 53–67 | Failed | transport failure | 304.832 s |
| 5 | 67–84 | Failed | transport failure | 304.882 s |
| 6 | 84–99 | Failed | transport failure | 304.646 s |
| 7 | 99–114 | Failed | transport failure | 305.073 s |
| 8 | 114–153 | Failed | transport failure | 304.836 s |
| 9 | 153–160 | Failed | transport failure | 305.528 s |

| Stress metric | Result |
|---|---:|
| Chunks attempted | 9 |
| Valid structured outputs | 0 |
| Client-visible HTTP 4xx / 5xx | 0 / 0 |
| Transport failures | 9 |
| Malformed JSON failures | 0 |
| Schema-invalid JSON failures | 0 |
| Evidence-validation failures | 0 |
| Mean latency | 304.878 s |
| Median latency | 304.842 s |
| P95 latency | 305.528 s |
| Total reported tokens | unavailable (`null`) |
| Largest returned output | unavailable; no response returned content |

The stress run spent 2,743.899 seconds in aggregate (45m 43.899s). The narrow latency range—1.276 seconds between minimum and maximum—shows an exceptionally stable catastrophic failure boundary across source chunks of materially different page spans.

## Variance repeat

| Chunk | Run 1 | Run 2 | Latency delta |
|---:|---|---|---:|
| 3 | transport failure, 302.225 s | transport failure, 304.875 s | +2.650 s |
| 5 | transport failure, 302.454 s | transport failure, 304.887 s | +2.433 s |
| 4 | transport failure, 304.599 s | transport failure, 304.862 s | +0.263 s |

Both runs produced `0 / 3` valid outputs. Run 2 aggregate latency was 914.624 seconds, 5.346 seconds slower than run 1. Success/failure stability was exact. Recall delta, F1 delta, and historical-miss recovery delta are unavailable because neither run produced a valid scored output. The valid entity-count delta is zero only in the literal sense that neither run produced any valid entity counts; it is not evidence of equivalent extraction content.

## Comparison

The frozen reference is intentionally non-exhaustive, so the historical precision caveat still applies. Ollama has no quality metrics because all six scored operations failed before returning valid structured output.

| Metric | Historical Luna | v0.4.8 Luna | v0.4.8 Terra | Ollama single-pass |
|---|---:|---:|---:|---:|
| Valid scored calls | 3 / 3 | 3 / 3 | 3 / 3 | **0 / 6** across two runs |
| Supported recall | 50.3% | 47.6% | 68.3% | unavailable |
| Frozen-reference precision | 97.3% | 87.3% | 81.8% | unavailable |
| Frozen-reference F1 | 66.4% | 61.6% | 74.4% | unavailable |
| Historical misses recovered | 0 / 45 | 10 / 45 | 25 / 45 | unavailable |
| Facts | 226 | 208 | 309 | unavailable |
| Relationships | 62 | 42 | 71 | unavailable |
| Output tokens | 31,576 | 27,928 | 39,194 | unavailable |

## Safety and benchmark integrity

- Paid OpenAI calls: `0`.
- Reconciliation calls: `0`.
- Enrichment calls: `0`.
- Campaign/database benchmark writes: `0`.
- Official extraction-cache/checkpoint writes: `0`.
- Test 2 remained `complete` at 156 entities / 262 relationships with unchanged `updated_at` `2026-09-05T16:26:22.735256+00:00`.
- Original Test 3 remained `failed` at 0 persisted entities / 0 relationships with unchanged `updated_at` `2026-09-10T16:54:42.631934+00:00`.
- Test 3 Recovery remained `complete` at 112 entities / 502 facts / 145 relationships with unchanged `updated_at` `2026-09-12T12:08:38.933672+00:00`.
- The cached graph fingerprint remained `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`.

## Verification

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: pass; 31 files and 263 tests.
- `npm run build`: pass under Next.js 16.3.4.
- Focused provider tests: pass; 14 tests. They cover reasoning disabled, strict Zod-derived JSON Schema, valid output, malformed JSON, schema-invalid JSON, useful HTTP failure details, transport classification, and no local-to-OpenAI fallback path.
- `npm run evaluate:recall`: pass; 52 extraction misses and 0 reconciliation losses unchanged.
- `npm run evaluate:extraction-workload`: pass; nine cached chunks and the historical graph fingerprint unchanged.
- `npm run evaluate:extraction-local`: pass in saved-result summary mode; no additional local generation call was made.
- `git diff --check`: pass.

## Decision

`LOCAL_SINGLE_PASS_SCHEMA_OVERLOADED`

The evidence distinguishes basic local compatibility from production-contract viability. The same endpoint/model accepts a tiny strict schema and previously produced parseable JSON in plain JSON mode, while the unchanged production schema failed all 15 controlled operations at a repeatable five-minute boundary and returned no scoreable output. This is stronger evidence for an overloaded single-pass contract than for random instability or an inconclusive setup failure.

The evidence is sufficient to proceed to the separately scoped two-pass extraction redesign. This task does not implement that redesign. The frozen three-chunk reference should remain the quality gate, and the nine-chunk workload should remain the stability gate for the redesigned pipeline.

OLLAMA SINGLE-PASS EXTRACTION BASELINE: FAIL
