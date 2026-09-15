# Compact Pass A inventory benchmark

## Starting state

- Starting HEAD: `cdbaff025555a6078f1ccd86077db262729920e9` (`Implement two-pass extraction inventory architecture`), clean and synchronized with `origin/main`.
- The previously stated uncommitted v0.4.9 chain had already been consolidated and pushed; no dirty work existed to preserve at this milestone's start.
- Historical baseline before v0.4.9: `3b439430463a6bb774bc10ca5ad90137b28649de`.

## Compact Pass A

The production model contract now emits only `name`, `type`, and exactly one `existence_evidence` object. Evidence contains a source page and one supporting excerpt bounded to 240 characters. Missing, overlong, or source-unresolvable evidence fails closed. The model no longer emits IDs, aliases, roles, summaries, facts, relationships, prominence, visibility, or prose.

After validation, application code sorts stable identity keys and assigns `inv_` IDs from SHA-256 over the source-chunk fingerprint, normalized type/name, page locator, and normalized evidence. Array order is not identity. Exact repeated entries are removed diagnostically; distinct evidence locations produce distinct IDs. Aliases moved to Pass B and can attach only to a known inventory ID.

Pass B remains inventory-grounded. Unknown owners/endpoints and type mismatches fail; missing rich entity blocks cannot delete an authoritative inventory entity. Candidate assembly preserves such an entity with empty aliases/roles/facts and a name fallback summary.

## Checkpoint semantics

- Inventory behavior/schema identity advanced to `v0.4-compact-inventory-2` / `2`, invalidating old inventory checkpoints.
- Rich behavior/schema identity advanced to `v0.4-compact-inventory-rich-2` / `2` because aliases moved and its authoritative input changed.
- A cached compact raw inventory is revalidated and its deterministic authoritative form must exactly match the stored validated form; corruption fails closed.
- Rich identity depends on the new authoritative inventory and inventory operation identity. Inventory changes invalidate rich output; a rich-model-only change still preserves inventory reuse.

## Deterministic verification

All checks passed before live inference:

| Check | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 35 files, 282 tests |
| `npm run build` | PASS |
| `npm run evaluate:recall` | PASS |
| `npm run evaluate:checkpoints` | PASS |
| `npm run evaluate:two-pass-extraction` | PASS |

Tests cover the compact schema/evidence bound, source rejection, stable reorder-independent and location-sensitive IDs, duplicate handling, serialize/deserialize stability, rich owner/endpoint grounding, inventory preservation, and checkpoint invalidation/reuse.

## Frozen inventory benchmark

Frozen environment: local Ollama `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, context 32,768, temperature 0, reasoning none, concurrency 1, request-scoped 900-second-safe transport. No retries or fallback.

| Chunk | Pages | Frozen source hash | Valid | Latency | Tokens | Output | Entities / IDs | Recall | Historical misses |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 3 | 38–53 | `f169ec9cb51907a354c4d9475089bc164265df0d9b0aa23c4a9d21918e25f2dd` | no | 439.191s | unavailable | incomplete | unavailable | unavailable | unavailable |
| 5 | 67–84 | `e12a4e059fb984a1c3bbb51a33ae84ebd2a9a8fc6190f25c9827ce01f79b1155` | no | 428.733s | unavailable | incomplete | unavailable | unavailable | unavailable |
| 4 | 53–67 | `5069e943412f9855eb4448b222d247343d7514d915d58776ff90b386551ba095` | yes | 394.015s | 11,711 in / 19,012 out / 30,723 total | 50,554 chars / 50,812 bytes | 99 / 99; 0 collisions | 36/49 = 73.5% | 8/12 |

Chunk 4 per-type inventory counts were Event 5, Faction 5, Item 12, Location 14, NPC 37, Other 16, Quest 10. Frozen-reference recall was Event 66.7%, Faction 57.1%, Item 0%, Location 66.7%, NPC 90.9%, Other 0%, and Quest 100%. Reference-bounded precision was 36.4% and F1 48.6%.

The reference is non-exhaustive. Apparent reference-bounded false positives may still be legitimate source-supported entities. Failed chunks have unavailable quality, not zero quality. Overall three-chunk recall is unavailable because only one full interval validated.

## Comparison and conclusion

- Pathological v1 Pass A: 0 valid full scored chunks; dense pages 38–41 Deity exhausted 32K in about 600.734s.
- Compact diagnostic on the four-page Deity slice: names-only produced 5 entities in 9.091s/3,689 tokens; bounded evidence produced 11 in 17.647s/4,188 tokens.
- Production compact Pass A on full scored chunks: 1/3 valid. It improves reliability but does not remove full-chunk output pressure; the only valid chunk also remains below the 85% recall threshold and has catastrophic Item recall on the frozen reference.
- Paid final-extraction context (not inventory-equivalent): historical Luna recall 50.3%, v0.4.8 Luna 47.6%, v0.4.8 Terra 68.3%.

Decision: `COMPACT_PASS_A_PARTIALLY_RELIABLE`

## Safety

- OpenAI generation calls: 0
- New local generation calls: 3
- Rich live calls: 0
- Reconciliation/enrichment calls: 0
- Campaign, checkpoint, and official-cache writes: 0
- Official Test 2, Test 3, and Test 3 Recovery: unchanged
- Protected graph: 112 entities / 502 facts / 145 relationships; historical fingerprint unchanged

## Commit recommendation

Keep this milestone uncommitted pending a reliable compact-Pass-A source-sizing result. The contract and deterministic architecture are coherent, but 1/3 full-chunk reliability is not sufficient to consolidate as a completed extraction milestone, and rich-pass validation is premature.

## Next milestone

Run one compact-production-Pass-A source-size experiment on the same frozen scored material to establish a reliable maximum source interval before any live rich-pass validation.

`V0.4 COMPACT PASS-A + FROZEN INVENTORY BENCHMARK: FAIL`
