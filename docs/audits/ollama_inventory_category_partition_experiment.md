# Ollama inventory category-partition experiment

Date: 2026-09-14
Decision: `CATEGORY_PARTITION_DOES_NOT_SOLVE_PRESSURE`

## Starting state

`main...origin/main` remained at the pushed v0.4.8 baseline with all uncommitted v0.4.9, transport-diagnostic, and chunk-pressure work preserved. Nothing was reset, committed, or pushed.

## Frozen environment

- Local `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`
- Context 32,768; temperature 0; reasoning none; concurrency 1
- Exact failed source: chunk 3 pages 38–41, source hash `9252d865dacb1e30271bddc9308343d9b5c037d9298a89ee5a41404a5c35290b`
- Strict category-literal inventory schema, original evidence fields/validator, and request-scoped 900-second transport
- No OpenAI fallback or generation calls

## Category results

| Category | Valid | Entities | Latency | Total tokens | Output chars | Failure |
|---|---:|---:|---:|---:|---:|---|
| NPC | no | — | 596.814 s | 32,768 | 100,052 | incomplete JSON |
| Location | no | — | 599.099 s | 32,768 | 101,943 | unterminated JSON string |
| Deity | no | — | 600.734 s | 32,768 | 109,651 | incomplete JSON |
| Faction | no | — | 598.312 s | 32,768 | 106,891 | unterminated JSON string |
| Item | no | — | 616.382 s | 32,768 | 95,700 | unterminated JSON string |
| Quest | yes | 20 | 62.166 s | 6,528 | 11,605 | — |
| Event | yes | 12 | 31.507 s | 4,823 | 5,324 | — |
| Other | no | — | 587.864 s | 32,768 | 100,114 | unterminated JSON string |

Input-token counts were 3,343–3,396 (apart from schema/prompt framing); successful calls emitted 1,480 Event and 3,185 Quest tokens. Every failed category emitted roughly 29.4K output tokens, saturating the total context and returning malformed/incomplete JSON. Duplicate temporary IDs were zero in both validated categories.

## Pages 38–41 union

Only Event and Quest validated, yielding 32 raw entities (12 events, 20 quests). Six categories failed, so this is not a category-complete union; conservative union count, collisions, completeness, and quarter-level recall are unavailable rather than inferred or scored as zero.

## Full chunk reconstruction

The prior chunk-pressure artifact does retain reusable parsed inventories for pages 42–53, so no calls were repeated. Full chunk reconstruction is nevertheless unavailable because pages 38–41 are incomplete under this experiment. No production reconciliation or persistence was invoked.

## Causal conclusion

Category breadth is not the sole source of pressure. Event and Quest are healthy and quick, but NPC, Location, Deity, Faction, Item, and Other each reproduce the same context-exhaustion/incomplete-output pattern on the identical four-page interval. Thus no single category is uniquely pathological; multiple category requests remain pathological under the unchanged model/prompt/runtime.

## Safety

- OpenAI generation calls: 0
- New local generation calls: 8
- Campaign writes: 0
- Reconciliation calls: 0
- Enrichment calls: 0
- Official checkpoint/cache writes: 0
- Test 2, Test 3, and Test 3 Recovery: unchanged

## Next recommendation

Reassess local model suitability or schema/prompt mechanics.
