# Test 2 vs Test 3 entity recall audit

Date: 2026-09-12

Scope: read-only comparison of Test 2, original Test 3, and Test 3 Recovery

Model calls: 0

Remote writes: 0

## Verdict

Test 3's lower canonical entity count is an extraction-stage recall regression, not a source, validation, reconciliation, persistence, or recovery loss.

The campaigns used the same extracted source input. Test 2 produced 302 validated entity candidates and 156 canonical entities. Test 3 produced 207 raw candidates, lost five invalid candidate copies during deterministic evidence validation, retained 202 validated candidates, formed 118 deterministic identity groups, and returned 112 canonical entities. All 118 Test 3 groups were assigned exactly once by reconciliation. Test 3 Recovery reproduced those same 112 canonical entities with zero model calls.

The entity crosswalk finds 98 recalled Test 2 identities, six Test 2 duplicate rows correctly absent as separate identities, and 52 source-backed Test 2 identities that do not appear in any validated Test 3 candidate. It finds no Test 2 identity present among Test 3 candidates and then lost during reconciliation.

The evidence supports a small prompt-level recall correction. It does not support changing reconciliation, blaming validation, or switching models. The richer Test 3 extraction contract, long chunks, and large per-chunk outputs created materially more output competition than the legacy Test 2 contract; the extraction-model change remains a confounder because Test 2's model was not persisted.

## Protected records

| Record | Campaign ID | Status | Treatment |
| --- | --- | --- | --- |
| Test 2 | `a13d54b5-74e6-45e3-9f7f-9dcad214d7d3` | complete | read only |
| Demonplague - Test 3 | `d14f9875-5ebf-46c6-b07e-d65a3e65c5f4` | failed after later enrichment/recovery work | read only |
| Demonplague - Test 3 Recovery | `1151fb31-876b-4277-9718-76313c1c8d98` | complete | read only |

The complete machine-readable crosswalk is in [`test2_test3_entity_crosswalk.json`](./test2_test3_entity_crosswalk.json).

## 1. Source comparability

Classification: **EQUIVALENT_CONTENT_WITH_FORMATTING_DIFFERENCES**. This is the closest permitted category: extracted pipeline content is actually identical, while original PDF-byte equivalence cannot be established from the empty stored objects.

| Signal | Test 2 | Original Test 3 | Test 3 Recovery |
| --- | ---: | ---: | ---: |
| Filename | `The Demonplague Part I 2018-1014.pdf` | same | same |
| Document pages | 160 | 160 | 160 |
| Extracted text characters | 349,129 | 349,129 | 349,129 |
| Normalized text characters | 344,905 | 344,905 | 344,905 |
| Ordered raw-text SHA-256 | `e19edeebb9511c277bf24bbca930767191d911d70d0704aeb1d50c3c7cd00a3a` | same | same |
| Ordered normalized-text SHA-256 | `4c6cdfd6a67e709d8310ac3673da3bc34920e81971cb54d47137bb2de239fe32` | same | same |
| Per-page normalized hashes | 160/160 equal | 160/160 equal | 160/160 equal |

The stored PDF objects are zero-byte placeholders in all three paths (`size=0`, empty-object ETag), so original PDF byte identity is **UNKNOWN**. That does not affect this pipeline comparison: the model input is constructed from `document_pages`, and those rows are byte-for-byte equal after ordering for all three campaigns.

Test 2 and Test 3 both used nine chunks with a 45,000-character target and one-page overlap. Test 3 persisted exact page spans: 1–21, 21–38, 38–53, 53–67, 67–84, 84–99, 99–114, 114–153, and 153–160. Test 2 did not predate the chunker; its nine-chunk layout is **RECONSTRUCTED** from the then-current deterministic chunker and identical page text, rather than persisted page-span metadata.

## 2. Historical configuration

Evidence labels mean: **PERSISTED** is stored with the run/cache; **RECONSTRUCTED** is derived from the only repository revision available when the run began; **UNKNOWN** was neither stored nor recoverable without speculation.

