# v0.3 regression and Test 3 readiness

The normal suite and both evaluation scripts are deterministic fixture replays. They do not require OpenAI, Supabase, or network access. `evaluate:replay` rebuilds canonical graphs from saved candidate fixtures; `evaluate:enrichment` applies a saved enrichment output. Both report zero model calls.

Evaluation definitions:

- **merge count** is candidate entities minus canonical entities in that replay.
- **chronology coverage** is Event entities with at least one persisted chronology fact (`exact_date`, `relative_chronology`, context, sequence, or uncertainty), versus total Events.
- **empty/unsupported slots** are allowed rich-fact keys without a populated canonical fact, across the fixture's canonical entities; it is not a UI-field count.
- **fact evidence**, **relationship evidence**, and **entity-existence evidence** are reported separately.

For Test 3, preserve Test 2 unchanged, create a distinct campaign explicitly, import only once, and record actual stage model usage/cost diagnostics. Audit representative rich facts against excerpts, Player/DM separation, hierarchy, Quest/Event behavior, and the evaluation output. Do not treat deterministic fixture metrics as Test 3 results.
