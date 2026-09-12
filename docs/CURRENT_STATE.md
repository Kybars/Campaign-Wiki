# Current state — Campaign Wiki

Update this disposable implementation snapshot after every completed milestone. Durable rules belong in `AGENTS.md`.

## Version and baseline

- Package version: `0.4.7` (derived-recovery worktree pending commit)
- Snapshot HEAD: `bd39d94928167d8d819f2621bea089e610e5228a` (`feat: add failure and paid-call guards`)
- Latest completed milestone: M5 — Resumability, Failure Injection, and Paid-Call Guards
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

M5 treats a stored checkpoint that no longer passes schema or semantic validation as failed, then reruns it; it is never reused. `OPENAI_MAX_CALLS_PER_RUN` defaults to `40` and guards application-level OpenAI dispatches at runtime. Checkpoint reuse and local calls do not consume it; controlled semantic retries do. Recovery dry-runs report `REUSE`/`RUN`/`INVALIDATED`, planned OpenAI/local calls, retry ceiling, maximum allowed attempts, and `ALLOW`/`BLOCK`. Provider-internal SDK retry counts remain unobservable.

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

## Verification snapshot

- Latest deterministic suite: 31 test files, 262 tests passed.
- Successfully run for M5: lint, typecheck, test, build, all listed deterministic evaluations, and preflight.
- Available deterministic evaluations: `npm run evaluate:replay`, `npm run evaluate:enrichment`, `npm run evaluate:lean`, `npm run evaluate:enrichment-workload`, `npm run evaluate:extraction-workload`, and `npm run evaluate:checkpoints`.
- `npm run ai:preflight` performs no generation; `npm run smoke:local` needs an already running local model.

## Deferred work

1. M6 local Test 3 rehearsal.
2. Extraction schema/output economy optimization.
3. Final v0.4 economics/quality benchmark.
4. v0.5 editing and campaign maintenance.
5. v0.6 UX redesign.
6. Later multi-source/incremental ingestion.
7. Later authentication and secure player sharing.

## Next milestone

`M6 — Local Test-3-Scale Rehearsal`

- Exercise full and lean orchestration locally without OpenAI cost or official Test 3 mutation.
- Force interruption and checkpoint resume in an isolated rehearsal namespace or disposable campaign.
- Record local model, latency, schema/semantic failure rate, retries, and resume correctness.

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
