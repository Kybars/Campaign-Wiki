# Current state — Campaign Wiki

Update this disposable implementation snapshot after every completed milestone. Durable rules belong in `AGENTS.md`.

## Version and baseline

- Package version: `0.4.5`
- Snapshot HEAD: `4d24e5cc95e1e604293af3ea3e46eaa09fd82edb` (`feat: add durable AI operation checkpoints`)
- Latest completed milestone: M4 — Durable Per-Operation Enrichment Checkpoints
- M4 migration: `20260911120000_v04_m4_ai_operation_checkpoints.sql`, applied to the linked Supabase project on 2026-09-12
- Working tree after this documentation task: not clean (context documentation pending commit)

## Current processing flow

```text
source
  ↓
extraction
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

- OpenAI supports extraction, reconciliation, and full enrichment through the shared structured-output boundary.
- A local OpenAI-compatible endpoint supports those same three stages for development/rehearsal.
- `OPENAI_EXTRACTION_MODEL`, `OPENAI_RECONCILIATION_MODEL`, and `OPENAI_ENRICHMENT_MODEL` fall back to `OPENAI_MODEL`; corresponding local overrides fall back to `LOCAL_AI_MODEL`.
- Local extraction concurrency is independently configured and defaults to `1`; OpenAI extraction defaults to `3`.
- No local failure falls back to OpenAI. Local canonical persistence requires an explicit server-only acknowledgement and is only for a disposable rehearsal.

## Durability

M4 adds private `ai_operation_checkpoints` for validated, reusable operation output:

- extraction chunks;
- reconciliation decisions;
- full-enrichment operations and batches.

Checkpoint identity includes campaign/document scope, provider, exact model, mode where semantic, operation type/key, semantic input hash, upstream fingerprint, behavior version, and schema version. Output is revalidated before reuse. Failed output is never successful. Historical cache records remain readable but are not assigned checkpoint metadata they never stored.

## Data and product behavior

- Lean persistence defaults entities, facts, and relationships to `dm_only`; prominence is unclassified/null.
- Source-backed canonical summaries and rich facts remain available without enrichment.
- Optional full enrichment can add prominence, visibility, audience summaries, and overviews.
- Relationships remain normalized and bidirectional in rendering; location containment remains authoritative and cycle-safe.
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

## Cost and economics snapshot

- Lean mandatory post-reconciliation calls: `0`.
- Historical Test 3 extraction: 9 calls / 199,945 total tokens / historical cost unavailable.
- Historical reconciliation: 1 call / 28,928 tokens / `$0.1457915`.
- Cumulative recorded enrichment recovery cost: `$3.3255693`, excluding extraction and unmeasured work.
- Extraction remains the main candidate for later economy optimization.

## Verification snapshot

- Latest deterministic suite: 30 test files, 258 tests passed.
- Successfully run for M4: `npm run lint`, `npm run typecheck`, `npm test`.
- Available deterministic evaluations: `npm run evaluate:replay`, `npm run evaluate:enrichment`, `npm run evaluate:lean`, `npm run evaluate:enrichment-workload`, `npm run evaluate:extraction-workload`, and `npm run evaluate:checkpoints`.
- `npm run ai:preflight` performs no generation; `npm run smoke:local` needs an already running local model.

## Deferred work

1. M5 broad failure/chaos matrix and paid-call guards.
2. Local Test 3 rehearsal.
3. Extraction schema/output economy optimization.
4. Final v0.4 economics/quality benchmark.
5. v0.5 editing and campaign maintenance.
6. v0.6 UX redesign.
7. Later multi-source/incremental ingestion.
8. Later authentication and secure player sharing.

## Next milestone

`M5 — Resumability, Failure Injection, and Paid-Call Guards`

- Expand deterministic interruption, malformed-output, provider, and invalidation coverage.
- Prove validated checkpoints reuse while failed operations rerun only after dependencies are satisfied.
- Add paid-call planning, retry ceilings, safety caps, and explicit developer authorization for recovery/benchmark execution.
- Ensure local-provider unavailability cannot trigger an OpenAI spend.
- Exercise a Test-3-scale synthetic interruption/resume workload with no duplicate validated operations.

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