| Setting | Test 2 | Test 3 |
| --- | --- | --- |
| Run start | **PERSISTED** 2026-09-05 16:21 UTC | **PERSISTED** 2026-09-10 14:05 UTC |
| Source pages / chunks | **PERSISTED** 160 / 9 | **PERSISTED** 160 / 9 |
| Chunk target / overlap | **RECONSTRUCTED** 45,000 / 1 from `6d6cb87` | **PERSISTED** 45,000 / 1 |
| Extraction model | **UNKNOWN**; the code default was Terra, but an environment override was possible and not stored | **PERSISTED** `gpt-5.6-luna` |
| Reconciliation model | **UNKNOWN** for the same reason | **PERSISTED** `gpt-5.6-terra` |
| Extraction prompt/schema | **RECONSTRUCTED** legacy entity/relationship contract from `6d6cb87` | **RECONSTRUCTED** rich fact contract at `a1ed859`; cache schema **PERSISTED** as v4 |
| Extraction output | **PERSISTED** aggregate counts only: 302 entities, 276 relationships, 19 rejected items | **PERSISTED** raw and validated output for every chunk |
| Reconciliation input/output | **PERSISTED** 302 candidates → 164 groups → 156 canonicals | **PERSISTED** 202 candidates → 118 groups → 112 canonicals |
| Post-core processing | No rich fact/enrichment pipeline existed | Rich v0.3 enrichment followed core processing; later failures do not alter cached core counts |
| Provider | **RECONSTRUCTED_FROM_VERSIONED_CODE** OpenAI-only implementation | **RECONSTRUCTED_FROM_VERSIONED_CODE** OpenAI-only implementation at run start |
| Concurrency | **UNKNOWN** actual value; code default 3 | **UNKNOWN** actual value; code default 3 |
| Max output tokens | **UNKNOWN**; no explicit setting in versioned call | **UNKNOWN**; no explicit setting in versioned call |
| Structured output | **RECONSTRUCTED_FROM_VERSIONED_CODE** Responses API + Zod JSON schema | **RECONSTRUCTED_FROM_VERSIONED_CODE** Responses API + richer Zod JSON schema |
| Finish reason / retries | **UNKNOWN** | **UNKNOWN** finish reason; nine successful response IDs persisted, provider-internal retries not persisted |

The Test 2 model cannot responsibly be labeled Terra merely because Terra was the code default. The exact environment value at run time is not persisted.

Answer: Test 2 and Test 3 did **not** use the same extraction semantics. Test 2 used the legacy entity/relationship schema; Test 3 used the rich entity/fact/relationship/evidence schema. Whether they used the same extraction model is **UNKNOWN** because Test 2's model identity was not stored.

## 3. Canonical crosswalk

### Test 2 disposition

| Classification | Count |
| --- | ---: |
| `MATCHED_SAME_IDENTITY` | 81 |
| `MATCHED_RETYPED` | 2 |
| `MATCHED_RENAMED_OR_ALIAS` | 15 |
| `TEST2_DUPLICATE_CORRECTLY_REMOVED` | 6 |
| `TEST2_NOISE_OR_UNSUPPORTED` | 0 |
| `MISSING_FROM_TEST3_EXTRACTION` | 52 |
| `PRESENT_IN_TEST3_CANDIDATES_BUT_LOST_IN_RECONCILIATION` | 0 |
| `AMBIGUOUS_REQUIRES_REVIEW` | 0 |

The 52 missing identities all have persisted Test 2 document evidence (100 source rows across all 52 entities). They therefore remain conservative recall misses rather than being relabeled as noise.

### Recall by Test 2 category

The rate below treats only the three `MATCHED_*` outcomes as recalled. Correctly removed duplicates stay in the baseline denominator, making the result conservative.

| Type | Recalled | Baseline | Recall |
| --- | ---: | ---: | ---: |
| NPC | 50 | 67 | 74.63% |
| Location | 20 | 29 | 68.97% |
| Faction | 10 | 15 | 66.67% |
| Event | 8 | 14 | 57.14% |
| Deity | 0 | 0 | N/A (Test 2 predates the type) |
| Quest | 3 | 7 | 42.86% |
| Item | 6 | 18 | 33.33% |
| Other | 1 | 6 | 16.67% |
| **All** | **98** | **156** | **62.82%** |

