# Local structured AI provider

Campaign Wiki defaults to the OpenAI provider. For development and orchestration rehearsal, enrichment can instead use an OpenAI-compatible local Chat Completions endpoint such as Ollama or LM Studio.

```dotenv
AI_PROVIDER=local
LOCAL_AI_BASE_URL=http://localhost:11434/v1
LOCAL_AI_MODEL=your-local-instruct-model
```

Start the local server, select a model it already has installed, and run `npm run ai:preflight`. The preflight checks endpoint reachability and model availability without mutating campaign data or making a paid OpenAI generation call. Campaign Wiki requests JSON and then validates it with the same Zod schemas, exact-key checks, evidence ownership rules, and Player-safety rules used for OpenAI output. It never falls back to OpenAI when the local endpoint fails.

To switch back, set `AI_PROVIDER=openai` and configure the existing server-side OpenAI key and stage model variables. Never prefix provider credentials or local endpoint variables with `NEXT_PUBLIC_`. Local-model results are development rehearsals, not the official OpenAI Test 3 benchmark.

Local dry-runs are always allowed. A live import or cached-recovery execution using local enrichment fails closed before it can replace canonical campaign data unless the server-only acknowledgement below is set exactly for a disposable/rehearsal campaign:

```dotenv
LOCAL_AI_ALLOW_PERSISTENCE=true
```

Do not enable that acknowledgement for a benchmark or production campaign. The enrichment cache and processing diagnostics identify local results separately from OpenAI results, including the configured model ID.

On Windows, install and start Ollama or LM Studio separately, load a suitable instruct model, update `.env.local`, run the deterministic test suite, and then run the preflight. Model installation is deliberately not automated by this repository.
