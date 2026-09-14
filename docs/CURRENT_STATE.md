# Current state — Campaign Wiki

Update this disposable implementation snapshot after every completed milestone. Durable rules belong in `AGENTS.md`.

## Version and baseline

- Package version: `0.4.9`
- Pushed baseline before v0.4.9: `3b439430463a6bb774bc10ca5ad90137b28649de`
- Latest completed milestone: v0.4.9 two-pass extraction architecture and controlled local diagnostics
- M4 migration: `20260911120000_v04_m4_ai_operation_checkpoints.sql`, applied to the linked Supabase project on 2026-09-12
- Latest targeted work: compact inventory pass → inventory-grounded rich pass, separate durable checkpoints/planning, controlled Ollama re-benchmark, and local inventory-pathology diagnostics
- Commit status: v0.4.9 architecture and diagnostic code/audits are ready to commit. Generated local model artifacts remain ignored.

## Experimental status — do not misread as production behavior

- The two-pass architecture is implemented and covered by deterministic tests.
- The compact names-plus-bounded-evidence inventory result is **diagnostic evidence only**. It is not integrated into the production Pass A schema, prompts, checkpoint identity, planner, or persistence path.
- The existing full metadata local-Qwen inventory contract is not reliable for the frozen benchmark: transport avoidance, smaller source chunks, and category partitioning did not yield complete coverage.
- Do not run the unchanged full 3+9+3 local benchmark or paid OpenAI validation from these findings. The next authorized design task is compact Pass A plus a small frozen recall validation.

## Current processing flow

```text
source chunk
  ↓
compact entity inventory
  ↓
validated authoritative inventory
  ↓
rich facts and relationships grounded to inventory IDs
  ↓
existing candidate representation
  ↓
reconciliation
  ↓
canonical graph
  ↓
lean projection
  ↓
transactional persistence
  ↓
Wiki Ready
```

- Default mode: `lean`.
- Optional/reference mode: `full`.
- Lean post-reconciliation enrichment calls: `0`.

## Provider coverage

- OpenAI supports inventory extraction, rich extraction, reconciliation, and full enrichment through the shared structured-output boundary.
- A local OpenAI-compatible endpoint supports those same three stages for development/rehearsal.
- Inventory/rich overrides fall back to the existing extraction override and then the provider-wide model; reconciliation and enrichment retain their existing fallbacks.
- Local extraction concurrency is independently configured and defaults to `1`; OpenAI extraction defaults to `3`.
- No local failure falls back to OpenAI. Local canonical persistence requires an explicit server-only acknowledgement and is only for a disposable rehearsal.

## Durability

M4 private `ai_operation_checkpoints` now store validated, reusable operation output for:

- extraction inventory and dependent rich operations per chunk;
- reconciliation decisions;
- full-enrichment operations and batches.

Checkpoint identity includes campaign/document scope, provider, exact model, mode where semantic, operation type/key, semantic input hash, upstream fingerprint, behavior version, and schema version. Output is revalidated before reuse. Failed output is never successful. Historical cache records remain readable but are not assigned checkpoint metadata they never stored.

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

- Latest deterministic suite: 32 test files, 272 tests passed at the live-inference phase gate.
- Successfully run for the recall fix: lint, typecheck, test, build, replay, lean, extraction-workload, checkpoint, and recall evaluations.
- The A/B verification passed lint, typecheck, 31 test files/262 tests, production build, recall evaluation, extraction-workload evaluation, and read-only A/B evaluation. Protected campaign timestamps/counts and the cached graph fingerprint remained unchanged.
- Available deterministic evaluations: `npm run evaluate:replay`, `npm run evaluate:enrichment`, `npm run evaluate:lean`, `npm run evaluate:enrichment-workload`, `npm run evaluate:extraction-workload`, `npm run evaluate:checkpoints`, `npm run evaluate:recall`, and `npm run evaluate:two-pass-extraction`.
- `npm run ai:preflight` performs no generation; `npm run smoke:local` needs an already running local model.
- `npm run evaluate:extraction-local` summarizes the completed isolated capture without rerunning it; `--dry-run` verifies the 15-attempt local-only plan before an initial capture.
- `npm run evaluate:extraction-local-two-pass` summarizes the completed isolated two-pass capture without rerunning it; its pre-capture `--dry-run` verified the local-only 15-inventory/maximum-15-rich plan.
- Ollama-baseline verification passed lint, typecheck, 31 test files/263 tests, the production build, focused provider tests, recall evaluation, extraction-workload evaluation, and saved local-baseline summary evaluation.
- Two-pass verification passed lint, typecheck, 32 test files/272 tests, production build, recall, historical extraction workload, checkpoint, deterministic two-pass evaluation, and local dry-run before inference. Final verification is recorded in the two-pass audit.

## Deferred work

1. Design a compact, source-grounded Pass A contract with deterministic IDs, then run a small frozen recall benchmark.
2. M6 local Test 3 rehearsal.
3. Extraction schema/output economy optimization.
4. Final v0.4 economics/quality benchmark.
5. v0.5 editing and campaign maintenance.
6. v0.6 UX redesign.
7. Later multi-source/incremental ingestion.
8. Later authentication and secure player sharing.

## Next milestone

`Compact inventory-contract design and small recall validation`

- Preserve the validated two-pass boundary and frozen benchmark.
- Preserve source grounding while designing the smallest proven reliable Pass A; do not integrate or run a full benchmark without a separately scoped prompt.
- Prefer a no-cost local diagnostic before requesting any paid OpenAI validation.
- Resume M6 only after the extraction boundary has usable live reliability evidence.

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
