# Ollama inventory generation-pathology diagnosis

Date: 2026-09-14
Decision: `COMPACT_INVENTORY_CONTRACT_WORKS`

## Starting state

The working tree remained uncommitted on `main...origin/main`; all v0.4.9, transport, chunk-pressure, and category-partition work was preserved. No reset, commit, or push occurred.

## Category and source

The diagnostic used **Deity** on frozen chunk-3 pages 38–41, source hash `9252d865dacb1e30271bddc9308343d9b5c037d9298a89ee5a41404a5c35290b`. Deity was selected as the prescribed heuristic because the frozen reference did not safely establish a lowest expected category count.

Runtime was unchanged: local `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, context 32,768, temperature 0, reasoning none, concurrency 1, strict JSON schema, and request-scoped 900-second transport.

## Existing failed output and capture

The category-partition artifact retained failure metrics but no failed response content: Deity had 109,651 generated characters, 29,423 completion tokens, and 32,768 total tokens before incomplete JSON after 600.734s. It therefore could not provide structural repetition counts retrospectively.

Call A attempted a streamed exact current-contract Deity capture because no useful partial text was retained. It failed at the fetch layer before any stream content arrived; the Ollama service was reachable immediately afterward. No payload was captured, so completed-object, duplicate, fragment, source-snippet, and n-gram repetition metrics are unavailable rather than fabricated. This call was diagnostic only and not accepted as extraction.

## Contract comparison

| Contract | Valid | Entities | Latency | Total tokens | Output chars | Repetition |
|---|---:|---:|---:|---:|---:|---|
| Current category inventory | no (prior Deity capture) | partial/unavailable | 600.734s | 32,768 | 109,651 | payload unavailable; malformed JSON |
| Names-only | yes | 5 | 9.091s | 3,689 | 956 | 0 duplicate normalized names |
| Name + bounded evidence | yes | 11 | 17.647s | 4,188 | 2,786 | 0 duplicate normalized names |

Names-only used `{ entities: [{ name }] }`. The evidence control used `{ name, source: { page_number, supporting_text } }`, retained strict structured output, and capped evidence text at 240 characters. Both preserved target-category-only discovery semantics and returned valid JSON without repair calls.

For comparison, successful prior Event and Quest category calls also completed quickly (31.507s/4,823 tokens and 62.166s/6,528 tokens), while the current full metadata contract exhausted context for six category types.

## Causal conclusion

The evidence demonstrates a clean, source-grounded compact discovery regime for the same category and source interval. The current inventory contract's generated temporary IDs, aliases, and unbounded evidence-list shape is implicated in degeneration; entity discovery itself and a single short evidence representation are not inherently unstable in this test. The two compact controls are not scored as final recall proof, and the failed streamed capture prevents direct partial-payload repetition attribution.

## Safety

- OpenAI calls: 0
- New local calls: 3 (one streamed capture attempt; names-only; bounded evidence)
- Campaign writes: 0
- Reconciliation/enrichment calls: 0
- Official checkpoint/cache writes: 0
- Official benchmark campaigns unchanged

## Next recommendation

Design Pass A around the smallest proven reliable contract: model-provided names plus bounded source grounding, deterministic chunk-local IDs after validation, then a small frozen recall benchmark before any full 3+9+3 run.
