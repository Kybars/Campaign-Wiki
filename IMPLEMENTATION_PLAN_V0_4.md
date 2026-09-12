# Campaign Wiki — v0.4 Implementation Plan

## Sprint Theme

**Make campaign processing economically sustainable, provider-independent, and resumable while preserving the source-backed wiki quality established in v0.3.**

v0.4 is no longer primarily an “add more enrichment” sprint.

The Test 3 experience demonstrated that a technically correct enrichment design can still be the wrong production default if it requires dozens of model calls, takes too long, loses validated work after interruption, or spends money on decisions that a GM can make more safely and accurately.

The central v0.4 question is:

> **What is the minimum AI work required to produce a useful Campaign Wiki, and how do we make any additional AI work explicit, optional, reusable, and affordable?**

The central engineering rule is:

> **A successfully validated AI operation becomes durable work immediately and should not need to be repurchased after an interruption.**

The central product rule is:

> **AI should automate transcription, extraction, linking, and tedious organization. The GM should own authorial campaign decisions such as what matters, what players know, and what changes during play.**

---

# Document Authority and Inherited Architecture

This is the authoritative implementation roadmap for the v0.4 sprint.

Documentation hierarchy:

1. `PRODUCT_SPEC.md` — evergreen product purpose, durable information model, user-control philosophy, provenance/visibility/security principles.
2. `IMPLEMENTATION_PLAN_V0_4.md` — authoritative v0.4 scope, sequencing, gates, and acceptance criteria.
3. Current codebase — source of truth for what is actually implemented.
4. `docs/v0_3_regression_and_test_3.md` — benchmark/history source for v0.3/Test 3 facts.
5. Older implementation plans — historical only.

Do not read older implementation plans by default.

v0.4 inherits and must preserve:

- canonical global reconciliation
- Deity as an entity type
- Enemy as a role/tag, not an entity type
- cross-type reconciliation
- one stored logical relationship with bidirectional presentation
- relationship normalization/deduplication
- recursive physical location containment with cycle protection
- source-backed rich facts
- fact-level provenance
- entity-existence evidence distinct from fact evidence
- conservative extraction/reconciliation
- universal prominence concept
- entity/fact/relationship `dm_only | player_visible`
- separate GM/Player summaries where present
- centralized Player-safe read model
- fail-closed Player filtering
- no render-time AI
- search independent of prominence
- compact wiki/reference presentation
- Vercel upload protection
- Supabase RLS/service-role security
- replay/cache history
- Test 2 immutability
- Test 3 historical audit trail

---

# 1. Why v0.4 Changed Direction

The v0.3/Test 3 pipeline proved that post-reconciliation enrichment can become disproportionately expensive and fragile.

At Test 3 scale the canonical graph already contains:

- 112 canonical entities
- 502 canonical facts
- 145 canonical relationships

before enrichment.

The v0.3.9 enrichment design expected roughly:

- 1 entity classification call
- 6 fact classification calls
- 3 relationship classification calls
- 10 GM summary calls
- up to 10 Player summary calls
- 2 overview calls

for approximately 32 successful-path enrichment calls.

A failed v0.3.9 recovery completed 10 Terra responses before a later validation failure. Those 10 calls alone used:

- 115,526 input tokens
- 115,085 cached input tokens
- 25,336 output tokens
- 140,862 total tokens
- recorded estimated cost: `$0.327931`

The later v0.3.10 recovery was blocked by exhausted API credits before a usable response was recorded.

These failures reveal three separate problems:

1. **Development economics** — paid models should not be our primary debugger.
2. **Production economics** — dozens of enrichment calls per user PDF may not justify their marginal value.
3. **Durability** — successful validated operations should survive later failure/interruption.

v0.4 addresses all three.

---

# 2. Product Strategy for v0.4

## 2.1 Core wiki versus optional enrichment

The product must distinguish:

### Core campaign knowledge

High-value work required to build the interconnected wiki:

- PDF text extraction
- candidate entity/fact/relationship extraction
- source evidence
- reconciliation/deduplication
- canonical graph
- normalized relationships
- location hierarchy
- rich source-backed article facts
- Quest/Event discovery
- cross-links/searchable entries

### Optional enrichment

Useful presentation/organization assistance that may not justify mandatory AI cost:

- campaign-relative prominence classification
- automatic entity visibility classification
- automatic fact visibility classification
- automatic relationship visibility classification
- GM summaries for every entity
- Player summaries for every visible entity
- GM campaign overview
- Player campaign overview

The existing full enrichment path should remain available during v0.4 as a comparison/reference mode until evidence supports deleting or replacing it.

Do not remove working full-enrichment code merely because it is no longer expected to be the default.

## 2.2 Human judgment is not a failure of automation

Some campaign decisions are inherently authorial:

- which NPC is important to this GM's campaign
- whether an obscure entity has become major during play
- what players currently know
- whether a secret has been revealed
- whether an NPC is now dead/missing
- whether a quest is active/completed
- faction standing toward the party

The GM is usually a better source for these decisions than the uploaded PDF.

v0.4 should therefore avoid paying AI to make every authorial decision during import.

v0.5 will provide direct editing/review controls.

Until then, v0.4 must use safe defaults and/or deterministic suggestions rather than silently requiring expensive AI classification.

## 2.3 Provider choice and processing mode are separate concepts

Do not conflate:

### Provider

Who performs a model operation:

- `openai`
- `local`
- mocked test provider

### Processing mode

Which operations the product chooses to perform:

- lean/core
- selectively assisted
- full enrichment/reference

A local provider may run the full workflow for testing.
An OpenAI provider may run only a tiny optional enrichment.
These are orthogonal decisions.

---

# 3. Goals

v0.4 should:

1. Make deterministic and local development possible without consuming OpenAI credits.
2. Quantify the actual marginal value, call count, latency, and cost of each enrichment stage.
3. Make the default GM wiki capable of completing without mandatory full enrichment.
4. Define safe no-AI defaults for prominence/visibility/summaries where required by the existing data/read model.
5. Preserve the full v0.3 enrichment path as an optional/reference path until comparison is complete.
6. Extend provider abstraction as far as useful so new end-to-end development imports can run locally.
7. Persist validated enrichment operations independently.
8. Resume after process interruption, timeout, malformed structured output, semantic validation failure, or 429/exhausted credits.
9. Never reuse cached model output across incompatible provider/model/prompt/schema/graph/input identities.
10. Show exact planned paid operations before recovery/developer execution.
11. Keep local-model results clearly separated from official benchmark/production output unless explicitly persisted.
12. Finish with an evidence-based Test 3 economics/quality comparison.
13. Enter v0.5 with a stable processing foundation rather than an expensive immutable auto-enrichment pipeline.

---

# 4. Explicit Non-Goals

Do not implement in v0.4:

- broad manual fact editor
- manual entity creation UI
- manual relationship creation UI
- merge/split UI
- reclassify-Other UI
- polished prominence controls
- polished Reveal/Hide fact controls
- party-standing editing
- quest-state editing
- session-by-session campaign-state editing
- real DM/player authentication
- per-player/per-party authorization
- large visual redesign
- permanent desktop navigation redesign
- rich contextual sidebars
- multi-document incremental campaign ingestion
- OCR/image-only PDF support
- VTT integration
- Discord/Notion/Obsidian integrations
- universal cross-fact timeline
- autonomous campaign-management agents

Those belong to v0.5, v0.6, or later.

Small developer-only controls/flags required to test processing modes are allowed.

---

# 5. Durable Product Rules

Throughout v0.4:

1. False negatives are preferable to invented facts or false merges.
2. Every displayed extracted fact remains evidence-backed.
3. Evidence ownership checks remain strict.
4. Player visibility remains fail-closed.
5. No Player summary may use GM-only information.
6. No render-time model calls.
7. Relationship normalization remains.
8. Location containment remains authoritative.
9. Search must continue to find Minor entities.
10. Prominence controls presentation, not existence.
11. No local-provider failure may silently fall back to a paid provider.
12. No paid model work may occur in deterministic tests.
13. Dry-run means no writes and no model calls.
14. A cache hit is valid only when its complete operation identity matches.
15. Invalid model output is never silently “fixed” by stripping bad keys/evidence.
16. Test 2 remains immutable.
17. Test 3 history remains preserved even if its final result is recovered under a later v0.4 path.
18. Development convenience must not weaken production provenance/security.

---

# 6. Target Processing Architecture

```text
PDF
 ↓
page-preserving text extraction
 ↓
candidate extraction
 ↓
global reconciliation
 ↓
canonical source-backed graph
 ↓
WIKI READY (lean/core mode)
 │
 ├── optional deterministic organization
 ├── optional AI-assisted prominence
 ├── optional AI summaries
 ├── optional AI campaign overview
 └── optional/full legacy enrichment
```

The exact lean defaults are **not** to be guessed before Milestone 1's audit.

Milestone 1 must determine how the current DB/read model behaves when:

- prominence is absent/defaulted/deterministic
- entity/fact/relationship visibility is safely defaulted
- GM summary is null
- Player summary is null
- campaign overview is null

The wiki must not require invented data merely to satisfy UI expectations.

---

# 7. Processing Modes — Target Direction

Milestone 1 must finalize names and exact semantics, but v0.4 should converge on three conceptual modes.

## 7.1 Core / Lean

Goal:

> Produce a useful GM wiki at minimum cost.

Expected direction:

- normal extraction
- normal reconciliation
- 0 mandatory post-reconciliation enrichment model calls
- source-backed facts/relationships directly power articles
- safe visibility defaults
- no mandatory per-entity generated summaries
- no mandatory campaign overview
- deterministic prominence/sorting only if required and shown as suggestion/approximation

This should become the likely production default if Milestone 1 confirms the wiki remains useful.

## 7.2 Assisted

Goal:

> Spend AI only where marginal value is high.

Potential operations, subject to M1 evidence:

- summaries only for Major entities
- one GM overview
- on-demand summary generation
- optional “suggest importance” workflow
- optional visibility suggestions

Do not decide these by intuition alone.

## 7.3 Full / Reference

The current v0.3-style full enrichment:

- entity prominence/visibility classification
- fact visibility classification
- relationship visibility classification
- GM summaries
- Player summaries
- overviews

Keep it as benchmark/reference/optional developer mode.

It should not remain the default merely because it already exists.

---

# 8. Cost Model Requirements

Every processing evaluation/report should distinguish:

- actual calls
- reused cached operations
- local operations
- paid OpenAI operations
- failed-but-billed responses where measurable
- input tokens
- cached input tokens
- output tokens
- total tokens
- measured estimated cost where current pricing support exists
- unknown/unmeasured historical cost where it does not

Never turn an estimate into an “actual” cost.

Before any paid recovery/developer operation, report:

```text
provider
model
operations reused
operations to run
maximum semantic retries
planned OpenAI calls
planned local calls
known/unknown estimated cost
```

A developer should be able to answer “how many paid calls can this command make?” before running it.

---

# 9. Cache / Checkpoint Identity

Later v0.4 milestones must make each validated AI operation independently durable.

A checkpoint identity must account for at least:

- campaign/document identity where relevant
- canonical graph fingerprint
- provider ID
- model ID
- operation/stage
- batch number or stable operation key
- exact deterministic input hash
- prompt behavior version
- schema/output-contract version
- processing mode where it changes semantics

Do not reuse local output for OpenAI, one model as another, old prompt output after prompt changes, output from a changed graph/input, or GM output as Player output.

A successful checkpoint is reusable only after schema and semantic validation passed.

A failed attempt may retain usage/error metadata but is not a reusable output.

---

# 10. Milestone 0 — Structured Provider Foundation