Items and quests show the sharpest actionable under-recall. Missing identities are not isolated to a single page range:

- NPCs (16): Absen Cooper, Beatrice Sharp, Brutus, Dame Parla Caendinx, Jesper Clocker, Kraps, Larkin, Lemon the Blood, Lila, Lord Laird Sealas, Malcolm Sharp, Mort, Muiri Tender, Scratches, Sir Farragut Eastward, Stinky.
- Locations (8): Brinner's Brews, Councilmember Kadra Tourmaline's Home, Feraduce Traders, Hemlet, Hemlet and Sweetwater Refugee Camps, Safeharbor Refugee Camp, Stronghammer's, Sweetwater.
- Factions (5): Gravdahs, Safeharbor commoners, Safeharbor Watch, Village Council, Yugtug greenskins.
- Items (12): Birthwitch family signet ring, Black Arrowheads, Gem of brightness, Gold-dolphin ring, Hat of disguise, High priest's signet ring, Lightning cage, Phelm's hidden gold stash, Ralekai's spellbook, Shark-tooth necklace, Someth's weapons cache, Star elf treasure trove.
- Events (6): Baryl Harb goblins' food-wagon ambush, Demonplague, Food Riot, Holy War, Huberg Greyborn's Assault on Frostfell, Nobles vs. Commoners.
- Quests (3): Feed the Hungry, Housing for Refugees, Meat for Tomar's Citizens.
- Other (2): Tomar's Legend, valok.

All 12 absent Test 2 items were inspected individually. Each has a distinct persisted name and document evidence; examples include the 39-charge gem of brightness, Kylar's family signet, Ralekai's spellbook, Phelm's hidden gold, and distinct wearable or weapon objects. None was demoted to noise merely to improve the recall score.

### Test 3-only disposition

| Classification | Count |
| --- | ---: |
| `NEW_VALID_RECALL` | 13 |
| `RETYPE_OR_RENAME_OF_TEST2` | 0 |
| `TEST3_DUPLICATE_OR_NOISE` | 1 |
| `AMBIGUOUS` | 0 |

Test 3 adds 13 useful source-backed identities, including Frostfell Crypts, the Duladarin star elf druids, Hemlet and Sweetwater refugee factions, a +1 longsword, several explicit events, and several explicit quests. The refugee factions are related to, but not identical with, Test 2's combined refugee-camps location. `Free the prisoners in Gardong Marhold` overlaps the retained `Stop Ralekai and Free the Prisoners` quest and is classified as the one Test 3 duplicate/noise row.

### Difference attribution

Against the 156-row Test 2 baseline:

| Requested bucket | Count | Baseline share |
| --- | ---: | ---: |
| X — legitimate Test 2 duplicates/noise | 6 | 3.85% |
| Y — extraction false negatives | 52 | 33.33% |
| Z — reconciliation losses/errors | 0 | 0% |
| W — legitimate retypes/renames (retained, so no count loss) | 17 | 10.90% |
| A — unresolved | 0 | 0% |

The remaining 81 Test 2 rows are same-identity matches. Test 3's 112 canonicals reconcile as 98 distinct matched Test 2 identities plus 13 new valid identities plus one Test 3 duplicate/noise identity. The net numerical difference alone is therefore not a loss equation; the crosswalk disposition is the meaningful accounting.

## 4. Stage attribution

| Stage | Evidence | Attribution |
| --- | --- | --- |
| Source/PDF text | All 160 page rows and both whole-text hashes equal | no loss |
| Chunk coverage | Same deterministic chunker, nine chunks, complete 1–160 coverage | no loss |
| Model raw extraction | 207 Test 3 raw entities versus 302 Test 2 validated candidates | primary loss stage |
| Deterministic source validation | Five Test 3 candidate copies removed; each affected identity survives from another chunk or canonical semantic equivalent | no crosswalk identity loss |
| Deterministic grouping | 202 candidates form 118 groups through exact typed names/aliases | duplicate consolidation, not loss |
| AI reconciliation | Contract validates every one of 118 group IDs exactly once; output has 112 canonicals after six cross-group merges | no group loss |
| Persistence | Original Test 3 currently has no persisted graph after its failed recovery history; its immutable validated cache contains 112 canonicals, and Test 3 Recovery persists exactly those 112 | no cache-to-recovery loss |
| Lean recovery | Reused cached extraction/reconciliation and reproduced fingerprint `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6` | no loss |

