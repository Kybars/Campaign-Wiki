# Compact Pass-A source-size reliability experiment

## Starting state

- Starting HEAD: `cdbaff0b9f06d747ad438c1e2e665e7575517c13`.
- The working tree was already dirty with the uncommitted compact Pass-A/v0.4.9 work listed in `git status`; it was preserved. Nothing was reset, committed, or pushed.
- The reusable parsed and validated chunk-4 compact Pass-A output exists in ignored `artifacts/compact-pass-a/manifest.json`. It was not rerun.

## Frozen runtime and deterministic subdivision

The dry-run preflight confirmed local `qwen3.5:9b` at digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, 32,768 context, temperature 0, reasoning none, and concurrency 1. It made zero generation calls.

| Original | Subchunk | Pages | Source chars | Estimated input tokens | SHA-256 |
| --- | --- | --- | ---: | ---: | --- |
| 3 | 3A | 38–45 | 21,778 | 5,445 | `b99037495841dc3c42b9026eaa520fed00641db35ddf78046b57146ce30a01f0` |
| 3 | 3B | 46–53 | 21,703 | 5,426 | `0a18446320cd5777efc109ac67bdff265124ed6f0e8f5af77ff544883d2e5c1f` |
| 5 | 5A | 67–74 | 21,677 | 5,420 | `c5339ee4613e2e70ed8e919874db4485e5a822ae2094a8be07b3b86768febc23` |
| 5 | 5B | 75–84 | 22,050 | 5,513 | `6f869a786b34bc013ace4132e5f3b3d37c37023e9bea059286c2356cf88bac0c` |

Original chunk 3 is 43,481 characters with source hash `f169ec9cb51907a354c4d9475089bc164265df0d9b0aa23c4a9d21918e25f2dd`; original chunk 5 is 43,727 characters with source hash `e12a4e059fb984a1c3bbb51a33ae84ebd2a9a8fc6190f25c9827ce01f79b1155`. The experiment helper proves exact ordered reconstruction of each original delimited page source and no duplicate page coverage.

## Live result and blocker

| Unit | Source chars | Input tok | Output tok | Total tok | Headroom | Valid | Entities | Recall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Chunk 4 (saved) | unavailable | 11,711 | 19,012 | 30,723 | 2,045 | yes | 99 | 73.5% |
| Chunk 3A | 21,778 | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable | unavailable |

The Stage-A 3A request was dispatched once through the required request-scoped long-running-safe path. It produced no response envelope, content, usage, output bytes, parsed inventory, or strict failure result. Its intended 900-second request timeout did not return control; after roughly 18 minutes it was manually stopped to prevent an unbounded experiment and to avoid issuing a prohibited retry. Therefore 3B, 5A, 5B, and all adaptive Stage-B children were deliberately not run.

This is a tooling/transport-timeout enforcement failure, not evidence that smaller sources succeed or fail. The one dispatched local request counts against the maximum even though no model result was observable.

## Reconstruction, recall, and pressure analysis

Neither original failed interval was completely covered by valid inventories, so no experimental union, duplicate/collision accounting, chunk-3/5 recall, aggregate three-chunk recall, reference-bounded precision, or F1 is available. The reused chunk-4 result remains unchanged: 36/49 supported identities (73.5%), 8/12 historical misses recovered, and Item recall 0%. The frozen reference remains non-exhaustive; reference-bounded false positives can still be legitimate source-supported entities.

There are no successful new calls from which to quantify context occupancy, output/input ratio, entity density, or a conservative production source-size ceiling. Do not change `PDF_CHUNK_TARGET_CHARACTERS` on this evidence. In particular, Item remains a separate recall/prompt concern in saved chunk 4, not a demonstrated source-size result.

## Deterministic verification

- Added focused tests for stable page-boundary subdivision, complete/no-duplicate coverage, logical union, same-type/name duplicate accounting, cross-type collision preservation, and failed-subdivision handling.
- `npm run lint`: PASS
- `npm run typecheck`: PASS
- `npm test`: PASS — 36 files, 285 tests

## Safety

- OpenAI generation calls: 0
- New local generation requests dispatched: 1 (no observable completed result; no retry)
- Rich, reconciliation, and enrichment live calls: 0
- Campaign writes: 0
- Official checkpoint/cache writes: 0
- Protected campaigns unchanged

## Decision

`INCONCLUSIVE`

The required causal conclusion is blocked by the experiment harness failing to enforce or surface the frozen long-request timeout. It would be invalid to classify the result as source-size insufficiency or reliability from this non-result.

## Next milestone

Repair and prove the experiment-only long-request timeout/cancellation path with a non-generation transport test, then rerun the frozen source-size experiment from a fresh bounded call budget.

## Commit recommendation

Keep the accumulated compact Pass-A work uncommitted. The source-size decision remains unresolved, so the current chain is not yet a coherent checkpoint for the next extraction milestone.

`V0.4 COMPACT PASS-A SOURCE-SIZE RELIABILITY: FAIL`
