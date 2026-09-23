# Current state — Campaign Wiki

Update this disposable implementation snapshot after every completed milestone. Durable rules belong in `AGENTS.md`.

## Version and baseline

- Package version: `0.6.6`
- v0.4 backend/extraction work is complete. v0.5 now includes durable GM curation and the coherent category/entity editing system.
- Manual entity type, prominence, visibility, quest status, and relationship visibility use explicit typed values plus manual-state flags. Graph replay refreshes document-derived data, then restores flagged GM choices by stable row identity.
- Category pages organize entities by prominence, with hierarchy/chronology alternatives and quest-status grouping. Player View hides empty categories and redirects known hidden pages to a non-leaking campaign notice.
- Pushed baseline before v0.4.9: `3b439430463a6bb774bc10ca5ad90137b28649de`
- Latest completed release: v0.6.6 graph extraction research checkpoint
- Imported canonical graphs now receive deterministic, per-entity-type prominence from conservative source mention/page counts plus unique canonical relationship counts. Fresh quests default to `not_started`; durable manual prominence and quest-status overrides remain replay-safe. The normal UI exposes only Major/Supporting/Minor and Ongoing/Not started/Finished, with legacy nulls displayed as Minor/Not started.
- M4 migration: `20260911120000_v04_m4_ai_operation_checkpoints.sql`, applied to the linked Supabase project on 2026-09-12
- v0.5 migration: `20260916192058_v05_durable_gm_curation.sql`, committed locally; remote application is pending because the linked CLI could not initialize its login role over the current network.
- v0.5.2 migration: `20260917091332_deterministic_entity_prominence.sql`, committed locally; it has not been applied remotely.
- Latest targeted work: dogfooding showed that duplicate entity names could make otherwise valid first-pass relationship endpoints ambiguous and discard those edges. Lean processing now reconciles only high-confidence duplicate candidates after graph first pass, preserves the raw first-pass output, re-resolves it through canonical names and approved aliases, and runs completeness against the reconciled inventory. Uncertain candidates remain separate for later manual review; duplicate detection is intentionally conservative, not complete.
- v0.6.4 prevents repeated edge boilerplate from inflating semantic occurrence, prominence, or coverage metrics even for raw-page callers. Adaptive recovery now partitions overloaded page windows by bounded target groups, so every suspicious multi-page zero-degree entity receives a recovery opportunity; coverage and rescue checkpoint identities were advanced accordingly.
- The graph research checkpoint includes V3, two-chunk, completeness, compact, span, and focused-window experiments. Generated model artifacts and private fixtures remain local-only.

## v0.6.6 graph research checkpoint

- On the frozen five-page Test 9 sample, single-call V3 accepted 82 relationships, touched 51/65 entities, and recovered 21/89 frozen relationships in 8,756 tokens. The original two-chunk run accepted 126 relationships, touched 61/65, and recovered 30/89 in 11,759 tokens; the hardened two-chunk prompt accepted 89, touched 54/65, and recovered 27/89 in 13,042 tokens. These are experimental results, not production quality claims.
- A targeted completeness retry returned 21 proposed relationships; a blanket sweep added 19 novel validated relationships but changed frozen recovery only from 21/89 to 22/89. Neither justifies a production completeness change from this sample alone. Two-chunk planning and union tests cover page assignment, complete output accounting, endpoint and segment validation, and provenance.
- Hardening work adds recurring variable-title edge masking, packed semantic evidence spans in the lean graph first pass, bounded occurrence-focused windows, segment/endpoint validation, checkpoint identities for request shapes, and explicit evaluator match classes. Raw-page provenance remains authoritative. Production model defaults are unchanged.
- The next experiment is multi-entity Claims. No Claims implementation is included in this checkpoint.

## Experimental status — do not misread as production behavior