The 52 missing identities have no exact name, explicit alias, or enumerated source-equivalent semantic identity in any validated Test 3 candidate. Because reconciliation coverage is total, `PRESENT_IN_TEST3_CANDIDATES_BUT_LOST_IN_RECONCILIATION` is necessarily zero for this run.

## 5. Information depth

Entity count alone understates Test 3's useful content. Test 2 is a legacy graph: 156 summaries totaling 13,885 characters, 504 entity-source rows, 262 relationships, and no atomic fact rows. Test 3 Recovery has 112 summaries totaling 8,561 characters, 223 entity-source rows, 145 relationships, and 502 atomic facts totaling 37,132 fact-content characters. The cached canonical facts retain 524 evidence references (median 1 per fact).

Per retained entity, Test 3 averages 4.48 atomic facts and about 332 characters of fact content in addition to its summary. Test 2 averages 89 summary characters per entity; Test 3 averages 76 summary characters plus the richer fact content. Test 3 is therefore deeper per retained entity but materially narrower in entity coverage. Richness does not cancel the 52 source-backed recall misses.

For the 98 distinct matched identities, Test 2 versus Test 3 medians are: summary length 95 vs 76.5 characters, aliases 1 vs 0, entity-source rows 3 vs 1, atomic facts 0 vs 4, and relationship degree 3 vs 2. Totals over those matches are 391 vs 208 entity-source rows, 0 vs 478 facts, and 434 vs 271 relationship incidences. These fields are not schema-equivalent: Test 3 moved detail out of legacy summaries and into atomic facts.

## 6. Output saturation and prompt/schema pressure

Test 3 extraction used 125,005 input tokens and 74,940 output tokens across nine successful structured responses. Per-chunk output ranged from 6,508 to 12,376 tokens. The highest-output chunks were pages 38–53 (11,325 tokens) and 53–67 (12,376 tokens); the Test 2 evidence pages for 20 and 12 missing identities respectively overlap those ranges. Chunk 53–67 also generated 22 validation diagnostics.

| Chunk / pages | Input tokens | Output tokens | Validated bytes | Entities | Facts | Relationships | Finish reason |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 1 / 1–21 | 14,077 | 7,941 | 29,603 | 26 | 53 | 18 | UNKNOWN |
| 2 / 21–38 | 14,586 | 6,543 | 22,938 | 20 | 38 | 16 | UNKNOWN |
| 3 / 38–53 | 14,204 | 11,325 | 44,162 | 26 | 92 | 20 | UNKNOWN |
| 4 / 53–67 | 13,850 | 12,376 | 41,651 | 29 | 86 | 22 | UNKNOWN |
| 5 / 67–84 | 14,413 | 7,875 | 30,431 | 20 | 48 | 20 | UNKNOWN |
| 6 / 84–99 | 14,454 | 8,291 | 30,794 | 21 | 61 | 16 | UNKNOWN |
| 7 / 99–114 | 13,978 | 7,306 | 23,602 | 18 | 48 | 13 | UNKNOWN |
| 8 / 114–153 | 16,524 | 6,775 | 21,512 | 19 | 45 | 9 | UNKNOWN |
| 9 / 153–160 | 8,919 | 6,508 | 21,337 | 23 | 31 | 15 | UNKNOWN |

There is no persisted finish reason or explicit `max_output_tokens` setting, and every response parsed successfully. Therefore hard truncation is **UNKNOWN**, not proven. The data does show output pressure: the v0.3 schema asks one response to enumerate entities, aliases, entity evidence, up to 80 atomic facts per entity with their evidence, and relationships with evidence. The legacy Test 2 schema asked only for entities and relationships. The richer prompt also retains `Prefer false negatives over false positives` and repeatedly asks for “meaningful” entities, without stating that a source-backed named entity must not be omitted merely because it has little detail.

