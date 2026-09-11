# v0.4 Milestone 1 — Enrichment value/cost audit

## 1. Executive decision

Campaign Wiki should make the canonical source-backed GM wiki the default successful product, with **zero mandatory post-reconciliation model calls**.

The present full enrichment path is useful as an opt-in reference workflow, but it should not block persistence or the GM wiki. At Test 3 scale it plans 32 calls under the current conservative all-player-visible estimate. A preserved validated output classified 57 of 112 entities as Player-visible and therefore required 27 successful-path calls before retries; the recorded completed enrichment used 29 calls because two semantic retries occurred. It then failed during persistence. This is strong evidence that whole-pipeline enrichment couples campaign availability to optional judgments and prose generation.

The production decisions are:

- Persist canonical entities, rich facts, relationships, hierarchy, and evidence immediately after reconciliation.
- Default all imported entities, facts, and relationships to `dm_only`.
- Keep prominence nullable/unclassified. Use transparent deterministic ordering until the GM can edit prominence; consider AI suggestion only as an explicit later action.
- Do not require post-reconciliation GM or Player summaries.
- Preserve the concise source-backed summary already produced during extraction/reconciliation as a GM-facing fallback; do not mistake it for the richer enrichment summary.
- Keep campaign overviews absent by default. A bounded GM overview is a promising explicit/on-demand operation, but the current 410,625-byte observed input is not yet a low-cost assisted path.
- Retain full enrichment as explicit `full`/reference mode. Provider choice (`openai` or `local`) remains independent of processing mode.

M2 is ready to implement a lean default without a schema migration. It requires orchestration, replay, safe-default projection, diagnostics, and small read-model/UI changes.

## 2. Current pipeline operation map

```text
entity classification (1 call; 112 entities)
  ├─ prominence + reason + evidence
  └─ entity visibility
          ↓
fact visibility (6 calls; 502 facts) ─┐
relationship visibility (3 calls; 145 relationships)
                                      ↓
                              classified graph
                                      ↓
GM summaries (10 calls; 112 entities)
Player summaries (5 observed / 10 upper-bound calls)
                                      ↓
GM overview (1 call)
Player overview (1 call)
                                      ↓
final applyCampaignEnrichment validation
                                      ↓
enrichment cache → canonical persistence → status complete
```

Every enrichment operation blocks canonical persistence today. `processCampaign()` does not call `persistCanonicalGraph()` until the full sequence and final validation succeed. Rich-cache replay also rejects a canonical graph without a matching complete enrichment cache.

Dependencies are real:

- Fact and relationship visibility run after entity classification, although their input payloads do not consume the entity assignments.
- Player summary input consumes entity, fact, and relationship visibility.
- Overview input consumes the classified graph and generated summaries.
- `applyCampaignEnrichment()` requires exact assignments for every canonical entity, fact, relationship, GM summary, and every Player-visible entity summary.
- Exact-key and evidence validation may retry a batch once, so the nominal call count is not a hard execution maximum unless a separate guard accounts for retries.

Current versions are enrichment prompt `v0.3-m10-1` and enrichment cache/schema contract `1`. There is not yet a separately versioned per-operation schema identity.

## 3. Test 3 historical usage/cost

The preserved extraction cache reconstructs exactly:

- campaign: `d14f9875-5ebf-46c6-b07e-d65a3e65c5f4`
- extraction cache: `1ad99ac3-6cf5-4731-bf1e-4736109f0de8`
- 112 entities, 502 facts, 145 relationships
- fingerprint `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`

### Agreed historical baseline, verified

| Stage/attempt | Calls | Input | Cached input | Output | Total | Recorded cost |
|---|---:|---:|---:|---:|---:|---:|
| Extraction | 9 Luna | 125,005 | 22,840 | 74,940 | 199,945 | unavailable (`null`) |
| Reconciliation | 1 Terra | 21,194 | 0 | 7,734 | 28,928 | $0.1457915 |
| Initial monolithic enrichment failure | at least 1 | unmeasured | unmeasured | unmeasured | unmeasured | unmeasured |
| Measured 10-call bounded enrichment failure | 10 Terra | 115,526 | 115,085 | 25,336 | 140,862 | $0.327931 |

