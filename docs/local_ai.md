# Local structured AI provider

Campaign Wiki defaults to the OpenAI provider. For development and orchestration rehearsal, extraction, reconciliation, and enrichment can instead use an OpenAI-compatible local Chat Completions endpoint such as Ollama or LM Studio.

```dotenv
AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://localhost:11434/v1
LOCAL_AI_MODEL=your-local-instruct-model
# Optional; each falls back to LOCAL_AI_MODEL.
LOCAL_AI_EXTRACTION_MODEL=
LOCAL_AI_RECONCILIATION_MODEL=
LOCAL_AI_ENRICHMENT_MODEL=
LOCAL_AI_EXTRACTION_CONCURRENCY=1
```

Start the local server, select models it already has installed, and run `npm run ai:preflight`. The preflight reports the extraction, reconciliation, and enrichment mapping and checks availability without generation or mutation. Campaign Wiki validates local output with the same Zod schemas, provenance rules, exact reconciliation coverage, evidence ownership rules, and Player-safety rules used for OpenAI output. It never falls back to OpenAI when the local endpoint fails.

For a safe real-server check using only the small repository fixture, run `npm run smoke:local`. It requires `AI_PROVIDER=local`, performs local extraction and reconciliation, builds the lean graph in memory, reports zero paid OpenAI calls, and performs no Supabase persistence. It does not download a model. Normal automated tests use deterministic mock providers and do not require Ollama or LM Studio.

To switch back, set `AI_PROVIDER=openai` and configure the existing server-side OpenAI key and stage model variables. Never prefix provider credentials or local endpoint variables with `NEXT_PUBLIC_`. Local-model results are development rehearsals, not the official OpenAI Test 3 benchmark.

Local dry-runs and the non-persisting fixture smoke are always allowed. A live import or cached-recovery/replay execution using local model output fails closed before it can replace canonical campaign data unless the server-only acknowledgement below is set exactly for a disposable rehearsal campaign:

```dotenv
LOCAL_AI_ALLOW_PERSISTENCE=true
```

Do not enable that acknowledgement for a benchmark or production campaign. Extraction cache model identity and processing diagnostics distinguish local stage results from OpenAI results. Historical caches remain readable and are not rewritten. Local results are development/rehearsal results, not official OpenAI quality benchmarks.

M4 checkpoints include the provider and exact model identity, so local output is never reused by OpenAI or vice versa. Compatible validated local operations can resume a deliberately acknowledged local rehearsal. Reused operations make no new call; missing local token counts remain `null` and are never priced as OpenAI usage. Lean mode still schedules no enrichment operations and creates no empty enrichment checkpoints.

On Windows, install and start Ollama or LM Studio separately, load a suitable instruct model, update `.env.local`, run the deterministic test suite, and then run the preflight. Model installation is deliberately not automated by this repository.
