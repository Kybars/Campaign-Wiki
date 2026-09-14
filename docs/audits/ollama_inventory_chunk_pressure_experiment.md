# Ollama inventory pressure experiment: chunk-size ladder

Date: 2026-09-14
Decision: `SMALLER_CHUNKS_PARTIALLY_HELP`

## Starting state and controls

The branch remained `main...origin/main` at the pushed v0.4.8 baseline (`3b43943`) with the existing uncommitted v0.4.9 two-pass and transport-diagnostic work preserved. Nothing was reset, committed, or pushed.

The experiment used only frozen scored chunk 3 (`chunk-3`, pages 38–53), normalized source hash `f169ec9cb51907a354c4d9475089bc164265df0d9b0aa23c4a9d21918e25f2dd`, and 43,481 source characters. The splitter uses ordered page boundaries, no overlap, and verifies complete/no-duplicate source coverage. It made no semantic, schema, prompt, ontology, validation, reconciliation, persistence, model, context, temperature, reasoning, or concurrency change.

| Setting | Value |
|---|---|
| Provider / model | local / `qwen3.5:9b` |
| Digest | `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7` |
| Context / temperature / reasoning / concurrency | 32,768 / 0 / none / 1 |
| Transport | request-scoped Node HTTP client, 900,000 ms request/header/body limit |
| Inventory contract | unchanged prompt and strict `ExtractionInventoryOutput` Zod schema |

## Results

| Source partition | Calls | Valid calls | Max input size | Mean latency | Max output size | Combined entities | Recall |
|---|---:|---:|---:|---:|---:|---:|---|
| Original 100% | historical failure 0/1 | 0/1 | 43,481 chars (~10,871 estimated tokens) | 442.388 s | incomplete | unavailable | unavailable |
| 2 × ~50% | 2 | 0/2 | 21,778 chars / 6,247 reported input tokens | 556.911 s | 91,907 bytes | unavailable | unavailable |
| 4 × ~25% | 4 | 3/4 | 11,379 chars / 3,405 reported input tokens | 210.720 s (76.070 s among valid calls) | 93,112 bytes | unavailable | unavailable |

### Half-size calls

| Pages | Source chars | Input / output / total tokens | Latency | Result |
|---|---:|---:|---:|---|
| 38–45 | 21,778 | 6,233 / 26,535 / 32,768 | 551.485 s | invalid: unexpected end of JSON |
| 46–53 | 21,703 | 6,247 / 26,521 / 32,768 | 562.336 s | invalid: unterminated JSON string |

### Quarter-size calls

| Pages | Source chars | Input / output / total tokens | Latency | Result | Entities / types when valid |
|---|---:|---:|---:|---|---|
| 38–41 | 10,931 | 3,281 / 29,487 / 32,768 | 614.668 s | invalid: unterminated JSON string | unavailable |
| 42–45 | 10,847 | 3,308 / 4,847 / 8,155 | 97.764 s | valid | 50: event 5, faction 2, item 27, location 6, npc 8, quest 2 |
| 46–49 | 10,324 | 3,198 / 3,302 / 6,500 | 66.910 s | valid | 30: event 5, faction 1, item 2, location 7, npc 15 |
| 50–53 | 11,379 | 3,405 / 3,126 / 6,531 | 63.536 s | valid | 28: deity 2, event 4, item 8, location 5, npc 7, quest 2 |

The three valid quarter calls contained 108 raw entities, but this is not an original-chunk union: pages 38–41 failed. No production reconciliation or persistence was invoked, no ambiguous identities were merged, and no quality metric was scored as zero.

## Causal interpretation

Reducing source volume materially improves reliability for some subchunks: the 42–53 page regions completed in 63–98 seconds with 6,500–8,155 total tokens. It does not yet reliably cover the original interval: pages 38–41 still ran to the 32,768 total-token ceiling and ended with incomplete JSON, while both half-size calls also exhausted that ceiling.

Failure timing is **not monotonic** with smaller input: full source failed at ~442s, halves at ~551–562s, quarter 1 at ~615s, and the other three quarters succeeded quickly. The decisive boundary is output completion/token saturation for certain source regions, not merely a linear source-character threshold.

## Aggregation and recall

Neither the half nor quarter level had complete strict-validation coverage. Therefore experimental boundary aggregation, supported-entity recall, per-type recall, historical-miss recovery, reference-bounded precision, and F1 are unavailable—not scored as zero. The frozen reference remains unchanged.

## Safety

- OpenAI calls: 0
- Local generation calls: 6
- Campaign writes: 0
- Reconciliation calls: 0
- Enrichment calls: 0
- Official benchmark campaigns: unchanged

## Next recommendation

Run category-partitioned inventory experiment.