The initial failure has an empty usage record and must remain **unmeasured historical usage**.

### Persisted discrepancies/additional history

The database contains additional attempts that the supplied summary does not mention:

| Persisted event | Calls | Input | Cached input | Output | Total | Recorded cost | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Earlier bounded attempt | 10 | 115,526 | 0 | 25,479 | 141,005 | $0.5943425 | cross-owner evidence failure |
| Full enrichment completed | 29 | 433,180 | 0 | 62,907 | 496,087 | $1.837585 | enrichment validated; persistence failed on duplicate summary evidence |
| Later attempt | 16 | 211,903 | 211,444 | 43,542 | 255,445 | $0.5657108 | ended with 429/no credits |

The preserved 29-call cache row still contains structurally valid output for 112 GM summaries and 57 Player summaries even though its final cache status is `failed`; its aggregate usage was overwritten to zeros when the later persistence failure updated the same row. The independent `processing_runs` record preserves the 29-call usage above.

Therefore the statement that the v0.3.10-era 429 occurred before any usable response or recorded usage is inconsistent with persisted history: the 429 row itself records 16 responses and usage, and another nearby run records 29 completed enrichment responses before persistence failed. Exact release attribution is uncertain because attempts overlap in time, so this audit reports database chronology rather than relabeling it.

The cumulative measured enrichment cost across these four measured attempts is **$3.3255693**, plus unmeasured initial enrichment and extraction cost. This is recovery history, not the price of one successful campaign. Including reconciliation yields $3.4713608 of known recorded cost, still excluding extraction and unmeasured work.

## 4. Static payload/workload measurements

`npm run evaluate:enrichment-workload` reconstructs Test 3 from its saved extraction/reconciliation cache and calls the production input builders. It performs no model calls and no writes. Counts below are serialized JSON payloads only; characters/UTF-8 bytes are **not token estimates** and exclude system prompts, schemas, and provider framing.

### Classification batches

| Operation/batch | Records | Evidence items | Characters | UTF-8 bytes | Expected response items |
|---|---:|---:|---:|---:|---:|
| Entity classification 1 | 112 entities | 223 | 50,686 | 50,802 | 112 |
| Fact visibility 1 | 100 facts | 110 | 52,837 | 52,977 | 100 |
| Fact visibility 2 | 100 facts | 100 | 53,541 | 53,659 | 100 |
| Fact visibility 3 | 100 facts | 100 | 52,016 | 52,132 | 100 |
| Fact visibility 4 | 100 facts | 111 | 52,679 | 52,787 | 100 |
| Fact visibility 5 | 100 facts | 101 | 50,696 | 50,742 | 100 |
| Fact visibility 6 | 2 facts | 2 | 834 | 834 | 2 |
| Relationship visibility 1 | 60 relationships | 65 | 27,987 | 28,069 | 60 |
| Relationship visibility 2 | 60 relationships | 66 | 29,004 | 29,076 | 60 |
| Relationship visibility 3 | 25 relationships | 25 | 11,556 | 11,574 | 25 |

Fact visibility totals 502 records, 524 evidence items, 262,603 characters, and 263,131 bytes. Relationship visibility totals 145 records, 156 evidence items, 68,547 characters, and 68,719 bytes.

### GM summary batches

Relationships appear in both endpoint entities, so 145 logical relationships become 290 summary-input relationship items.

| Batch | Entities | Nested facts | Nested relationship items | Evidence items | Characters | UTF-8 bytes |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 12 | 101 | 65 | 225 | 76,618 | 76,836 |
| 2 | 12 | 66 | 53 | 175 | 57,434 | 57,520 |
| 3 | 12 | 67 | 40 | 137 | 50,746 | 50,854 |
| 4 | 12 | 72 | 28 | 121 | 46,668 | 46,800 |
| 5 | 12 | 48 | 23 | 92 | 34,383 | 34,475 |
| 6 | 12 | 46 | 23 | 87 | 32,215 | 32,295 |
| 7 | 12 | 32 | 26 | 77 | 28,229 | 28,297 |
| 8 | 12 | 38 | 16 | 80 | 27,646 | 27,702 |
| 9 | 12 | 29 | 12 | 53 | 20,217 | 20,269 |
| 10 | 4 | 3 | 4 | 12 | 4,013 | 4,015 |
| **Total** | **112** | **502** | **290** | **1,059** | **378,169** | **379,063** |

