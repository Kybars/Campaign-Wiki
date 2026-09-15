# WotBS Stage 1 v3 completeness sweep

## Decision

`V3_COMPLETENESS_SWEEP_VALIDATED`

One unchanged v3 Pass-A call followed by one compact semantic completeness call produced valid, bounded structured output without retry. The deterministic union reached 39/43 hard-reference identities (90.7%) at 93.2% reference-bounded precision and 9,205 model tokens. This validates the two-read completeness direction on the small fixture; it does not validate Pass B, candidate assembly, reconciliation, persistence, or production-scale reliability.

## Starting state and restoration

- Starting HEAD: `e37b3a666b10aa83b15d863fe8f417eefd32a08c`, the clean pushed v3 identity/page-grounding checkpoint.
- The rejected v4 candidate-harvest implementation was restored out of production before this run. Restored to HEAD: `lib/ai/extract.ts`, `lib/ai/operation-checkpoint.ts`, `lib/ai/prompts.ts`, `lib/ai/schemas.ts`, `lib/processing/process-campaign.ts`, the two deterministic evaluation scripts, and their affected production/checkpoint tests.
- Retained: the v4 audit, its standalone archival evaluator and harvester tests, and the durable rejection conclusion in `docs/CURRENT_STATE.md`. These are not imported by production.
- Production Pass A was verified as one model call emitting only `name`, `type`, and `page`, followed by existing deterministic grounding, evidence extraction, IDs, deduplication, provenance, and checkpointing.
- Production checkpoint identity remained `v0.4-identity-page-grounding-3`, schema/contract version 3. No checkpoint version was bumped.

## Frozen fixture and runtime