- The two-pass architecture is implemented and covered by deterministic tests.
- The v3-compatible initial identity/page inventory remains independently reusable. Production's uncommitted v4 wrapper adds a dependent completeness substage and deterministic final-union identity; the rejected candidate harvester remains standalone experimental code and is not imported by production.
- V4 harvesting covered 42/42 literal hard references, but final authoritative recall fell to 72.1% with 80.5% bounded precision, 11/12 Quests, 1/2 Items, and 16,667 total model tokens. Both calls were valid and compact; the failure is semantic classification quality and workload, not structured-output reliability.
- A second compact semantic read over the same source plus a 330-token deterministic existing-inventory summary recovered Innenotdar and The Scourge. The final union reached 39/43 recall (90.7%), 93.2% bounded precision, 12/12 Quests, 2/2 Items, and 9,205 total tokens. NPC recall remained 8/11; Etinifi failed unchanged deterministic grounding; three obvious short/type variants survived as source-backed duplicate candidates.
- Current decision: `WOTBS_COMPACT_RELATIONSHIPS_FAILED`. Pass A was cryptographically tied to the frozen source and reused at 39/43 recall, 95.2% precision, 12/12 Quests, and 2/2 Items. The facts/aliases kernel returned valid JSON in 139.813 seconds, but manual audit found only canonical-name restatements; the relationships kernel truncated after 554.198 seconds at more than 50,152 characters. Exactly two local calls and no retry occurred. Keep all Rich repair work uncommitted pending a focused finite-relationship-output repair.
- Graph-core scorer decision: `GRAPH_SCORER_NORMALIZATION_FIXED`. The adapter passes canonical validated relationship types and scores through production inverse normalization; an exact evaluator-only layer handles conservative coarse label equivalence, including `leads` for broad organizational association and inverse `used by`. Saved outputs rescore at Qwen 7/12 (58.3%), Terra 8/12 (66.7%), and supported union 9/12 (75.0%): six both, one Qwen-only, two Terra-only, and three missed by both. Precision remains Qwen 26/26 and Terra 36/37; the sole unsupported Terra edge is `trillith created Torch of the Burning Sky`. Zero model/retry/repair/persistence/artifact writes occurred during rescore.
- Graph completeness decision: `LOCAL_GRAPH_COMPLETENESS_LOW_VALUE`. One local Qwen `v0-test2-graph-completeness-1` call reused the frozen 42-entity inventory and exact 26-edge first pass, returned 18 bounded edges in 33.270s, and produced 3 structurally novel edges. Manual audit found 0 supported, 2 unsupported, and 1 ambiguous; 11 outputs repeated the first pass and 3 used unknown endpoints. The 29-edge diagnostic union touched 34/42 entities but retained 12 label types and corrected gold recall stayed 7/12. The current contract is not justified for integration. Do not redesign immediately; if separately authorized, compare one Terra call under this identical frozen contract.
- Graph completeness final comparison: `TERRA_GRAPH_COMPLETENESS_VALIDATED`. Against the identical Qwen-first-pass baseline and frozen completeness contract, one Terra call returned 23/23 novel structurally valid edges, all source-supported on manual audit, with no endpoint or duplicate rejects. The 49-edge union touches 37/42 entities, has 29 label types, and raises corrected eligible-gold recall from 7/12 to 10/12 (83.3%). It recovers Leska’s advisor relation and the Longinus/Pilus brotherhood; Madness is returned as source-supported `member of trillith` but remains outside the frozen scorer’s `is_a` equivalence. Integrate first-pass graph + one completeness sweep behind current checkpoint/provider abstractions; do not add Rich facts/enrichment, then return to wiki rendering/dogfooding/manual correction.
- Luna completeness benchmark: `LUNA_COMPLETENESS_TERRA_LIKE`. On the identical frozen input, one OpenAI `gpt-5.6-luna` call returned 26 structurally valid novel edges: 26 supported, 0 unsupported, and 0 ambiguous (100% novel precision). Its 52-edge union touches 40/42 entities and matches Terra's 10/12 (83.3%) corrected gold recovery, including advisor, sibling, and containment recoveries. At 30.083s and approximately $0.0040 versus Terra's 40.747s and approximately $0.0407 for this fixture, `USE_LUNA` is the recommended graph-completeness provider; retain the same frozen single-sweep contract and do not ensemble models.

## Current processing flow