The per-batch fact/relationship distribution is available in the command output; aggregate counts are the useful comparison because entity ordering determines individual batch composition.

### Player summary and overview payloads

Player input size depends on earlier visibility output. The preserved validated output marked 57 entities, 188 facts, and 35 logical relationships Player-visible. Endpoint filtering leaves 137 facts and 52 duplicated relationship items in Player summary/overview inputs.

| Operation | Calls/batches | Entities | Facts | Relationship items | Evidence | Characters | UTF-8 bytes | Response items |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Player summaries, observed | 5 | 57 | 137 | 52 | 303 | 102,558 | 102,828 | 57 |
| Player summaries, all-visible upper bound | 10 | 112 | 502 | 290 | 1,059 | 378,169 | 379,063 | 112 |
| Player summaries, safe `dm_only` default | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| GM overview, observed generated summaries | 1 | 112 | 502 | 290 | 1,059 | 409,489 | 410,625 | 1 |
| Player overview, observed | 1 | 57 | 137 | 52 | 303 | 112,307 | 112,653 | 1 |
| Player overview, safe default | should be skipped | 0 | 0 | 0 | 0 | 15 | 15 | 1 if incorrectly called |

The observed Player-summary batches were:

| Batch | Entities | Facts | Relationship items | Evidence | UTF-8 bytes |
|---|---:|---:|---:|---:|---:|
| 1 | 12 | 33 | 11 | 92 | 27,648 |
| 2 | 12 | 45 | 8 | 74 | 26,569 |
| 3 | 12 | 24 | 9 | 53 | 18,092 |
| 4 | 12 | 28 | 13 | 54 | 19,946 |
| 5 | 9 | 7 | 11 | 30 | 10,573 |

### Successful-path calls at Test 3 scale

- Current recovery estimate (assumes all 112 Player-visible): 1 + 6 + 3 + 10 + 10 + 2 = **32 calls**.
- Observed visibility output (57 Player-visible): 1 + 6 + 3 + 10 + 5 + 2 = **27 calls** before retries.
- Recorded validated run: **29 calls**, consistent with two retry calls.
- Recommended lean default: **0 post-reconciliation calls**.

## 5. Responsibility-by-responsibility value table

| Responsibility | Current Test 3 calls | User-visible value | Source-backed UI without it? | Cost/latency burden | Error consequence | GM has better context? | Safe replacement | On-demand? | v0.5 editing fit | Production treatment |
|---|---:|---|---|---|---|---|---|---|---|---|
| Entity prominence | part of 1 | Better browsing emphasis | Yes | Small direct call share; gates all later work today | Wrong ranking hides useful minor/late material | Usually | Nullable/unclassified plus transparent deterministic ordering | Yes | Strong | **DETERMINISTIC + MANUAL-LATER** |
| Entity visibility | part of 1 | Seeds Player View | Yes for GM | Small direct share, high review cost | Entity/name/count leak | Yes | `dm_only` | AI suggestion only | Strong | **DEFAULT (`dm_only`) + MANUAL-LATER** |
| Fact visibility | 6 | Granular Player knowledge | Yes for GM | 263 KB input; scales with every fact | Secret fact leak | Yes | `dm_only` | AI suggestion only | Strong | **DEFAULT (`dm_only`) + MANUAL-LATER** |
| Relationship visibility | 3 | Player-safe connections | Yes for GM | 69 KB input; scales with graph | Leaks hidden endpoint or connection | Yes | `dm_only` | AI suggestion only | Strong | **DEFAULT (`dm_only`) + MANUAL-LATER** |
| GM entity summaries | 10 | Faster prose scan | Yes: extraction summary, facts, links, sources remain | 379 KB input plus high output-token volume | Misleading synthesis; blocks whole wiki | Often for importance/context | Keep concise extraction summary and render facts | Yes | Medium | **OPTIONAL-AI** |
| Player entity summaries | 5 observed / 10 upper | Readable Player articles | Yes after reveal; facts can render directly | Repeats filtered knowledge and adds leak surface | Spoiler synthesis | Yes | Null until curated visibility exists | Yes, after reveal | Strong | **FULL-ONLY now; OPTIONAL-AI later** |
| GM overview | 1 | High-level campaign orientation | Yes, but home is less narrative | One call but 411 KB observed input | Misstates premise or emphasis | Often | Null; later bounded explicit generation | Yes | Medium | **OPTIONAL-AI** |
| Player overview | 1 | Player-facing introduction | Not needed before sharing/reveal | 113 KB observed; depends on curation | Highest-impact broad spoiler leak | Yes | Null | Only after curated visibility | Strong | **FULL-ONLY now; OPTIONAL-AI later** |

