# Ollama 300-second transport diagnosis

Date: 2026-09-14
Decision: `MODEL_OR_SCHEMA_PRESSURE_CONFIRMED`

## Scope and controls

This diagnostic preserved the uncommitted v0.4.9 two-pass work and used one exact frozen scored inventory operation: chunk 3 (pages 38–53), the current inventory prompt, `extraction_inventory_output` strict JSON schema, same source hash, `qwen3.5:9b` digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, context 32,768, temperature 0, reasoning none, and concurrency 1. It made no campaign, checkpoint, cache, reconciliation, enrichment, or OpenAI calls.

Runtime: Node `v25.8.0`, bundled Undici `7.22.0`. The project has no direct `undici` dependency.

## Historical error and new diagnostics

The saved baseline and two-pass captures recorded only the coarse top-level `LocalStructuredModelError` class `transport failure`; their nested `fetch` cause was not persisted, so an original `UND_ERR_HEADERS_TIMEOUT` code cannot be recovered retrospectively. The provider now records safe bounded metadata for future fetch failures: outer error name/message, nested cause name/message/code, Node and Undici version, elapsed milliseconds, and a deterministic transport classification. It distinguishes `UND_ERR_HEADERS_TIMEOUT`, `UND_ERR_BODY_TIMEOUT`, `ECONNRESET`, `ECONNREFUSED`, `AbortError`, HTTP 4xx/5xx, and other transport failures.

## Live results

| Call | Transport-only change | Result | Total latency | Strict inventory valid |
|---|---|---|---:|---|
| A | OpenAI-compatible SSE, `stream: true` | Stream remained alive and terminated after 442,531 ms, but accumulated content was incomplete JSON | 442.531 s | no |
| B | Original non-streaming request through a request-scoped Node HTTP client with 900,000 ms request/header/body limits | Response arrived after 442,388 ms, but content was incomplete JSON | 442.388 s | no |

Both calls passed the previous 302–305 second boundary by roughly 137–140 seconds. Neither produced an HTTP 4xx/5xx, Undici timeout, connection reset/refusal, or abort. The final parse failed with `SyntaxError: Unexpected end of JSON input`; no partial result was treated as a success and Zod/source validation were not weakened.

The matching later failure boundary across streaming and non-streaming long-timeout paths shows that the original 300-second client boundary can be avoided, but it does not make the inventory operation complete. The remaining failure is at model/server output completion under the unchanged strict inventory workload.

## Safety

- OpenAI calls: 0
- Local generation calls: 2
- Campaign writes: 0
- Reconciliation calls: 0
- Enrichment calls: 0
- Official benchmark campaigns: unchanged

## Next step

Do not integrate a production-wide transport change based on this result. Proceed with the separately scoped inventory-pressure reduction experiment (smaller chunks or bounded category partitioning), retaining the frozen source, model, context, temperature, reasoning mode, and validation rules unless that later prompt explicitly changes one.