```text
source chunk
  ↓
compact entity inventory
  ↓
Pass A completeness
  ↓
final canonical entity inventory
  ↓
minimal graph first pass (raw output retained)
  ↓
deterministic duplicate candidates
  ↓
one conservative duplicate-identity adjudication when candidates exist
  ↓
deterministic merge + exact canonical-name/alias re-resolution
  ↓
one missing-relationships completeness sweep against the reconciled inventory
  ↓
deterministic normalization, provenance, and dedupe
  ↓
canonical relationship graph
  ↓
transactional persistence
  ↓
Wiki Ready
```

- Default mode: `lean`.
- Optional/reference mode: `full`.
- Lean Rich/full-reconciliation/enrichment calls: `0`; duplicate-identity adjudication adds at most one call when conservative candidates exist.
- Lean entity reconciliation is a distinct identity-only step, not Rich extraction: it cannot create entities, relationships, facts, summaries, evidence, names, or types.

## Provider coverage

- OpenAI supports inventory extraction, independent graph extraction/completeness, reconciliation, and full enrichment through the shared structured-output boundary.
- A local OpenAI-compatible endpoint supports those same stages for development/rehearsal.
- Graph extraction and completeness may select independent providers/models; inventory/rich overrides retain their existing extraction fallback.
- Duplicate adjudication follows the shared provider/model configuration, can be overridden as its own stage, and makes zero calls when deterministic candidate generation finds no candidates.
- Local extraction concurrency is independently configured and defaults to `1`; OpenAI extraction defaults to `3`.
- No local failure falls back to OpenAI. Local canonical persistence requires an explicit server-only acknowledgement and is only for a disposable rehearsal.

## Durability

M4 private `ai_operation_checkpoints` now store validated, reusable operation output for:

- extraction inventory and dependent graph operations per chunk;
- reconciliation decisions;
- lean duplicate-identity adjudication;
- full-enrichment operations and batches.

Checkpoint identity includes campaign/document scope, provider, exact model, mode where semantic, operation type/key, semantic input hash, upstream fingerprint, behavior version, and schema version. Output is revalidated before reuse. Failed output is never successful. Historical cache records remain readable but are not assigned checkpoint metadata they never stored.

Lean graph first-pass checkpoints remain independent of duplicate adjudication. Duplicate-adjudication identity includes the final unmerged inventory, deterministic candidate set, and raw first-pass relationships. Completeness identity includes the merged inventory and re-resolved first-pass graph, so a changed merge invalidates completeness without invalidating reusable first-pass output.

Current deterministic graph correction: explicit NPC `same person as` first-pass edges merge inventory identities before duplicate candidacy; formal/short polity variants can be offered to conservative adjudication; and one exact occurrence source per matched page is unioned with inventory evidence during prominence. This invalidates duplicate adjudication, merged-inventory-dependent graph completeness, and deterministic graph aggregation; page inventory and first-pass graph extraction checkpoints remain reusable.

Rich extraction's upstream fingerprint includes the validated inventory and its exact operation identity. Inventory changes invalidate rich reuse; a rich-model-only change preserves inventory reuse. Corrupt inventory forces both substages to rerun, while corrupt rich output preserves inventory reuse.

M5 treats a stored checkpoint that no longer passes schema or semantic validation as failed, then reruns it; it is never reused. `OPENAI_MAX_CALLS_PER_RUN` defaults to `40` and guards application-level OpenAI dispatches at runtime. Checkpoint reuse and local calls do not consume it; controlled semantic retries do. Recovery dry-runs report `REUSE`/`RUN`/`INVALIDATED`, planned OpenAI/local calls, retry ceiling, maximum allowed attempts, and `ALLOW`/`BLOCK`. Provider-internal SDK retry counts remain unobservable.

## Data and product behavior

- Lean persistence defaults entities, facts, and relationships to `dm_only`; prominence is unclassified/null.
- Source-backed canonical summaries and rich facts remain available without enrichment.
- Optional full enrichment can add prominence, visibility, audience summaries, and overviews.
- Relationships remain normalized and bidirectional in rendering; location containment remains authoritative and cycle-safe.
- Extraction's false-negative preference does not justify omitting clearly named, source-backed minor entities or entities with few facts.
- Player View fails closed: no hidden data leaks through content, navigation, search, sources, counts, hierarchy, timelines, or fallback text.
- Current view selection is a DM/Player preview, not authentication.

