# WotBS Stage 1 deterministic-candidate recall repair

## Decision

`WOTBS_PASS_A_CANDIDATE_PIPELINE_RECALL_LOW`

The candidate architecture was structurally reliable but reduced final frozen-reference recall from the v3 baseline of 86.0% to 72.1%. Deterministic harvesting covered every literal hard-reference identity, and both bounded semantic calls returned valid compact JSON without retry. The finite-candidate classifier accepted too few correct candidates, made several type/canonical-name errors, and used substantially more input tokens than v3. This result does not validate WotBS Stage 1 or justify a v4 checkpoint commit.

## Starting state and frozen baseline

- Starting HEAD: `e37b3a666b10aa83b15d863fe8f417eefd32a08c`, clean and synchronized with `origin/main`.
- The v3 identity/page-grounding checkpoint was committed and pushed before this experiment.
- Frozen source: `War of the Burning Sky Campaign Guide`, PDF pages 10-12, 3 pages, 11,083 extracted characters, one production chunk.
- PDF SHA-256: `509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990`.
- Normalized text SHA-256: `b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281`.
- Frozen v3 result: 39 authoritative entities, 86.0% recall, 94.9% reference-bounded precision, 90.2% F1, 4,631 total model tokens, 118.7 tokens/entity, 29.919s, and 2,113 output characters.
- Runtime: local Ollama `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, 32,768 context, temperature 0, reasoning none, concurrency 1, and a 600-second absolute request deadline.

## Deterministic lexical harvest

The generic page-local harvester emits a broad candidate superset from Title Case and wrapped heading spans, ALL-CAPS text, repeated or context-cued capitalized tokens, article/name patterns, possessives, apostrophes, hyphenated names, and repeated uncommon lowercase terms. It suppresses generic unreinforced sentence-initial words and common boilerplate. Candidate contexts are capped at 320 characters and two distinct windows. Repeated context text is encoded once in the classifier payload and referenced by deterministic window IDs.

No WotBS name or gold-derived stoplist is present in production harvesting code. Gold scoring happens only after harvesting and model-input construction.

| Metric | Result |
| --- | ---: |
| Raw candidate occurrences | 791 |
| Deduplicated candidates | 359 |
| Harvest CPU time | 19.572 ms |
| Candidate context characters | 19,122 |
| Estimated context tokens | 4,781 |
| Serialized classifier payload | 36,801 characters / ~9,201 tokens |
| All hard-reference lexical coverage | 42/43 = 97.7% |
| Literal hard-reference coverage | 42/42 = 100% |

Lexical coverage by primary type was NPC 11/11, Location 14/14, Faction 1/1, Other 1/1, Item 2/2, Quest 12/12, and Event 1/2. The sole uncovered hard reference was the permitted inferred label `Assassination of Drakus Coaltongue`. All five literal prior misses—Shalosha, Indomitability, Etinifi, Innenotdar, and The Scourge—were present in the finite candidate set.

## Finite-candidate semantic classifier

The classifier saw only the finite candidate set, candidate page choices, and shared bounded context windows. It could return only `name`, `type`, and `page`.

| Metric | Result |
| --- | ---: |
| Valid structured output | yes |
| Latency | 37.133s |
| Input / output / total tokens | 12,028 / 1,390 / 13,418 |
| Output characters | 2,244 |
| Proposed entities | 41 |
| Accepted mapped entities | 39 |
| Candidate rejections | 320 |
| Unknown-output rejections | 2 |

The application rejected `War of the Burning Sky` and `The Torch of the Burning Sky` because the returned name/page combinations did not map to harvested candidate surfaces. No unknown classifier output entered the authoritative inventory. The rejected Torch variant caused a hard-reference Item and named-anchor miss. The classifier also chose several source-grounded but semantically weak types and retained obvious same-identity name variants; these reduce bounded precision and would require later semantic repair rather than deterministic acceptance broadening.

## Event-only discovery

| Metric | Result |
| --- | ---: |
| Valid structured output | yes |
| Latency | 4.706s |
| Input / output / total tokens | 3,108 / 141 / 3,249 |
| Output characters | 266 |
| Proposed events | 4 |
| Deterministically grounded | 2 |
| Rejected as ungrounded | 2 |

The grounded event labels described the emperor's assassination and initiation of the Scourge. Two Gate Pass labels failed the general token-anchor rule and were excluded with diagnostics. The two grounded labels were source-backed, but neither matched a frozen hard-reference Event under the evaluator's accepted names/types. No event/lexical duplicate survived the normalized `(type, name, page)` union.

## Final authoritative inventory

| Metric | Result |
| --- | ---: |
| Authoritative entities / deterministic IDs | 41 / 41 |
| ID collisions | 0 |
| Grounding exclusions | 2 inferred Event outputs |
| Supported hard-reference recall | 31/43 = 72.1% |
| Reference-bounded precision | 33/41 = 80.5% |
| F1 | 76.1% |
| Adventure titles | 11/12 |
| Quest recall | 91.7% |
| Item recall | 50.0% |
| NPC recall | 72.7% |
| Event recall | 0% |
| Named anchors | 8/9 |

Per-primary-type recall: NPC 8/11, Location 11/14, Faction 0/1, Item 1/2, Quest 11/12, Event 0/2, and Other 0/1. Final misses were Indomitability, Madness, Mother of Dreams, Ragesia, Innenotdar, Heart of History, Inquisitors, trillith, Torch of the Burning Sky, The Indomitable Fire Forest of Innenotdar, Assassination of Drakus Coaltongue, and The Scourge.

Every retained identity has a deterministic source span. Manual review found no invented retained name, but it found source-grounded semantic/type errors, art-caption and partial-title candidates, and obvious duplicate identities such as short/full forms of Coaltongue, Gate Pass, and Shahalesti. The bounded score is therefore not dismissed as evaluator incompleteness.

## Efficiency

| Metric | v3 | Candidate pipeline | Change |
| --- | ---: | ---: | ---: |
| Total model tokens | 4,631 | 16,667 | 3.60× |
| Tokens per authoritative entity | 118.7 | 406.5 | 3.42× |
| Latency | 29.919s | 41.839s | 1.40× |
| Output characters | 2,113 | 2,510 | 1.19× |

The extra cost is almost entirely classifier input: the broad lexical superset succeeded at recall, but asking the model to adjudicate 359 candidates consumed 12,028 input tokens. The candidate pipeline is in the same broad context-window scale but is materially less token-efficient and less accurate than v3 on this fixture.

## Production contract and checkpoint semantics

The experimental production path contains two semantic inventory subcalls per chunk: finite-candidate classification and Event-only discovery. Application code rejects unknown classifier output, grounds and unions accepted identities, assigns deterministic IDs, and records per-call usage. The planner counts both calls for provider preflight and OpenAI attempt ceilings.

Inventory behavior/schema identity advances to `v0.4-candidate-classification-events-4` / contract `4`; v3 inventory checkpoints invalidate. The candidate-harvester version and both semantic inputs are included in inventory checkpoint identity. Validated inventory remains part of the dependent rich fingerprint, and a rich-model-only change still preserves inventory reuse. Pass B itself is unchanged and was not run.

## Verification and safety

- `npm run lint`: PASS
- `npm run typecheck`: PASS (rerun after the parallel build generated `.next` types)
- `npm test`: PASS — 39 files, 304 tests
- `npm run build`: PASS
- `npm run evaluate:two-pass-extraction`: PASS
- `npm run evaluate:checkpoints`: PASS
- `npm run evaluate:recall`: PASS
- Focused candidate, grounding, union, gold-isolation, no-persistence, and WotBS fixture tests: PASS
- New local generation calls: exactly 2
- OpenAI, Pass B, reconciliation, and enrichment calls: 0
- Campaign and official checkpoint/cache writes: 0
- Gold leakage: 0
- Demonplague artifacts: unchanged

## Commit recommendation and next milestone

Keep v4 uncommitted. The mechanics are coherent and deterministic, but the finite-candidate classifier is materially worse than v3 in recall, precision, category coverage, and token efficiency. The next milestone should focus on the classifier branch: reduce/structure the candidate decision workload while retaining the proven 100% literal lexical coverage and the two-call ceiling.
