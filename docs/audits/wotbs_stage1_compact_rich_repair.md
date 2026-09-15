# WotBS Stage 1 compact Rich repair

## Decision

`WOTBS_COMPACT_RELATIONSHIPS_FAILED`

The facts/aliases subcall returned schema-valid, bounded JSON, although its semantic content was poor. The separate relationships subcall still degenerated: after 554.198 seconds it returned more than 50,152 characters of truncated JSON and failed with an unterminated string. No retry, repair call, fallback, or additional generation was made.

This is a small-document correctness result, not production-scale validation. The compact Rich implementation remains uncommitted and must not be described as validated.

## Starting state and preserved work

- HEAD: `e37b3a666b10aa83b15d863fe8f417eefd32a08c`.
- The validated initial-inventory plus completeness work, prior WotBS audits, rejected candidate-harvest experiment, private-fixture rules, and unrelated dirty work were preserved.
- Private source and evaluation fixtures stayed under ignored `fixtures/wotbs-stage1/`; `git ls-files fixtures/wotbs-stage1` remained empty.
- The exact Pass-A inventory was reconstructed deterministically from the immediately prior ignored `initial-raw.json` and `completeness-raw.json`. Their manifest's PDF and normalized-text hashes matched the current frozen fixture.

## Old Rich contract audit

| Class | Old model-produced fields | Assessment |
| --- | --- | --- |
| Genuine semantic judgment | aliases, roles, summaries, typed facts, relationships, suspected misses | Aliases/facts/relationships are core candidates; summaries and rediscovery are not core Pass-B requirements. |
| Deterministic bookkeeping | inventory IDs, fact temporary IDs, evidence excerpts and page wrappers, relationship confidence/descriptions, nested per-entity wrappers | IDs, exact evidence, provenance, validation, dedupe, and assembly belong in application code. |
| Optional/non-core generation | prose summaries/descriptions, suspected inventory misses, repeated source restatement | These increased output pressure and were removed from the compact experiment. |

The old call combined semantic extraction, prose writing, source quotation, foreign-key bookkeeping, and a deeply nested schema. Its WotBS attempt failed after 509.401 seconds with more than 90,423 output characters.

## Compact Rich design

### Deterministic source spans

Page text is whitespace-normalized, split at sentence boundaries, and grouped into stable contiguous spans targeting 200-600 characters. Longer sentences are split at a word boundary where possible. Pages are sorted numerically and span IDs are application-owned (`p10_s001`, and so on). The frozen fixture produced 38 spans containing 10,930 characters. Tests establish stable IDs across page ordering and serialization and exact span-text materialization.

Both model calls receive only the final inventory's deterministic ID/name/type/page rows and the ID/page/text spans. They receive no inventory evidence excerpts, summaries, previous facts, evaluator information, or gold data.

### Facts and aliases

The flat contract is:

```text
aliases: entity_id, alias, support_span_id
facts: entity_id, fact_type, concise value, support_span_ids
```

Application validation rejects unknown owners/spans, type-incompatible fact keys, empty values, duplicate facts, and aliases absent from their cited span. Evidence text is copied from the validated span after model output validation. Fact IDs are deterministic application hashes. Summaries use only the inventory name as the existing candidate-contract fallback.

### Relationships

The flat contract is:

```text
relationships: source_id, normalized type, target_id, support_span_ids
```

Application validation rejects unknown endpoints/spans, self-edges, invalid types, cited spans containing neither endpoint surface, and duplicate/reverse duplicate edges. Descriptions and evidence are materialized deterministically; the model emits neither.

### Checkpoints

- Pass A remains independently reusable through `inventory`, `inventory_completeness`, and deterministic `inventory_final` identities.
- Experimental `rich_facts` and `rich_relationships` checkpoints independently depend on the final inventory fingerprint plus source-span algorithm/version.
- Changing one Rich model does not invalidate the other Rich checkpoint. A source-span or final-inventory change invalidates both. Rich-only changes preserve Pass-A reuse.
- No live checkpoint rows were written for this fixture.

