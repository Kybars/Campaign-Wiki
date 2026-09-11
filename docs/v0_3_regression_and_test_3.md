# v0.3 regression and Test 3 readiness

The normal suite and both evaluation scripts are deterministic fixture replays. They do not require OpenAI, Supabase, or network access. `evaluate:replay` rebuilds canonical graphs from saved candidate fixtures; `evaluate:enrichment` applies a saved enrichment output. Both report zero model calls.

Evaluation definitions:

- **merge count** is candidate entities minus canonical entities in that replay.
- **chronology coverage** is Event entities with at least one persisted chronology fact (`exact_date`, `relative_chronology`, context, sequence, or uncertainty), versus total Events.
- **empty/unsupported slots** are allowed rich-fact keys without a populated canonical fact, across the fixture's canonical entities; it is not a UI-field count.
- **fact evidence**, **relationship evidence**, and **entity-existence evidence** are reported separately.

For Test 3, preserve Test 2 unchanged, create a distinct campaign explicitly, import only once, and record actual stage model usage/cost diagnostics. Audit representative rich facts against excerpts, Player/DM separation, hierarchy, Quest/Event behavior, and the evaluation output. Do not treat deterministic fixture metrics as Test 3 results.

## Test 3 interruption and cached recovery

`Demonplague - Test 3` (`d14f9875-5ebf-46c6-b07e-d65a3e65c5f4`) began as the v0.3.8 benchmark. Its 9/9 Luna extraction chunks and Terra reconciliation completed, but the single large Terra enrichment classification response failed exact relationship completeness. The extraction and reconciliation caches remain preserved. v0.3.9 introduces bounded exact-key enrichment batches and performs recovery by reusing those exact cached stages, rerunning enrichment only. Historical failed enrichment usage remains explicitly unmeasured where it was not persisted.

The v0.3.9 cached recovery reused those stages and completed ten Terra classification responses, then failed final validation because a prominence citation crossed entity ownership. The persisted attempt recorded 115,526 input tokens, 115,085 cached-input tokens, 25,336 output tokens, 140,862 total tokens, and an estimated $0.327931. v0.3.10 validates each entity and summary against its own supplied evidence before later expensive stages; extraction and reconciliation remain untouched.

## v0.4 lean recovery semantics

As of v0.4.3, cached recovery and replay default to `lean`. A lean dry-run reuses the validated extraction and reconciliation caches, reconstructs the canonical graph, reports its counts and fingerprint, and plans zero enrichment/OpenAI calls and zero writes. An explicitly executed lean recovery applies DM-only visibility, unclassified prominence, canonical source summaries, and absent Player summaries/overviews before transactional graph replacement. Full v0.3-style enrichment remains available only with explicit `--mode=full` selection. The M2 verification read the official Test 3 cache but did not execute recovery or mutate Test 2/Test 3.