This is the best-supported mechanism: entity enumeration competed with rich fact and relationship generation inside long chunks, while the prompt's conservative wording offered no explicit recall floor. It explains why Test 3 is deeper but narrower and why the misses concentrate in minor NPCs, ordinary named locations, discrete items, and small quests/events.

## 7. Luna assessment

Primary classification: **PIPELINE/PROMPT/OUTPUT_PRESSURE_DOMINANT**.

The Luna extraction model is neither exonerated nor convicted by this comparison.

- Against Luna: its persisted Test 3 run produced 202 validated candidates from identical extracted source text where Test 2 produced 302.
- Against a model-only conclusion: Test 2's exact model is unknown, and its prompt/schema was much smaller. These variables changed together.
- Against a truncation claim: all nine Luna outputs parsed; no finish reason was stored; output totals do not establish a hard cap.
- Against a reconciliation-model claim: Terra reconciliation covered every group exactly once and cannot account for absent candidates.

No evidence-based model switch can be justified from these records alone. A future authorized A/B test must hold source, chunks, prompt, schema, and model parameters constant and vary only the extraction model.

## 8. Smallest evidence-based fix

Add a narrow recall guard to the extraction prompt:

1. False-negative preference applies only to ambiguous, generic, or unsupported mentions—not clearly named, source-backed campaign entities.
2. Do not omit a named entity merely because it has few facts, appears once, is a mundane named place/item, or seems minor; include it with concise evidence.
3. Before returning, check each supported entity category and every relationship endpoint for omitted named identities.

This fix was applied in v0.4.8. It changes no schema, reconciliation behavior, provider routing, chunk size, campaign data, or paid-call policy. It directly addresses the observed failure mode and is safer than increasing call count or changing models without a controlled evaluation.

| Rank | Remediation | Expected impact | Cost | Risk | Decision |
| ---: | --- | --- | --- | --- | --- |
| 1 | Narrow named-entity recall guard in the existing prompt | medium/high | no extra calls | low | apply now |
| 2 | Reduce extraction chunk size | potentially high | more extraction calls/tokens | medium | defer until controlled measurement |
| 3 | Split inventory and rich-fact extraction into separate model passes | high in theory | roughly doubles stage calls | high | not justified by current evidence |
| 4 | Switch Luna to Terra | unknown | model-dependent paid cost | medium/high | requires controlled A/B authorization |

The permanent deterministic `evaluate:recall` check validates the frozen crosswalk totals, total reconciliation coverage, source-equivalence hashes, curated presence/type/distinctness/merge rules, required recall-guard language, and zero paid/model calls. It cannot prove future model recall by itself; that requires an explicitly authorized model run.

## 9. Controlled A/B recommendation

A future Luna-versus-Terra comparison is **recommended before changing the production extraction model**, but it is not required to retain the prompt fix.

The smallest useful design is six extraction calls: run the exact same current prompt, schema, page text, chunk boundaries, and structured-output settings on chunks 3, 4, and 5 once with Luna and once with Terra. Those chunks cover pages 38–84, contain the densest historical outputs, and overlap evidence for most misses. Score the 13-entity curated reference fixture plus the complete relevant crosswalk subset; report per-type recall, unexpected/unsupported entities, validation failures, facts and evidence retained, output tokens/bytes, latency, and cost. Accept a model change only if it improves source-backed reference recall without an unsupported-entity regression or schema/validation failure. Current price inputs were not established by this audit, so cost must be preflighted when authorization is requested.

## 10. Limitations

- Test 2 has no replay cache, per-chunk output, token usage, response IDs, or persisted model ID.
- Stored PDF binaries are empty placeholders, so only extracted-page input equivalence is provable.
- The semantic mapping is intentionally small and enumerated in the crosswalk generator. No embedding, fuzzy model, or external lore was used.
- A single historical comparison cannot isolate model capability from prompt/schema pressure.
- No Test 3 rerun was performed because model execution was not authorized.

TEST 2 VS TEST 3 RECALL AUDIT + FIX: PASS