The preserved validated output produced 44 consistency warnings: 22 visible facts referenced hidden entities, 9 visible relationships had hidden endpoints, and 13 Player summaries mentioned hidden knowledge. Some fact/relationship leaks are filtered again by the read model, but Player summaries are not rewritten or suppressed by those warnings. This makes automatic visibility an unsafe default even before subjective quality review.

## 6. Prominence decision

Prominence is nullable in the TypeScript graph and database. Persistence accepts it as absent. Search ignores it. Entity pages do not require it. The current home and category UIs convert `null` to `supporting`, so lean persistence works technically but falsely labels every unclassified entity Supporting and takes an alphabetical first ten on the home page.

M2 should preserve `null` as **Unclassified**, not silently convert it into a campaign judgment. For ordering, use a deterministic, explainable score only as navigation assistance. A reasonable later heuristic can combine:

- number of distinct supporting pages
- number of source-backed facts
- normalized relationship degree
- explicit Quest/Event involvement
- title/heading or repeated-source occurrence signals already present in extraction metadata

The heuristic must not write `major|supporting|minor`; it should sort only. Known failure modes are late pivotal entities with little evidence, frequently cited incidental entities, large hub locations, repeated boilerplate, and antagonists deliberately mentioned obliquely. GM-authored prominence in v0.5 is the durable decision; optional AI can suggest, never silently decide.

## 7. Visibility decision

The default must be `dm_only` for entities, facts, and relationships.

This is already the database default and the canonical fact builder already supplies `dm_only` for new facts. The GM read model does not filter by visibility, so the GM wiki remains complete. Player queries filter entities, facts, relationships, hierarchy, search, counts, and sources; the campaign home already explains an empty Player View.

M2 must set these values explicitly on its lean projection rather than merely omitting them. Omission is safe for a new insert, but update branches in `replace_campaign_graph()` preserve previous values when a field is absent. Explicit values prevent stale Player-visible state from surviving a lean replay/recovery. Player summaries and overviews must also be explicitly cleared for the same reason.

Automatic visibility should become an optional suggestion/review tool after bulk reveal controls exist. It should never publish its own suggestions.

## 8. Summary decision

No post-reconciliation entity summary is required for Wiki Ready.

All entity types already render type-specific rich facts, relationships, hierarchy, citations, and source excerpts. Quests and Events have dedicated relationship/fact presentations. Category and chronology pages omit summary prose cleanly when absent.

The canonical graph also retains a concise source-backed `summary` produced during extraction/reconciliation. The persistence RPC maps this to `gm_summary` when a richer GM summary is absent. Lean mode should intentionally preserve that fallback while clearing stale post-reconciliation/player summaries on a rerun. This gives scanability without ten more Test 3 calls.

GM summaries are best generated on demand for an entity the GM is actively using, or optionally for a small GM-selected set. “Major only” is circular until prominence is curated and still risks paying to summarize the wrong entities.