## Test 3 benchmark snapshot

- 112 entities
- 502 facts
- 145 relationships
- Fingerprint: `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`
- Test 2 is unchanged.
- Test 3 historical failed and recovery runs are preserved.
- No new official benchmark run has occurred since this snapshot.

## Test 2 vs Test 3 recall audit

- Source comparability: `EQUIVALENT_CONTENT_WITH_FORMATTING_DIFFERENCES`; all 160 extracted page rows, text lengths, and ordered raw/normalized hashes match, while stored PDF objects are empty and cannot prove original binary identity.
- Test 2 authoritative campaign: `a13d54b5-74e6-45e3-9f7f-9dcad214d7d3`, unchanged at 156 entities and 262 relationships.
- Crosswalk: 98 distinct recalled Test 2 identities, 6 correctly removed Test 2 duplicate rows, 52 source-backed extraction false negatives, 0 reconciliation losses, and 0 unresolved rows.
- Test 3-only: 13 new valid identities and 1 duplicate/noise identity.
- Primary cause: extraction prompt/schema/output pressure. Luna may be a contributor, but Test 2's exact model is not persisted, so model capability cannot be isolated.
- Remediation: a narrow extraction prompt guard preserves clearly named, source-backed minor entities and requires a final category/endpoint completeness check. Schema, model routing, chunks, reconciliation, and paid-call policy are unchanged.
- The authorized Luna-versus-Terra A/B is complete; see the next section. No production model setting changed.
- Audit artifacts: `docs/audits/test2_test3_recall_audit.md` and `docs/audits/test2_test3_entity_crosswalk.json`.

## Luna versus Terra extraction A/B

- Controlled sample: chunks 3, 5, and 4; 145 frozen reference occurrences, including 45 historical misses.
- Six successful generation calls: 3 Luna and 3 Terra, with SDK retries disabled; no reconciliation, enrichment, campaign, official cache, or official checkpoint writes.
- Occurrence-weighted Luna: 69/145 recall (`47.6%`), frozen-reference precision `87.3%`, F1 `61.6%`, and 10/45 historical misses recovered (`22.2%`).
- Occurrence-weighted Terra: 99/145 recall (`68.3%`), frozen-reference precision `81.8%`, F1 `74.4%`, and 25/45 historical misses recovered (`55.6%`).
- Manual grounding review found every reference-bounded false positive source-supported; the lower frozen-reference precision reflects valid identities outside the frozen, non-exhaustive reference as well as one type disagreement per model.
- Terra produced 309 valid facts and 71 relationships versus Luna's 208 and 42, while using 40.3% more output tokens and taking 59.4% longer.
- Terra recorded cost: `$0.5635378` for three chunks; Luna cost is unavailable because repository pricing does not know that model ID. Nine-chunk Terra extraction extrapolates to `$1.6906134` for this sample.
- Decision: `REDESIGN_EXTRACTION_PIPELINE`. Terra is materially stronger, but both models remain below 90% recall and both retain systematic category failures; Terra recalled zero of nine quest occurrences.
- Production extraction remains `gpt-5.6-luna`. Report: `docs/audits/luna_terra_extraction_ab.md`.

## Ollama single-pass extraction baseline