## Status

Implemented as v0.4.0 in commit:

`8afa1d38d00193cd801df87039d665c6f2a53a49`

Audited and fixed forward as v0.4.1 in commit:

`87e02a5bd52821892a028448914335e2840f2efe`

Subject to one explicit audit gate before M1.

## Goal

Stop coupling enrichment orchestration directly to one paid provider.

## Implemented direction

- provider-independent structured model interface
- OpenAI adapter
- local OpenAI-compatible adapter
- local Ollama/LM Studio documentation
- `AI_PROVIDER`
- local base URL/model/API key config
- server-only runtime selection
- local blocked on Vercel
- `ai:preflight`
- provider-aware recovery dry-run
- no silent local→OpenAI fallback
- local output passes through Zod and existing semantic validation

## Audit gate

Before M1:

- verify OpenAI behavior unchanged
- verify local failure cannot trigger paid fallback
- verify local output cannot accidentally contaminate benchmark/production state without explicit opt-in
- verify provider/model identity is visible in diagnostics/cache metadata
- repair stale `PRODUCT_SPEC.md`
- all deterministic gates pass
- 0 paid calls

## Acceptance

`V0.4 M0 AUDIT: PASS`

---

# 11. Milestone 1 — Enrichment Value/Cost Audit and Lean-Pipeline Decision

## Status

Completed as v0.4.2. The evidence and exact M2 requirements are recorded in `docs/v0_4_enrichment_value_audit.md`.

## Goal

Determine which current enrichment operations earn their cost and which should become deterministic, manual, optional, or removed from the default import.

This is primarily an analysis/design milestone.

## No paid calls

Milestone 1 must use current code, existing Test 2/Test 3 data, persisted historical usage, the cached Test 3 graph, deterministic scripts, static payload analysis, and mocked/local-only experiments if needed.

No live OpenAI generation call.

## Audit every enrichment responsibility

Evaluate separately:

1. Entity prominence
2. Entity visibility
3. Fact visibility
4. Relationship visibility
5. GM entity summaries
6. Player entity summaries
7. GM campaign overview
8. Player campaign overview

For each record:

- current number of operations at Test 3 scale
- input payload size
- expected output size
- observed failures/retries
- observed actual usage where available
- latency implications
- monetary cost where actual measurement exists
- user-visible value
- consequence of lower accuracy
- whether the GM has better context than the model
- whether a deterministic heuristic is acceptable
- whether a safe default exists
- whether it can be generated later/on demand
- whether it belongs naturally in v0.5 editing/review

## Inspect lean compatibility

Determine exactly what breaks if enrichment is skipped.

Audit database constraints/defaults, persistence, visibility/prominence assumptions, homepage/category ordering, Player View, summaries/overview, search, source rendering, events/quests, evaluation metrics, and processing state.

Do not guess.

## Decide safe core defaults

Milestone 1 must explicitly recommend the default behavior for:

- prominence
- entity visibility
- fact visibility
- relationship visibility
- GM summary
- Player summary
- GM overview
- Player overview

The preferred safety posture is:

- GM wiki remains complete
- Player data fails closed
- absent summaries simply remain absent
- no invented filler
- no hidden AI call solely to satisfy a non-null UI assumption

## Deliverable

Create:

`docs/v0_4_enrichment_value_audit.md`

It must contain a decision table:

```text
Operation | Default? | Replacement | Optional AI? | User value | Cost/latency | Risk
```

and a recommended target processing-mode definition for M2.

## Acceptance

We can state exactly:

- what “wiki ready” means without full enrichment
- how many post-reconciliation AI calls the lean default requires
- which full-enrichment operations remain optional
- what M2 must implement
- what trade-offs the GM will see

No normal production behavior changes yet except small deterministic instrumentation if necessary.

---

# 12. Milestone 2 — Lean Default Pipeline

## Status