Player summaries have no default value until Player-visible knowledge has been curated. Once reveal controls exist, direct rendering of visible facts is sufficient; an explicit summary action can be offered when prose is valuable.

## 9. Overview decision

The GM overview has plausible high marginal value, but the current implementation is not a cheap isolated call: its observed input is 410,625 UTF-8 bytes and the orchestration reaches it only after all classifications and summaries. M2 should not retain this as a mandatory call.

Keep `gm_overview` nullable and hide the component when absent, as the UI already does. A later assisted/on-demand design should build one bounded input directly from selected canonical entities/facts/relationships and report its planned call before execution.

The Player overview stays null until the GM has curated Player-visible knowledge. Generating it before reveal review creates the broadest spoiler risk and little immediate value.

## 10. Lean compatibility/blocker map

| Area | Classification | Evidence/current behavior | M2 action |
|---|---|---|---|
| Canonical graph types | No blocker | prominence, visibility, summaries, overview are optional/nullable | None |
| Entity persistence | Safe default, small change | DB visibility defaults `dm_only`; prominence nullable; canonical summary non-null | Explicit lean projection; set GM fallback intentionally |
| Fact persistence | No blocker | facts already default `dm_only`; evidence required and preserved | Explicit `dm_only` for replay safety |
| Relationship persistence | Safe default | DB defaults `dm_only`; normalized graph/evidence already complete | Explicit `dm_only` for replay safety |
| Campaign overview | No blocker for new campaign; stale-state risk | nullable and component hides null; omission can preserve old value | Explicitly clear overview/evidence in lean reruns |
| Entity summaries | No blocker | UI omits empty; legacy canonical summary remains | Clear Player/richer stale values; retain source-backed GM fallback |
| Processing orchestration | **Blocker** | full enrichment always runs before persistence/status complete | Add mode branch and persist lean graph immediately |
| Provider resolution | **Blocker** | enrichment provider/guard resolved at function start | Resolve provider only for modes that call enrichment |
| Rich-cache replay | **Blocker** | rejects v4 cache without complete enrichment cache | Permit lean replay with explicit safe projection |
| Status/state machine | Small change | `complete` already means wiki accessible | Record processing mode and optional-enrichment state in diagnostics |
| Campaign home | Small change | null prominence displayed as Supporting; overview optional | Show Unclassified/deterministic order; no fake prominence |
| Category pages | Small change | null prominence grouped as Supporting | Add Unclassified group or flat deterministic list |
| Entity article | No blocker | facts/relationships/sources render; summary optional | Regression test raw canonical graph rendering/read model |
| Search | No blocker | name/alias search independent of enrichment | Regression test lean DM/Player modes |
| Player read model | No blocker | defaults fail closed and empty-state exists | Assert zero Player-visible data in lean mode |
| Location hierarchy | No blocker | built from normalized relationships; DM sees all | Regression test lean hierarchy |
| Quests/Events | No blocker | specialized UI reads facts/relationships; summary optional | Regression tests without enrichment |
| Evaluations | Small change | replay already builds raw canonical graphs; enrichment eval assumes full | Add lean evaluation/expected zero-call diagnostics |
| Database schema | **No migration required** | defaults/nullability already support lean output | Reuse current schema/RPCs carefully |
| Manual controls | Defer to v0.5 | no editing/reveal UI | Do not add in M2 |

## 11. Definition of Wiki Ready

A campaign is Wiki Ready when all of the following succeed:

1. Source text is extracted with page/source identity.
2. Candidate entities, facts, and relationships pass schema and provenance validation.
3. Global reconciliation produces canonical identities and remapped endpoints.
4. Normalized relationships and recursive location hierarchy are constructed without invalid endpoints/cycles.
5. The canonical graph is transactionally persisted with source evidence.
6. The campaign is marked `complete`, with processing mode and zero/actual model-call diagnostics recorded.

Minimum persisted knowledge by surface:

| Surface | Minimum knowledge |
|---|---|
| GM campaign home | campaign name/status plus canonical entity names/types/roles |
| Category page | entity name/type/role; nullable prominence must render honestly |
| Entity article | entity identity plus any available facts, relationships, hierarchy, and evidence |
| Search | entity name and aliases |
| Citations | document/page/excerpt attached to entities, facts, and relationships |
| Relationships | one normalized logical edge with canonical endpoints and evidence |
| Location hierarchy | normalized physical containment edges |
| Quests | Quest entity plus source-backed facts/relationships when available |
| Events | Event entity plus chronology facts/relationships when available |

Prominence, post-reconciliation summaries, and campaign overviews are not required for completeness. Optional enrichment may run later and must not revoke access to an already-valid GM wiki.

## 12. Recommended processing modes

### `lean` — default

- Extraction and reconciliation run normally.
- Canonical graph is explicitly projected to safe defaults and persisted.
- Mandatory post-reconciliation model calls: **0**.
- Campaign becomes Wiki Ready immediately after persistence.

### `full` — explicit reference/developer mode

- Runs the current complete enrichment sequence.
- Requires planned-call diagnostics and explicit selection.
- Remains for comparison, research, and eventual checkpoint testing.
- Failure must not silently fall back to another provider or silently become lean after paid work.

### Assisted — not a shipping M2 mode yet

One on-demand GM overview is promising, but the current operation is neither bounded nor isolated. Define assisted mode only after a bounded canonical-subset input and post-Wiki-Ready execution path exist. Do not invent a third mode merely for symmetry.

`AI_PROVIDER` selects how a model operation executes. Processing mode selects which operations exist. They are orthogonal: lean makes no enrichment provider call; full may use OpenAI or an explicitly acknowledged local provider.

## 13. Default safe field behavior

| Field | Lean behavior |
|---|---|
| Entity prominence | `null` / Unclassified |
| Entity visibility | `dm_only` |
| Fact visibility | `dm_only` |
| Relationship visibility | `dm_only` |
| GM summary | canonical extraction/reconciliation summary as existing source-backed fallback; no post-reconciliation summary call |
| Player summary | `null` with no evidence |
| GM overview | `null` with no evidence |
| Player overview | `null` with no evidence |
| Optional-enrichment status | not run / available, recorded separately from campaign completeness |

## 14. Expected call-count reduction

At Test 3 scale:

- Dry-run upper-bound full path: 32 → 0 mandatory post-reconciliation calls (**100% reduction**).
- Observed successful path before retries: 27 → 0.
- Recorded validated attempt: 29 → 0.

Scaling below projects Test 3 density (4.482 facts and 1.295 relationships per entity, rounded) and assumes either all entities Player-visible or all `dm_only`. These are call-count projections, not token or price estimates.

| Entities | Projected facts | Projected relationships | Full calls, all Player-visible | Full calls, all DM-only | Lean calls |
|---:|---:|---:|---:|---:|---:|
| 25 | 112 | 32 | 12 | 9 | 0 |
| 100 | 448 | 129 | 29 | 20 | 0 |
| 250 | 1,121 | 324 | 63 | 42 | 0 |

Per-entity/per-fact inference scales directly with campaign size and should require measurable user benefit. The likely full-path cost driver is summary/overview synthesis: it accounts for 17 of the observed nominal 27 calls and about 1.0 MB of observed input payload, before prompts and outputs. The classification stages are still consequential because they gate everything and visibility errors require review.

Production economic rules:

- Default post-reconciliation model calls are exactly zero.
- Optional paid work is explicit and previewable.
- Call and retry ceilings are reported before execution.
- Validated paid output becomes independently reusable once checkpoints exist.
- Provider failure never switches to a paid provider.
- No cost reduction weakens provenance or Player safety.

## 15. Human review trade-off

The comparison is not “automation versus no work.” It is:

```text
AI cost + waiting + correction/reveal audit
versus
safe defaults + targeted GM decisions during actual campaign use
```

The preserved output labeled 12 entities Major, 34 Supporting, and 66 Minor. A GM would likely need to identify only roughly 10–20 campaign-critical entities initially, rather than verify all 112 classifications. The same output attempted to expose 57 entities, 188 facts, and 35 relationships and generated 44 consistency warnings. Reviewing that much automated disclosure is not obviously less work than starting hidden and revealing the handful of entries needed for the next session.