## Pass A gate

Pass A was reused rather than rerun. Deterministic reconstruction produced fingerprint `c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081` and 42 authoritative entities.

- Recall: 39/43 (90.7%).
- Reference-bounded precision: 40/42 (95.2%).
- F1: 92.9%.
- Quests: 12/12; Items: 2/2.
- No Pass-A generations were used in this milestone.

## Facts and aliases result

| Metric | Result |
| --- | ---: |
| Structured output | valid |
| Latency | 139.813s |
| Input / output / total tokens | 5,418 / 6,841 / 12,259 |
| Serialized output characters | 10,372 |
| Aliases proposed / validator-accepted | 42 / 36 |
| Facts proposed / validator-accepted | 42 / 2 |
| Unknown ID/span admitted | 0 |

The validator rejected six unsupported alias-span claims and 40 type-incompatible facts. Manual semantic inspection found that the 36 accepted aliases merely repeated their canonical inventory names, while both accepted Item `inscription` facts merely restated the Item names. Consequently, useful aliases and useful source facts were both zero. Five of the six gold facts were owner-eligible (Shalosha was absent from inventory), and none was semantically recovered. This call was structurally bounded but semantically inadequate.

## Relationships result

| Metric | Result |
| --- | ---: |
| Structured output | invalid |
| Latency | 554.198s |
| Failure class | malformed JSON |
| Parse failure | unterminated string at character 50,152 |
| Output size | greater than 50,152 characters |
| Retry / repair / fallback | 0 / 0 / 0 |

The response began as coherent-looking flat relationship objects but expanded until truncation. It was not parsed, repaired, validated, scored, or assembled. Twelve of 15 gold relationships would have been endpoint-eligible, but recovered relationship count and unsupported-edge audit are unavailable rather than zero.

## Candidate assembly

Candidate assembly was intentionally not run because the relationships substage did not validate. The deterministic test suite proves that authoritative inventory entities survive absent Rich records, IDs/endpoints fail closed, exact source spans materialize evidence, and suspected misses cannot be promoted. Those proofs do not substitute for a successful WotBS live assembly result.

## Economics

| Stage | Input tokens | Output tokens | Total tokens | Latency |
| --- | ---: | ---: | ---: | ---: |
| Initial Pass A (reused historical result) | 3,313 | 1,318 | 4,631 | 29.755s |
| Completeness (reused historical result) | 3,627 | 947 | 4,574 | 20.080s |
| Rich facts/aliases | 5,418 | 6,841 | 12,259 | 139.813s |
| Rich relationships | unavailable | unavailable | unavailable | 554.198s |

Known Rich tokens are 12,259; total Rich and full Stage-1 token counts are unavailable because the malformed relationship response reported no usage. Rich elapsed time was 694.011 seconds. A conceptual full Stage-1 run including the reused Pass-A timings would be 743.846 seconds. The valid facts output was dramatically smaller than the old 90K-character failure, but the relationship call remained pathological at more than 50K characters.

## Verification and safety

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: 315 tests pass.
- `npm run build`: pass.
- Two-pass extraction, checkpoint, recall, replay, and lean deterministic evaluations: pass with zero model calls/writes.
- Local generations: exactly 2; retries and repair calls: 0.
- OpenAI calls: 0. Pass-A calls: 0. Reconciliation/enrichment calls: 0.
- Campaign, official campaign, checkpoint, and cache writes: 0.
- Gold was not loaded before either generation and never entered model input. Gold leakage: 0.
- Private WotBS files remain ignored/untracked. Demonplague and official Test 2/Test 3 artifacts are unchanged.

## Recommendation

Do not checkpoint the compact Rich architecture as production-valid. Preserve the uncommitted implementation and audit as a focused experimental branch. The next milestone should repair the relationships kernel's finite-output behavior and also address the facts kernel's canonical-name restatement failure before another live validation.
