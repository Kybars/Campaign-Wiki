# WotBS Stage 1 small end-to-end audit

## Decision

`WOTBS_STAGE1_PASS_A_FAILED`

The compact production Pass A did not reliably process this small real three-page fixture. It returned a complete local API envelope, but the structured content was an unterminated JSON document at character 108,215. The strict production parser rejected it. No retry, repair generation, Pass B, candidate assembly, reconciliation, or persistence followed.

This is a correctness result, not a production-scale result and not a source-size result for Demonplague.

## Starting state

- HEAD: `cdbaff0b9f06d747ad438c1e2e665e7575517c13`
- The existing compact Pass-A/v0.4.9 working tree was dirty and was preserved.
- Pre-existing changes and audit artifacts were not reverted, committed, or pushed.
- The unfinished Demonplague source-size experiment was not resumed.

## Frozen fixture

Canonical input: `War of the Burning Sky Campaign Guide`, supplied excerpt PDF corresponding to original PDF pages 10, 11, and 12.

| Property | Frozen value |
| --- | --- |
| PDF pages | 10-12 (3 pages) |
| PDF SHA-256 | `509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990` |
| Text companion SHA-256 | `f982d1d4ac9412a80fe3adce2b937e8c7fd653cf028627723c75c20344aafc1c` |
| Production-normalized extracted text SHA-256 | `b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281` |
| Extracted source characters | 11,083 |
| Normalized characters including stable page separators | 11,089 |
| Estimated source tokens | 2,771 (`ceil(characters / 4)`) |
| Production chunk target | 45,000 characters |
| Actual production chunks | 1 (`chunk-1`, pages 10-12) |

The canonical fixture is the unchanged supplied PDF. Production PDF extraction generated three pages and the fixture adapter deterministically preserved their original document provenance as pages 10-12. The supplied text companion is retained for deterministic comparison, not substituted into the live model input.

All three rendered pages were visually inspected. The excerpt is intact and readable; the PDF excerpt pages 10-12 contain printed book footer numbers 9-11, which is expected and does not change the original-PDF provenance contract.

The five packet files are isolated under `fixtures/wotbs-stage1/`; source files and evaluator-only gold files are in separate subdirectories. `fixture.json` records the frozen identity.

## Gold-reference isolation

The live Pass-A request was constructed only from the normal production inventory system prompt and PDF-extracted campaign pages. The live harness does not load either gold file until after all Pass-A outputs validate. Because Pass A failed, the live run never loaded the gold reference at all.

Focused deterministic tests additionally assert that:

- the inventory and rich input builders do not contain the gold filenames, full contents, or gold-only structural markers;
- a deliberately injected gold path is detected as leakage;
- alias and accepted-alternate-type matching happen only in the evaluator;
- the live harness has no database/persistence surface.

Gold leakage count: `0`.

## Frozen local runtime and call budget

| Property | Value |
| --- | --- |
| Provider | local Ollama |
| Model | `qwen3.5:9b` |
| Digest | `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7` |
| Loaded context after request | 32,768 |
| Temperature | 0 |
| Reasoning effort | none |
| Concurrency | 1 |
| Absolute request deadline | 600,000 ms |
| Retries | 0 |
| Pass-A attempts | 1 of 1 permitted |
| Pass-B attempts | 0 of 1 permitted |

The request-scoped fixture transport uses an absolute wall-clock timer that destroys the HTTP request independently of socket activity. It also retains the nested cause chain. The request returned before that deadline, so this failure is not the previous indefinite-hang condition.

## Pass A

| Metric | Result |
| --- | --- |
| Valid compact inventory | no |
| Observed run wall clock | approximately 593,000 ms (manifest creation to terminal update) |
| Exact provider call latency | unavailable in the initial failure manifest |
| Input/output/total tokens | unavailable because usage is returned only after inner structured JSON parses |
| Output characters | at least 108,215; exact size not retained by the existing failure boundary |
| Output bytes | unavailable |
| Raw entity count | unavailable; partial JSON is not repaired or scored |
| Deterministic ID count | unavailable (validation never ran) |
| ID collisions | unavailable |
| Supported-entity recall | unavailable for invalid output |
| Per-type recall | unavailable for invalid output |
| Reference-bounded precision/F1 | unavailable for invalid output |
| Adventure-title capture | unavailable for invalid output |
| Quest recall | unavailable for invalid output |
| Item recall | unavailable for invalid output |

Failure class: `malformed JSON`. Nested cause: `SyntaxError: Unterminated string in JSON at position 108215 (line 2608 column 161)`.

The bounded response excerpt begins with source-supported records for Drakus Coaltongue and the Ragesian Empire, but partial content is not a valid checkpoint and was not repaired, harvested, or scored. The output volume is pathological for the compact contract on an 11,083-character source. The fair Stage-1 conclusion is therefore a Pass-A reliability failure, not a recall score.

## Pass B and candidate assembly

Pass B was not run because Pass A did not produce a valid authoritative inventory. Therefore facts, relationships, aliases, relationship recovery, unsupported-rich-output review, candidate totals, inventory survival, repeated-identity behavior, and `suspectedInventoryMisses` are all unavailable rather than reported as zero.

No candidate representation was built and no WotBS-specific anchor, adventure, Quest, Item, or duplicate-candidate claim can be made from invalid partial JSON.

## Deterministic fixture coverage

Added focused tests for:

- canonical PDF and normalized text hash stability;
- original page provenance 10-12;
- gold-reference isolation from both production model-input builders;
- gold alias matching;
- accepted alternate-type matching;
- authoritative candidate survival when Pass B omits an entity;
- relationship endpoint grounding;
- absence of a persistence surface.

Verification completed successfully:

- `npm run lint`
- `npm run typecheck`
- `npm test` - 37 files, 291 tests
- `npm run build`
- `npm run evaluate:two-pass-extraction`
- `npm run evaluate:checkpoints`
- `npm run evaluate:extraction-workload`
- `npm run evaluate:recall`
- `npm run evaluate:replay`
- `npm run evaluate:lean`

The deterministic evaluations made no generation calls and no writes. The read-only Test-3 workload and lean evaluations reproduced 112 entities, 502 facts, 145 relationships, and fingerprint `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`.

## Safety

- OpenAI generation calls: `0`
- Local generation calls: `1`
- Campaign writes: `0`
- Checkpoint/cache writes: `0`
- Reconciliation calls: `0`
- Enrichment calls: `0`
- Gold leakage: `0`
- Official Test 2, Test 3, and Test 3 Recovery: unchanged
- Demonplague benchmark artifacts: unchanged

## Commit recommendation

Do not checkpoint the accumulated compact Pass-A/v0.4.9 work as a validated extraction milestone yet. Its deterministic architecture remains coherent, but the production compact Pass A failed the intended small correctness gate with pathological malformed output. Preserve the fixture and diagnostics, then repair Pass A narrowly before presenting the branch as a reliable checkpoint.

## Next milestone

Focused repair of the failing Stage-1 Pass-A component. Keep the exact fixture, model digest, context, temperature, reasoning mode, concurrency, no-retry rule, and hidden gold evaluator frozen; investigate bounded compact-output behavior without weakening evidence validation or feeding evaluator knowledge to the model.