- Source: `War of the Burning Sky Campaign Guide`, supplied excerpt corresponding to PDF pages 10–12.
- Pages: 3; extracted source characters: 11,083; estimated source tokens: 2,771; production chunks: 1.
- PDF SHA-256: `509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990`.
- Normalized text SHA-256: `b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281`.
- Runtime: local Ollama `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, requested context 32,768, temperature 0, reasoning none, concurrency 1, and a 600-second absolute request deadline.
- The evaluator loaded the private gold reference only after both generations and then asserted that neither system prompt nor payload contained gold artifact names, markers, or content.

## Initial v3 Pass A

| Metric | Result |
| --- | ---: |
| Valid structured output | yes |
| Latency | 29.795s |
| Input / output / total tokens | 3,313 / 1,318 / 4,631 |
| Output characters | 2,113 |
| Raw / authoritative entities | 39 / 39 |
| Validation diagnostics | 0 |
| Recall | 37/43 = 86.0% |
| Reference-bounded precision | 37/39 = 94.9% |
| F1 | 90.2% |

The result reproduced the frozen baseline exactly by entity count, tokens, output size, recall, precision, and misses. Per-type recall was NPC 8/11 (72.7%), Location 13/14 (92.9%), Faction 1/1, Item 2/2, Quest 12/12, Event 0/2, and Other 1/1. Named anchors were 8/9, missing Shalosha.

## Completeness sweep

The second input contained the same source and a deterministic 39-line inventory summary containing only source-facing name, type, and page. The compact inventory contribution was 1,318 characters, estimated at 330 tokens. It contained no IDs, evidence, facts, relationships, summaries, aliases, or evaluator information.

| Metric | Result |
| --- | ---: |
| Valid structured output | yes |
| Latency | 20.150s |
| Input / output / total tokens | 3,627 / 947 / 4,574 |
| Output characters | 1,410 |
| Proposed identities | 29 |
| Exact normalized duplicates rejected | 23 |
| Grounded additions | 5 |
| Ungrounded exclusions | 1 |

The five grounded additions were Innenotdar, The Scourge, and the source-backed variants Leska, Gallo, and Ragesia. The latter three are obvious same-identity short/type variants of initial records and remain a known limitation because this experiment intentionally did not add semantic reconciliation or broaden deterministic identity rules. They did not replace or mutate initial entities.

Etinifi was proposed but excluded: the model-selected page did not contain a deterministically matchable normalized name under the unchanged v3 grounding policy. No permissive Event or benchmark-specific grounding exception was added.

New hard-reference recovery was 2: Innenotdar and The Scourge. Of the six frozen prior misses:

- Recovered: Innenotdar, The Scourge.
- Still missing: Shalosha, Indomitability, Etinifi, Assassination of Drakus Coaltongue.

The model repeated 23 exact normalized initial identities despite the omission-only instruction. Application validation rejected all of them before grounding, and no completeness result replaced an initial authoritative entity.

## Final deterministic union

| Metric | Result |
| --- | ---: |
| Authoritative entities | 44 |
| Deterministic IDs / collisions | 44 / 0 |
| Recall | 39/43 = 90.7% |
| Reference-bounded precision | 41/44 = 93.2% |
| F1 | 91.9% |
| Adventure titles | 12/12 |
| Named anchors | 8/9 |

Per-type recall:

| Type | Recall |
| --- | ---: |
| NPC | 8/11 = 72.7% |
| Location | 14/14 = 100% |
| Faction | 1/1 = 100% |
| Item | 2/2 = 100% |
| Quest | 12/12 = 100% |
| Event | 1/2 = 50% |
| Other | 1/1 = 100% |

All five accepted additions were source-grounded. No unsupported identity entered through a grounding failure. The bounded evaluator identifies two duplicate-gold groups in the final union: Leska alongside Supreme Inquisitor Leska, and Ragesia alongside Ragesian Empire. Manual review also identifies Gallo alongside Duke Gallo as a clear short-name duplicate. These are candidate-quality limitations, not invented entities, but production promotion should keep them visible for later conservative reconciliation rather than silently declaring them distinct canonical identities.

NPC recall did not improve; the gain came from Location and Event recovery. This falls short of the desirable NPC improvement but satisfies the named decision thresholds: both calls were reliable, final recall and precision exceed 90%, Quest and Item recall remain complete, and workload is materially below rejected v4.

## Efficiency

| Architecture | Tokens | Entities | Recall | Precision | Latency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Frozen v3 single pass | 4,631 | 39 | 86.0% | 94.9% | 29.795s |
| Rejected v4 candidate path | 16,667 | 41 | 72.1% | 80.5% | 41.839s |
| v3 + completeness sweep | 9,205 | 44 | 90.7% | 93.2% | 49.945s |

The accepted experiment used 6,940 input and 2,265 output tokens. It cost 209.2 model tokens per final authoritative record and 2,287 incremental sweep tokens per newly recovered hard-reference identity. Total usage was 44.8% below rejected v4, though almost double the single-pass v3 baseline.

## Deterministic verification

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: pass, 40 files and 308 tests.
- `npm run build`: pass.
- `npm run evaluate:two-pass-extraction`: pass; one v3 inventory plus one rich operation, zero model calls.
- `npm run evaluate:checkpoints`: pass; expected reuse/run/invalidation behavior, zero model calls and writes.
- `npm run evaluate:recall`: pass; frozen Test 2/Test 3 evaluation unchanged, zero model calls and writes.
- WotBS fixture/isolation and completeness tests: pass.

Focused tests cover compact deterministic serialization, exclusion of IDs/evidence/facts/relationships/gold, initial-entity preservation, normalized duplicate rejection, deterministic grounded union, ungroundable output rejection, stable initial v3 IDs, and no persistence surface.

## Safety

- Local generation calls: exactly 2.
- OpenAI calls: 0.
- Pass B, reconciliation, and enrichment calls: 0.
- Campaign, official campaign, checkpoint, and cache writes: 0.
- Gold-reference leakage: 0.
- Demonplague and official Test 2/Test 3 artifacts: unchanged.
- Private fixture and generated raw model artifacts remain gitignored.

## Production recommendation

The completeness-sweep design is coherent enough to become the next production checkpoint direction. This experiment did not promote it or invalidate v3 checkpoints. Production wiring should receive a new behavior identity only when deliberately integrated, with the initial v3 inventory remaining independently reusable and the completeness result represented as an upstream-dependent operation. The next validation milestone should exercise Pass B and candidate assembly against the deterministic union while explicitly observing the short/full-name duplicate candidates.