- Local environment: Ollama `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, 32,768 context, reasoning disabled, temperature 0, extraction concurrency 1, and persistence disabled.
- The strict JSON schema is derived from the production Zod contract. The production prompt, schema, ontology, chunking, validation, and single-pass architecture were unchanged.
- First scored run on frozen chunks 3/5/4: 0/3 valid outputs; all ended as client-visible transport disconnects after 302.225–304.599 seconds.
- All-nine stress run: 0/9 valid outputs; nine transport failures; mean 304.878 seconds, median 304.842 seconds, p95 305.528 seconds; no response reported usage or content.
- Second scored run: 0/3 valid outputs with identical failure-class stability and aggregate latency only 5.346 seconds above run 1.
- Recall, precision, F1, per-type recall, and historical-miss recovery are unavailable rather than zero because no scored operation returned a valid extraction.
- Decision: `LOCAL_SINGLE_PASS_SCHEMA_OVERLOADED`. A tiny strict schema succeeds, while the full production contract failed all 15 controlled attempts at a repeatable five-minute boundary. Evidence is sufficient to proceed to the separately scoped two-pass redesign.
- Safety: 0 OpenAI, reconciliation, or enrichment calls; 0 campaign, official cache, or checkpoint writes. Test 2, original Test 3, Test 3 Recovery, and the cached graph fingerprint remained unchanged.
- Report: `docs/audits/ollama_single_pass_extraction_baseline.md`. Raw captures: ignored `artifacts/extraction-local-baseline/`.

## Two-pass extraction and local re-benchmark

- New imports run an authoritative compact entity inventory per chunk, followed by rich facts/relationships grounded to those inventory IDs, then assemble the unchanged candidate contract for existing reconciliation.
- Pass B must cover every validated inventory ID and cannot add entities or unknown endpoints; `suspected_inventory_misses` remains a non-persisted diagnostic.
- Inventory and rich operations are independently checkpointed and planned. Fresh `N` chunks report `N + N = 2N` extraction operations; rich identity depends on the validated inventory and its exact operation identity.
- Server-only inventory/rich model overrides follow substage → extraction-stage → provider-wide fallback. Production OpenAI model choices are unchanged.
- Deterministic dense/curated coverage passes and proves inventory breadth, ID grounding, corruption/restart semantics, and unchanged merge/distinctness behavior.
- Controlled Ollama re-benchmark used the same `qwen3.5:9b` digest, 32K context, temperature 0, reasoning none, concurrency 1, source chunks, and frozen reference.
- Result: scored run 1 inventory `0/3`, stress inventory `0/9`, scored run 2 inventory `0/3`; every inventory call failed as a transport disconnect after 302.442–304.968 seconds. Rich calls were correctly not run.
- Recall, precision, F1, per-type recall, recovered misses, output size, and token usage are unavailable rather than zero because no valid inventory was returned.
- Decision: `TWO_PASS_STILL_OVERLOADED`. The live result attributes the local overload to the compact inventory stage, before rich output pressure.
- Safety: 0 OpenAI, reconciliation, enrichment, campaign, official cache, or official checkpoint writes/calls. Report: `docs/audits/two_pass_ollama_extraction_benchmark.md`.

## Ollama 300-second transport diagnosis

- One streamed and one request-scoped 900-second-timeout non-streaming inventory call used the exact frozen scored chunk 3, unchanged `qwen3.5:9b` digest/context/prompt/schema/temperature/reasoning/concurrency, and no persistence.
- Both passed the historical 302–305 second boundary but terminated at 442.531 and 442.388 seconds with incomplete JSON; strict parsing and inventory validation failed closed.
- The historical captures did not retain a nested fetch cause, so a historical Undici timeout code cannot be reconstructed. Future local transport failures now record bounded outer/nested cause metadata, Node/Undici runtime, elapsed time, and deterministic transport classification.
- Decision: `MODEL_OR_SCHEMA_PRESSURE_CONFIRMED`. Avoiding the client boundary did not yield a completed strict inventory result; do not treat transport handling as the sufficient fix.
- Safety: 0 OpenAI calls, 2 local calls, 0 campaign/reconciliation/enrichment/official benchmark writes. Report: `docs/audits/ollama_300s_transport_diagnosis.md`.

## Ollama inventory chunk-pressure experiment

- Frozen scored chunk 3 was subdivided at ordered page boundaries into two halves and four quarters with complete, no-overlap source coverage; all model, schema, prompt, validation, and long-timeout transport settings were unchanged.
- Half-size calls: `0/2` valid; both reached the 32,768 total-token ceiling and returned incomplete JSON after 551.485s and 562.336s.
- Quarter-size calls: `3/4` valid. Pages 42–45, 46–49, and 50–53 completed in 97.764s, 66.910s, and 63.536s; pages 38–41 exhausted 32,768 total tokens and failed after 614.668s.
- Decision: `SMALLER_CHUNKS_PARTIALLY_HELP`. Smaller sources create a successful regime for three quarters but do not reliably cover the complete frozen interval, so union/recall quality is unavailable rather than zero.
- Safety: 0 OpenAI calls, 6 local generation calls, 0 campaign/reconciliation/enrichment/official benchmark writes. Report: `docs/audits/ollama_inventory_chunk_pressure_experiment.md`.

## Ollama inventory category-partition experiment

- Exact frozen pages 38–41 were requested once per canonical entity type under the same model/digest/context/settings and long-timeout transport.
- Event (`12`, 31.507s) and Quest (`20`, 62.166s) validated; NPC, Deity, Location, Faction, Item, and Other all saturated 32,768 total tokens and returned incomplete JSON after 587.864–616.382s.
- Decision: `CATEGORY_PARTITION_DOES_NOT_SOLVE_PRESSURE`. Category breadth is not the sole source; six independent literal-type requests remain pathological. Full union and recall are unavailable rather than zero.
- Safety: 0 OpenAI calls, 8 local generation calls, 0 campaign/reconciliation/enrichment/checkpoint/cache writes. Report: `docs/audits/ollama_inventory_category_partition_experiment.md`.

## Ollama inventory generation-pathology diagnosis

- Existing failed Deity output was not retained beyond bounded metrics: 109,651 characters, 29,423 completion tokens, and 32,768 total tokens before malformed JSON. A streamed recapture failed before any payload arrived, so repetition statistics are unavailable rather than invented.
- On the same frozen pages and Deity target, strict names-only inventory validated with 5 names in 9.091s/3,689 tokens; strict name plus 240-character bounded evidence validated with 11 names in 17.647s/4,188 tokens.
- Decision: `COMPACT_INVENTORY_CONTRACT_WORKS`. Current inventory metadata shape is implicated; compact source-grounded discovery is stable in this narrow control, but requires a separate recall benchmark before production design.
- Safety: 0 OpenAI calls, 3 local calls, 0 campaign/reconciliation/enrichment/checkpoint/cache writes. Report: `docs/audits/ollama_inventory_generation_pathology.md`.

## Compact production Pass A and frozen inventory benchmark

- Production inventory output is now `name`, `type`, and one source-resolving evidence record (240-character maximum). Temporary IDs are deterministic application output, not model output; aliases moved to inventory-ID-grounded Pass B.
- Inventory/rich behavior and schema versions advanced to v2. Stored raw inventory is revalidated and must reproduce the stored authoritative inventory exactly; inventory fingerprint changes invalidate rich output.
- Frozen Ollama scored chunks: chunk 3 invalid after 439.191s, chunk 5 invalid after 428.733s, chunk 4 valid after 394.015s. Chunk 4 returned 99 validated entities, 0 ID collisions, 73.5% recall, 36.4% reference-bounded precision, 48.6% F1, and 8/12 historical misses recovered.
- Decision: `COMPACT_PASS_A_PARTIALLY_RELIABLE`. Full-chunk pressure remains; overall recall is unavailable because only 1/3 intervals validated.
- Safety: 0 OpenAI, 3 local inventory calls, 0 rich/reconciliation/enrichment calls, and 0 campaign/checkpoint/official-cache writes. Report: `docs/audits/compact_pass_a_inventory_benchmark.md`.

## WotBS Stage 1 small correctness fixture

- Frozen real-document fixture: `War of the Burning Sky Campaign Guide` PDF pages 10-12, 3 pages, 11,083 extracted characters, one production chunk, PDF SHA-256 `509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990`, normalized-text SHA-256 `b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281`.
- The sole compact Pass-A attempt at the frozen `qwen3.5:9b` digest and 32,768 context returned malformed inner JSON: an unterminated string at character 108,215. No retry, Pass B, candidate assembly, reconciliation, or persistence ran.
- Decision: `WOTBS_STAGE1_PASS_A_FAILED`. This proves the compact local Pass A is not yet reliable even on the small Stage-1 correctness fixture; it is not a production-scale conclusion.
- Safety: 0 OpenAI calls, 1 local generation, 0 campaign/checkpoint/cache writes, and no gold-reference exposure. Report: `docs/audits/wotbs_stage1_end_to_end.md`.

## WotBS Stage 1 Pass-A identity/page grounding repair

- Diagnostic identity-only (`name`, `type`) was compact and valid in 17.569s but had only 53.5% frozen-reference recall, including 0/12 Quests. Adding one supporting page locator remained compact and valid in 29.504s with 90.7% recall, 12/12 Quests, 2/2 Items, and 43/43 exact deterministic page groundings.
- Production Pass A now emits only `name`, `type`, and `page`. Application code resolves the page, prefers an exact normalized name match, permits a tightly bounded deterministic token-anchor fallback only for inferred Event/Quest labels, selects one source-derived excerpt capped at 240 characters, excludes failed groundings, and assigns IDs from source fingerprint + normalized type/name + page. Model-generated excerpts are removed from the production contract.
- Inventory behavior/schema identity is v3 (`v0.4-identity-page-grounding-3`, contract 3); prior v2 excerpt checkpoints invalidate. Grounded validated inventory remains in the rich dependency fingerprint, and rich-model-only changes still preserve inventory reuse.
- The sole repaired production Pass-A call validated in 29.919s with 39 authoritative entities, 39 deterministic IDs, 0 collisions, 0 grounding exclusions, and 0 diagnostics. Frozen-reference recall was 86.0%, with 12/12 Quests and 2/2 Items but weak NPC/Event recall.
- Decision: `WOTBS_PASS_A_RELIABLE_RECALL_LOW`. The output contract degeneration is repaired on this fixture, but the >=90% supported-entity recall target is not met. Pass B was intentionally not run.
- Safety: 0 OpenAI, exactly 3 new local calls, 0 Pass-B/reconciliation/enrichment calls, 0 campaign/checkpoint/cache writes, and 0 gold leakage. Report: `docs/audits/wotbs_stage1_pass_a_identity_grounding_repair.md`.

## Test 3 derived lean recovery

- Usable recovery campaign: `Demonplague - Test 3 Recovery` (`1151fb31-876b-4277-9718-76313c1c8d98`), status `complete`.
- Derived from original Test 3 `d14f9875-5ebf-46c6-b07e-d65a3e65c5f4` and extraction cache `1ad99ac3-6cf5-4731-bf1e-4736109f0de8`.
- Reconstructed `112 / 502 / 145` with fingerprint `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`.
- Lean defaults are all `dm_only`; Player summaries and campaign overviews are absent; recovery used 0 extraction, reconciliation, enrichment, OpenAI, and local model calls.
- The original failed Test 3 remains reserved for later controlled enrichment testing. The recovery script creates no enrichment cache or AI-operation checkpoint.

## Cost and economics snapshot

- Lean mandatory post-reconciliation calls: `0`.
- Historical Test 3 extraction: 9 calls / 199,945 total tokens / historical cost unavailable.
- Historical reconciliation: 1 call / 28,928 tokens / `$0.1457915`.
- Cumulative recorded enrichment recovery cost: `$3.3255693`, excluding extraction and unmeasured work.
- Extraction remains the main candidate for later economy optimization.
- The A/B added a known Terra estimate of `$0.5635378`; the combined experiment total is unavailable because Luna pricing is absent rather than guessed.
- The Ollama baseline made 15 local extraction attempts and 0 paid calls. Failed local usage was not reported and remains `null`, never zero or priced as OpenAI usage.

## Verification snapshot

- Latest deterministic suite: 38 test files, 299 tests passed before the repaired production WotBS call; lint, typecheck, and production build also passed.
- Successfully run for the recall fix: lint, typecheck, test, build, replay, lean, extraction-workload, checkpoint, and recall evaluations.
- The A/B verification passed lint, typecheck, 31 test files/262 tests, production build, recall evaluation, extraction-workload evaluation, and read-only A/B evaluation. Protected campaign timestamps/counts and the cached graph fingerprint remained unchanged.
- Available deterministic evaluations: `npm run evaluate:replay`, `npm run evaluate:enrichment`, `npm run evaluate:lean`, `npm run evaluate:enrichment-workload`, `npm run evaluate:extraction-workload`, `npm run evaluate:checkpoints`, `npm run evaluate:recall`, and `npm run evaluate:two-pass-extraction`.
- `npm run ai:preflight` performs no generation; `npm run smoke:local` needs an already running local model.
- `npm run evaluate:extraction-local` summarizes the completed isolated capture without rerunning it; `--dry-run` verifies the 15-attempt local-only plan before an initial capture.
- `npm run evaluate:extraction-local-two-pass` summarizes the completed isolated two-pass capture without rerunning it; its pre-capture `--dry-run` verified the local-only 15-inventory/maximum-15-rich plan.
- Ollama-baseline verification passed lint, typecheck, 31 test files/263 tests, the production build, focused provider tests, recall evaluation, extraction-workload evaluation, and saved local-baseline summary evaluation.
- Two-pass verification passed lint, typecheck, 32 test files/272 tests, production build, recall, historical extraction workload, checkpoint, deterministic two-pass evaluation, and local dry-run before inference. Final verification is recorded in the two-pass audit.

## Deferred work

1. Repair focused WotBS NPC/Event recall while preserving the validated identity/page grounding contract.
2. M6 local Test 3 rehearsal.
3. Extraction schema/output economy optimization.
4. Final v0.4 economics/quality benchmark.
5. v0.5 editing and campaign maintenance.
6. v0.6 UX redesign.
7. Later multi-source/incremental ingestion.
8. Later authentication and secure player sharing.

## Active lean graph core

New lean imports use the graph-first path: semantic-text inventory → final deterministic inventory → relationship extraction over packed semantic evidence spans → authoritative pair-decision entity merging → deterministic semantic coverage analysis → one bounded adaptive page-window gap round → evidence-aware relationship reconciliation for repeated endpoint pairs → exact raw-source provenance union and persistence. The former unconditional per-chunk relationship-completeness sweep is not part of production.

The active lean path does not call Rich facts, Rich relationships, reconciliation, or enrichment. It persists no atomic rich facts and no generated summaries. The legacy Rich/enrichment path remains available only for explicit `full` compatibility/reference runs, and existing stored campaigns remain readable.

Graph extraction, entity reconciliation, adaptive gap recovery, and relationship semantic reconciliation use provider-aware operation checkpoints and OpenAI call-budget accounting. Gap calls are planned from suspicious semantic source windows before dispatch; each window is attempted at most once and no recursive rescue occurs. Single relationship instances bypass semantic reconciliation. Local stages retain the existing `LOCAL_AI_ALLOW_PERSISTENCE` guard and never fall back to OpenAI.

Raw page text remains unchanged and is used only for quote verification and exact provenance. Cleaned, recurring-boilerplate-masked semantic text drives extraction, reconciliation context, occurrence counts, prominence, coverage, nearby-entity detection, and gap inputs. Relationship provenance is always an exact raw-page slice, never model-generated evidence.

v0.6.4 internal identities: entity reconciliation contract 5; graph extraction contract 3; adaptive relationship rescue contract 3; relationship semantic reconciliation contract 1; graph-core contract 2; lean observability audit schema 3. Behavior identities use the version declared with each stage so stale checkpoints cannot mask changed semantics.

The historical WotBS development pairing was local `qwen3.5:9b` for first-pass graph extraction and OpenAI `gpt-5.6-luna` for blanket completeness. v0.6.1 retains that benchmark history but production now uses the configured graph-completeness provider only for bounded adaptive gap recovery and relationship semantic reconciliation. The private saved artifacts remain local-only.

## Next milestone

Freeze backend extraction. Move to wiki rendering + dogfooding + manual correction.

## Future workflow contract

Future milestone prompts should normally begin with:

```text
Read:
1. AGENTS.md
2. docs/CURRENT_STATE.md
3. the active milestone section of IMPLEMENTATION_PLAN_V0_4.md
4. only task-relevant code/tests
```

Do not perform a broad repository scan unless the targeted files reveal an unresolved dependency.