Completed as v0.4.3. Lean is the server-side default for normal processing, cached replay, and cached recovery; full enrichment remains an explicit reference mode. Deterministic diagnostics and the Test 3 cache evaluation prove zero post-reconciliation model calls without mutating Test 2 or Test 3.

## Goal

Make the canonical source-backed GM wiki a first-class successful output, independent of mandatory full enrichment.

## Work

Implement the M1-approved lean mode.

Requirements:

- campaign can reach wiki-ready/complete without full enrichment
- extracted rich facts remain source-backed
- relationships and hierarchy persist normally
- articles render from facts/relationships when summary is absent
- no empty “unknown” summary/overview placeholders
- safe visibility defaults
- prominence behavior follows M1 decision
- Player View remains fail-closed
- full enrichment path remains available but optional
- processing diagnostics record mode
- no silent full-enrichment fallback

## Default production economics

Target:

> **0 mandatory post-reconciliation enrichment model calls in the lean/default mode**, unless M1 produces strong evidence that a very small specific operation is worth retaining.

Any exception must be documented with evidence.

## Minimal UX

Do not perform the v0.6 redesign.

Small functional messaging is allowed, such as `Wiki ready`, optional-enrichment status, or a developer mode indicator.

## Acceptance

Using cached canonical data, lean mode produces a useful DM wiki with correct counts, articles, links, sources, hierarchy, search, Quests and Events without mandatory enrichment calls.

---

# 13. Milestone 3 — Provider Coverage for Full Local Development

## Status

Completed as v0.4.4. Extraction and reconciliation now use the shared structured-model provider with stage-specific local model fallback, provider-aware concurrency and diagnostics, strict shared validation, a three-stage zero-generation preflight, deterministic Test 3 extraction-workload instrumentation, and a non-persisting small-fixture local smoke path.

## Goal

Allow end-to-end development on new PDFs without requiring OpenAI credits where technically practical.

M0 only required provider abstraction for enrichment.

M3 should evaluate and, if clean, migrate candidate extraction and reconciliation structured calls to the same provider-independent boundary.

## Requirements

- OpenAI production behavior preserved
- stage-specific model configuration preserved
- local stage-specific model configuration supported if necessary
- local failure never falls back to OpenAI
- extraction validation unchanged
- reconciliation exactness/safety unchanged
- local mode clearly marked non-production/non-benchmark
- no provider-specific logic leaks into graph/domain code

If one generic local model is unsuitable for all stages, allow stage-specific local models rather than forcing one model everywhere.

## Acceptance

A small fixture PDF can run end-to-end with:

`plannedOpenAICalls = 0`

using local provider(s), while the normal OpenAI path remains intact.

---

# 14. Milestone 4 — Durable Per-Operation Enrichment Checkpoints

## Status

Completed as v0.4.5. A private provider-aware operation checkpoint store now makes validated extraction chunks, reconciliation decisions, and full-enrichment operations durable before later work or graph persistence. Exact semantic hashing, explicit behavior/schema versions, read-only resume planning, and deterministic interruption/invalidation tests preserve lean mode's zero-enrichment-call default and all historical caches. Post-M4 milestone context is consolidated in `AGENTS.md` and `docs/CURRENT_STATE.md`.

## Goal

Never lose already validated enrichment work because a later operation fails.

After an operation has received a model response and passed Zod, exact-key, evidence-ownership, and mode-specific semantic validation, persist it immediately as a reusable checkpoint.

## Operations to checkpoint

At minimum:

- entity classification
- each fact-visibility batch
- each relationship-visibility batch
- each GM summary batch
- each Player summary batch
- GM overview
- Player overview

If lean/assisted mode uses fewer operations, checkpoint only operations actually run.

## Persistence model

Use a clean operation-level model. A conceptual record may contain:

```text
id
campaign_id
document_id
source_extraction_cache_id
graph_fingerprint
provider_id
model_id
processing_mode
operation_type
operation_key / batch_index
input_hash
prompt_behavior_version
schema_version
status
validated_output
usage
error
attempt_count
created_at
completed_at
```

