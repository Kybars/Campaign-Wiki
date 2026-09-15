# WotBS Stage 1 promoted completeness sweep and Pass-B validation

## Decision

WOTBS_STAGE1_PASS_B_FAILED

The promoted initial-inventory plus completeness architecture reproduced the validated small-fixture Pass-A gate. The one authorized Pass-B attempt ran for 509.401 seconds and returned malformed, truncated JSON: an unterminated string at character 90,423. No retry, repair, fallback, reconciliation, persistence, or additional inference was performed.

## Production integration

Production now uses a v3-compatible initial inventory, a dependent completeness sweep, a deterministic final union, then Rich extraction.

- Initial inventory retains operation type inventory, behavior v0.4-identity-page-grounding-3, and contract 3, so validated v3 checkpoints remain reusable.
- Completeness is inventory_completeness, behavior v0.4-inventory-completeness-4, contract 4; its identity includes source, compact prompt/schema/model, and validated-initial dependency.
- Deterministic final identity is inventory_final, behavior v0.4-inventory-final-union-4, contract 4; Rich depends on its final fingerprint.
- Initial changes invalidate completeness and Rich. Completeness-model changes preserve initial reuse but rerun completeness and Rich. Rich-only changes preserve both inventory substages.

The rejected candidate-harvest experiment remains standalone and is not imported by production.

## Conservative duplicate suppression

Exact normalized dedupe remains the default. A sweep-only rule now rejects an otherwise matching same-page, same-type short name only when the longer initial name differs solely by recognized leading generic honorific/title tokens. It suppressed Gallo against Duke Gallo and Leska against Supreme Inquisitor Leska. It does not use fuzzy matching, arbitrary substring matching, morphology, WotBS-specific names, or cross-page matching. Ragesia/Ragesian Empire remains for later reconciliation or alias work.

## Fixture and runtime

- Source: supplied War of the Burning Sky Campaign Guide excerpt, PDF pages 10-12; 3 pages, 11,083 characters, one chunk.
- PDF SHA-256: 509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990.
- Normalized text SHA-256: b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281.
- Runtime: local qwen3.5:9b, digest 6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7, 32,768 context, temperature 0, reasoning none, concurrency 1, 600-second deadline.
- Gold was loaded only after the two Pass-A calls. Input isolation assertions passed.

## Fresh Pass A

| Stage | Valid | Latency | Input / output / total tokens | Entities |
| --- | --- | ---: | ---: | ---: |
| Initial v3 | yes | 29.755s | 3,313 / 1,318 / 4,631 | 39 |
| Completeness | yes | 20.080s | 3,627 / 947 / 4,574 | 29 proposed |

- Grounded additions: Innenotdar, The Scourge, Ragesia.
- Duplicate suppressions: 25; 23 exact normalized and two conservative title-stripped.
- Grounding exclusions: Etinifi only.
- Final inventory: 42 entities, 42 IDs, 0 collisions.
- Recall: 39/43 = 90.7%; bounded precision: 40/42 = 95.2%; F1: 92.9%.
- Quests: 12/12. Items: 2/2. Locations: 14/14. Faction: 1/1. NPC: 8/11. Events: 1/2. Other: 1/1. Named anchors: 8/9.
- Remaining hard-reference misses: Shalosha, Indomitability, Etinifi, Assassination of Drakus Coaltongue.

## Pass B

| Metric | Result |
| --- | ---: |
| Authorized attempts | 1 |
| Valid structured output | no |
| Latency | 509.401s |
| Failure class | malformed JSON |
| Parse failure | unterminated string at character 90,423 |
| Retry / repair / fallback | 0 / 0 / 0 |

The raw partial response was not accepted or used. Rich records, aliases, facts, relationships, and suspected misses are unavailable rather than zero. Unknown-ID violations surviving validation are zero because Rich validation never completed.

Candidate assembly and eligible conditional fact/relationship scoring were intentionally not run after invalid Rich output. Existing validators still reject unknown fact owners and relationship endpoints, preserve inventory entities omitted by Rich, and keep suspected misses diagnostic-only.

## Efficiency

| Component | Total tokens | Latency |
| --- | ---: | ---: |
| Initial Pass A | 4,631 | 29.755s |
| Completeness sweep | 4,574 | 20.080s |
| Pass-A total | 9,205 | 49.835s |
| Pass B | unavailable | 509.401s |

Pass A matches the validated sweep result and remains below the rejected candidate pipeline's 16,667 tokens.

## Verification and safety

- Lint, typecheck, 309 tests, and build passed.
- Deterministic initial/completeness/Rich planning, checkpoint, and recall evaluations passed with zero model calls.
- Local generations: exactly 3. OpenAI: 0. Retries: 0. Reconciliation/enrichment: 0.
- Campaign, official campaign, checkpoint, and cache writes: 0.
- Gold leakage: 0. Private fixture remains local and gitignored. Demonplague and official Test 2/Test 3 artifacts are unchanged.

## Follow-up

Keep this integration uncommitted pending focused Rich-output repair. The initial/completeness checkpoint boundary is coherent and tested, but the full Stage-1 end-to-end milestone is not validated.