Bulk actions in v0.5 can reduce clicks: reveal an entity with selected safe facts, reveal by source/handout, mark a small Major set, and review AI suggestions without publishing them. Visibility work also happens naturally over campaign play, while a full automatic classification must be audited up front to be trustworthy.

## 16. Risks

- A flat/unclassified home page may be less immediately polished; deterministic ordering and later GM prominence address this.
- The extraction/reconciliation summary may be less fluent than the richer GM summary; facts and relationships remain authoritative.
- An empty Player View is limited until v0.5 reveal controls exist, but it is safe and explicitly messaged.
- Lean replay must clear stale Player-visible fields and prose; omission alone is unsafe on updates.
- Full enrichment currently has whole-run cache granularity and can repurchase successful operations after failure.
- Existing full-output consistency warnings are diagnostic, not a complete authorization barrier.
- A future deterministic prominence score can encode accidental bias if presented as authorial importance rather than sorting assistance.
- The workload command reads the preserved Supabase cache and therefore needs configured read access, though it performs no writes or model calls.

## 17. Exact M2 implementation requirements

1. Add a server-side processing mode with `lean` and `full`; default to `lean` and reject unknown values.
2. Keep processing mode independent of `AI_PROVIDER`. Do not resolve the enrichment provider or require its persistence acknowledgement in lean mode.
3. After reconciliation, build an explicit lean graph projection:
   - entity/fact/relationship visibility `dm_only`
   - prominence `null`
   - GM summary set intentionally to the canonical extraction/reconciliation summary
   - Player summary/evidence cleared
   - GM and Player overview/evidence cleared
4. Persist that graph transactionally, then set campaign status to `complete`/Wiki Ready.
5. Record mode, graph counts/fingerprint, enrichment calls `0`, provider calls `0`, and safe-default diagnostics.
6. Preserve the current full enrichment path behind explicit `full` selection, with no silent fallback between modes or providers.
7. Update rich-cache replay to allow lean canonical persistence without a complete enrichment cache; retain strict cache identity for full replay.
8. Ensure lean replay/recovery cannot retain stale Player-visible fields, Player summaries, or overviews from an earlier run.
9. Render nullable prominence as Unclassified or use a clearly non-authorial deterministic ordering; stop labeling null as Supporting.
10. Keep campaign overview and richer summary components absent when values are null; do not add placeholder prose.
11. Add deterministic tests covering GM completeness, empty/fail-closed Player View, facts/citations, relationships, hierarchy, Quests, Events, search, status completion, zero enrichment-provider calls, and full-mode preservation.
12. Add a deterministic lean evaluation at Test-3-scale fixture proportions and assert zero post-reconciliation model calls.
13. Do not add a schema migration unless implementation uncovers a database behavior contrary to the audited migration/RPC.
14. Do not add prominence/visibility editing, checkpoints, provider migration, or UI redesign in M2.

## 18. Deferred ideas

- GM prominence editing and bulk visibility/reveal controls (v0.5)
- Optional AI visibility/prominence suggestions that never auto-publish
- Per-entity/on-demand GM and Player summaries
- Bounded on-demand GM overview
- Extraction/reconciliation local-provider coverage
- Per-operation checkpoints and resume/chaos testing
- Authenticated Player sharing and authorization
- Final Test 3 economics/quality benchmark

## 19. Open questions

- Choose the exact server-side setting/command surface for `lean` versus `full` in M2; the default and semantics are decided, but the configuration name is not.
- Decide whether M2 labels null prominence `Unclassified` or uses one flat alphabetic category list. It must not call it Supporting.
- Decide whether lean reruns intentionally replace prior manual visibility once v0.5 exists; before v0.5, M2 must clear stale automatic Player data for safety.
- Investigate the historical duplicate `entity_summary_evidence_document_unique` persistence failure separately. It does not block the lean decision, but full/reference recovery still needs a fix before another paid benchmark.