Exact schema names are implementation details.

## Migration

A DB migration is acceptable in this milestone if required.

It must preserve existing enrichment cache history, Test 2, failed Test 3 history, RLS and service-role security.

## Acceptance

Kill enrichment after several validated batches and rerun. Previously validated compatible batches must report `REUSE`, not call the provider again.

---

# 15. Milestone 5 — Resumability, Failure Injection, and Paid-Call Guards

## Goal

Prove the processing architecture behaves correctly under realistic failure.

## Deterministic failure scenarios

Test:

- process interruption after entity classification
- interruption after a fact batch
- interruption during summaries
- 429
- timeout/network failure
- malformed JSON
- Zod failure
- missing keys
- duplicate keys
- cross-owner evidence
- Player-unsafe evidence
- one semantic retry succeeds
- second semantic retry fails
- provider unavailable
- wrong local model
- changed prompt version
- changed graph fingerprint
- changed model/provider
- corrupt/incomplete checkpoint

## Resume behavior

After failure:

- validated checkpoints reused
- failed operation reruns
- later operations run only when dependencies are satisfied
- no whole-stage restart unless cache identity changed
- usage history remains accurate

## Paid-call guard

Before OpenAI execution:

- report exact planned new OpenAI operations
- report reused operations
- report retry ceiling
- enforce configured safety cap
- require explicit developer authorization for recovery/benchmark commands

Do not silently spend because a local provider is unavailable.

## Acceptance

A test can interrupt and resume a Test-3-scale synthetic workload with no duplicated validated operations.

---

# 16. Milestone 6 — Local Test-3-Scale Rehearsal

## Goal

Stress the real orchestration without API cost.

Use the existing cached Test 3 canonical graph where safe, but do **not** contaminate the official benchmark state.

Preferred approaches:

- isolated rehearsal namespace/cache
- explicit non-persisting mode
- disposable clone/sandbox campaign

## Run locally

Exercise:

- full legacy enrichment path
- lean path
- optional/assisted path if M1 retained one
- semantic retry
- forced interruption
- resume from checkpoints

Record local model, operation counts, latency, schema failure rate, semantic failure rate, retries, and resume correctness.

These results evaluate orchestration robustness, not final campaign quality.

## Acceptance

Complete the equivalent of the 32-call legacy workflow locally with 0 OpenAI calls, validated checkpoint reuse, no official Test 3 mutation, and no Player-safety bypass.

---

# 17. Milestone 7 — Test 3 Economics and Quality Decision

## Goal

Finish v0.4 with an evidence-based production default.

Do not assume full enrichment is worth paying for.

## Compare

Using the same canonical Test 3 graph, compare:

### Canonical/lean wiki

- usefulness without post-reconciliation AI
- article completeness
- navigation
- source traceability
- GM effort required

### Assisted mode

If retained:

- added information
- added cost
- added latency
- correction burden

### Full enrichment/reference

Use existing historical outputs/cost where available, local structural rehearsal, and a new paid OpenAI run only if credits are intentionally restored and the comparison genuinely requires it.

A paid full run is **not automatically required** to complete v0.4 if the product decision can be made without it.

## Human review

Sample Major/Supporting/Minor NPCs, Locations, Factions, Items, Quests, Events, Deities and Player-sensitive secrets.

Assess what enrichment actually adds, whether it saves GM time, whether wrong AI judgments create more review work, whether summaries are redundant with facts, and whether visibility/prominence automation is better than explicit GM control.

## Economic output

Create:

`docs/v0_4_processing_economics.md`

Report default processing call count, default measured/estimated cost, optional enrichment cost, latency, failure/resume behavior, manual review burden, and recommended production default.

## Final product decision

Choose one:

- lean default
- assisted default
- full-auto default

and justify it with evidence.

The expected direction is lean default, but the milestone remains evidence-driven.

---

# 18. v0.5 Handoff — Editing and Campaign Maintenance

v0.5 is reserved for making GM judgment easy.

Likely scope:

- edit extracted facts
- add manual facts
- add manual entities
- manual provenance
- hide/reveal entity
- hide/reveal individual facts
- relationship visibility controls
- prominence editing
- merge/split correction
- reclassify `Other`
- status updates
- quest state
- faction standing
- campaign-state/audit history as required

The important v0.4 handoff requirement is:

> Lean processing must not bake AI guesses so deeply into the model that v0.5 cannot replace them cleanly with GM decisions.

---

# 19. v0.6 Handoff — Major UI / Design System

v0.6 is reserved for redesigning around the workflow established by v0.4 and v0.5:

```text
Import
 → Review
 → Correct
 → Reveal
 → Maintain
 → Browse during play
```

Expected direction:

- stronger campaign navigation
- article/context sidebar
- source/reveal/edit affordances
- better campaign home
- responsive behavior
- warmer fantasy/editorial identity
- less database/dashboard feel

Do not prematurely design v0.6 controls during v0.4.

---

# 20. Post-v0.6 Reserved Work

Keep extension points for:

- real authenticated DM/player accounts
- secure shared Player View
- per-player/per-party visibility
- multi-document campaigns
- incremental reprocessing
- session-log ingestion
- export/backup/restore
- import portability
- background job queue/worker architecture if scale requires it
- billing/usage quotas
- production observability
- deletion/data-retention controls

These should not block v0.4 unless a design choice would make them substantially harder later.

---

# 21. Test 3 Integrity

Current Test 3:

`d14f9875-5ebf-46c6-b07e-d65a3e65c5f4`

Preserved extraction cache:

`1ad99ac3-6cf5-4731-bf1e-4736109f0de8`

Canonical graph:

- 112 entities
- 502 facts
- 145 relationships

Fingerprint:

`3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`

History must remain explicit:

- v0.3.8: extraction/reconciliation succeeded; monolithic enrichment failed relationship completeness
- v0.3.9: bounded enrichment; 10 Terra calls completed; later cross-owner evidence failure; measured `$0.327931`
- v0.3.10: owner-scoped evidence fix; later execution blocked by exhausted API credits before usable response
- v0.4.0: local structured provider foundation
- v0.4.1: M0 audit and local-persistence safety fix
- v0.4.2: enrichment value/cost audit and lean-pipeline decision

Do not rewrite this as a pristine one-pass benchmark.

Local rehearsals are not official OpenAI benchmark results.

---

# 22. Versioning

v0.4.0 is the original Milestone 0 implementation; v0.4.1 is its audit/fix-forward patch.

Subsequent completed milestones may use patch releases:

- M1 → 0.4.2
- M2 → 0.4.3
- etc.

This is guidance, not a requirement to create meaningless version bumps for documentation-only work. Follow the established repository convention.

Do not use v0.5 until the editing/maintenance sprint starts.

---

# 23. Definition of Done for v0.4

v0.4 is complete when:

- provider abstraction is audited and safe
- PRODUCT_SPEC is current and evergreen
- enrichment responsibilities have an evidence-based value/cost decision
- the default/lean GM wiki does not require mandatory full enrichment
- the default post-reconciliation AI call count is explicitly bounded and ideally zero
- full enrichment remains optional/reference until intentionally retired
- local development can exercise the model pipeline without OpenAI credits
- validated enrichment operations are independently durable
- interrupted runs resume instead of repurchasing completed work
- cache reuse cannot cross provider/model/prompt/schema/input identities
- dry-run reports planned paid operations accurately
- local failure never silently falls back to OpenAI
- deterministic test suite needs no paid services
- Test 2 remains untouched
- Test 3 history is preserved
- Test 3 economics/quality comparison selects a production default
- v0.5 can add GM editing/control without undoing v0.4 architecture

Final v0.4 product outcome:

> **Campaign Wiki should spend AI where AI removes tedious work, not where the GM can make the decision faster, safer, and more accurately.**
