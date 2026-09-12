# Luna versus Terra extraction A/B

Date: 2026-09-12
Decision: `REDESIGN_EXTRACTION_PIPELINE`

## Experiment baseline

The controlled experiment started from clean, pushed v0.4.8 commit `53aee4208b4bcc6d6f1459745c328b46b10ec774`. The production extraction configuration was OpenAI `gpt-5.6-luna`; both requested model IDs, `gpt-5.6-luna` and `gpt-5.6-terra`, were verified as available before generation. The current v0.4.8 prompt, schema, behavior/schema versions, source text, validation, and request settings were held constant within each pair. Only the model ID changed.

The harness enforced six application-level attempts, disabled SDK retries (`maxRetries: 0`), and refused to overwrite an existing manifest. It made three Luna and three Terra calls. It made no reconciliation or enrichment calls and wrote no campaigns, official checkpoints, or official extraction cache rows. Raw responses are retained under ignored `artifacts/extraction-ab/`.

## Frozen chunk selection and reference

Chunks were ranked first by count of the 52 audited historical misses, then category diversity, then historical output pressure. The resulting order was 3, 5, 4. The reference was frozen before generation in `docs/audits/extraction_ab_reference.json`; model output never modified it.

| Chunk | Pages | Source characters | SHA-256 | Historical E/F/R | Historical misses | Miss types | Expected identities |
|---:|---:|---:|---|---:|---:|---|---:|
| 3 | 38–53 | 44,231 | `f169ec9cb51907a354c4d9475089bc164265df0d9b0aa23c4a9d21918e25f2dd` | 26 / 92 / 20 | 20 | event 1, faction 1, item 6, location 5, NPC 4, quest 3 | 54 |
| 5 | 67–84 | 44,571 | `e12a4e059fb984a1c3bbb51a33ae84ebd2a9a8fc6190f25c9827ce01f79b1155` | 20 / 48 / 20 | 13 | event 4, faction 1, item 1, NPC 7 | 42 |
| 4 | 53–67 | 43,251 | `5069e943412f9855eb4448b222d247343d7514d915d58776ff90b386551ba095` | 29 / 86 / 22 | 12 | faction 2, item 2, location 2, NPC 5, other 1 | 49 |

The three per-chunk references contain 145 identity occurrences and 45 historical-miss occurrences. After deduplicating cross-chunk repetition, they contain 106 identities and 37 historical misses. Occurrence-weighted metrics are primary because each model was independently tasked and constrained per chunk.

## Six-call execution

All responses completed, passed schema parsing, and produced a valid post-validation extraction. `Diagnostics` counts evidence/fact/entity/relationship records rejected by the unchanged semantic validator; these are not call failures.

| # | Chunk | Model | Response ID | Latency | Input (cached/write) | Output | Total | Cost | Diagnostics | Finish |
|---:|---:|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | 3 | Luna | `resp_022c889c966c206e006aa56ecbad8487d290d595ae0f67009a` | 61.092 s | 14,266 (0 / 14,263) | 9,899 | 24,165 | unavailable | 19 | completed; no incomplete detail |
| 2 | 3 | Terra | `resp_0d33398cbcddf313006aa56f078f0c87d2ab02bd2a7e744c54` | 89.651 s | 14,266 (0 / 14,263) | 13,234 | 27,500 | $0.1944715 | 11 | completed; no incomplete detail |
| 3 | 5 | Luna | `resp_066a78aa5ed9e70e006aa56f61c2d487d28909cace736e666e` | 55.296 s | 14,475 (2,917 / 11,555) | 9,098 | 23,573 | unavailable | 3 | completed; no incomplete detail |
| 4 | 5 | Terra | `resp_092f34b0cc8ba4fa006aa56f97e02c87d2b63c3fffd7f43f77` | 101.569 s | 14,475 (2,917 / 11,555) | 14,930 | 29,405 | $0.2086369 | 6 | completed; no incomplete detail |
| 5 | 4 | Luna | `resp_0d3126650868d56a006aa56ffd74fc87d2a40a548517b2d6d7` | 52.125 s | 13,912 (2,917 / 10,992) | 8,931 | 22,843 | unavailable | 14 | completed; no incomplete detail |
| 6 | 4 | Terra | `resp_0e9d0ff8108bae16006aa570319d0c87d2a902b74b0f2fbbba` | 77.330 s | 13,912 (2,917 / 10,992) | 11,030 | 24,942 | $0.1604294 | 11 | completed; no incomplete detail |

Luna generated 36 semantic diagnostics: 15 invalid evidence excerpts, 6 facts left without valid evidence, 2 entities left without valid evidence, and 13 invalid/unresolved relationships. Terra generated 28: 14 invalid evidence excerpts, 4 facts, 3 entities, and 7 relationships. These records were removed; all reported richness metrics describe validated output.

## Primary results

The frozen-reference precision below follows the experiment definition exactly: true positives divided by all distinct extracted identities. The reference was deliberately frozen and was not exhaustive of every valid identity a model could discover. A manual source-grounding audit is therefore reported separately.

| Metric | Historical Luna | v0.4.8 Luna | v0.4.8 Terra |
|---|---:|---:|---:|
| Supported identity occurrences recalled | 73 / 145 | 69 / 145 | 99 / 145 |
| Recall | 50.3% | 47.6% | **68.3%** |
| Frozen-reference precision | **97.3%** | 87.3% | 81.8% |
| Frozen-reference F1 | 66.4% | 61.6% | **74.4%** |
| Historical misses recovered | 0 / 45 | 10 / 45 | **25 / 45** |
| Historical-miss recovery | 0.0% | 22.2% | **55.6%** |
| Valid facts | 226 | 208 | **309** |
| Valid evidence records | 377 | 359 | **522** |
| Valid relationships | 62 | 42 | **71** |
| Output tokens | 31,576 | 27,928 | 39,194 |
| Total tokens | 74,043 | 70,581 | 81,847 |
| Recorded cost | unavailable | unavailable | $0.5635378 |
| Invalid calls/schema failures | 0 | 0 | 0 |

Terra improved supported recall by 20.7 percentage points and historical-miss recovery by 33.3 points over current Luna. It also exceeded historical Luna recall by 17.9 points. Current Luna recovered ten historical misses but recalled four fewer reference occurrences than historical Luna; the prompt change alone did not produce a stable aggregate recall improvement on this adversarial sample.

### Per chunk

| Chunk | Historical recall / precision / F1 | Luna recall / precision / F1 | Terra recall / precision / F1 | Luna miss recovery | Terra miss recovery |
|---:|---:|---:|---:|---:|---:|
| 3 | 48.1% / 100.0% / 65.0% | 40.7% / 91.7% / 56.4% | **64.8% / 92.1% / 76.1%** | 3 / 20 | **7 / 20** |
| 5 | 47.6% / 100.0% / 64.5% | 64.3% / 87.1% / 74.0% | **83.3% / 71.4% / 76.9%** | 5 / 13 | **10 / 13** |
| 4 | 55.1% / 93.1% / 69.2% | 40.8% / 83.3% / 54.8% | **59.2% / 85.3% / 69.9%** | 2 / 12 | **8 / 12** |

Terra won recall, F1, and historical-miss recovery in every pair. Its largest breadth increase was chunk 5, where it returned 49 entities against Luna's 31.

### Occurrence-weighted recall by type

| Type | Expected | Historical Luna | v0.4.8 Luna | v0.4.8 Terra |
|---|---:|---:|---:|---:|
| NPC | 70 | 57.1% | 60.0% | **88.6%** |
| Location | 28 | 50.0% | 64.3% | **75.0%** |
| Faction | 12 | **50.0%** | 41.7% | 33.3% |
| Item | 11 | 9.1% | 0.0% | **27.3%** |
| Quest | 9 | **44.4%** | 11.1% | 0.0% |
| Event | 13 | **53.8%** | 15.4% | **53.8%** |
| Deity | 1 | 100.0% | 100.0% | 100.0% |
| Other | 1 | 0.0% | 0.0% | **100.0%** |

Terra's gain is concentrated in NPCs, locations, events, and some items. It does not solve systematic breadth: both current models fail items badly; Terra recalled none of nine quest occurrences and only four of twelve faction occurrences. This is a critical category failure, not a marginal model-choice issue.

## Reference-bounded false positives and manual review

Every extraction that failed frozen-reference matching was manually checked against its own retained evidence. All were source-grounded identities or concepts, so none was a content hallucination. They remain false positives for the fixed-reference calculation, as required; the distinction prevents an intentionally frozen but non-exhaustive reference from being silently expanded after seeing model output.

| Model | Chunk | Reference-bounded false positive | Manual classification |
|---|---:|---|---|
| Luna | 3 | The Comet Strike | Source-grounded event (pages 43/53) |
| Luna | 3 | Xancrown | Explicitly named source-grounded being (page 44) |
| Luna | 5 | Black-steel arrows | Source-grounded item/generic-noun candidate (page 72) |
| Luna | 5 | Medicinal herbs | Source-grounded item/generic-noun candidate (page 72) |
| Luna | 5 | Olduce's Loyalty | Explicit quest heading/hook (page 69) |
| Luna | 4 | Fort Icewind Refugee Camp | Explicit location heading (page 63) |
| Luna | 4 | Cult of Chaos | Explicitly named faction (page 63) |
| Luna | 4 | Find Harlyot | Explicit quest heading (page 56) |
| Luna | 4 | Comet Impact and Melt | Source-grounded event concept (page 57) |
| Terra | 3 | Xancrown | Explicitly named source-grounded being (page 44) |
| Terra | 3 | Luna Valley | Explicitly named location (page 38) |
| Terra | 3 | Baryl Harb goblins | Explicitly named faction/group (page 39) |
| Terra | 5 | Order of the Last Bastion Barracks | Source-grounded location (page 67) |
| Terra | 5 | Olduce's Loyalty | Explicit quest heading/hook (page 69) |
| Terra | 5 | Military Might | Explicit special mission/hook (page 69) |
| Terra | 5 | Paumine's Medicinal Herbs | Source-grounded item/reward (page 72) |
| Terra | 5 | Isperil's Peril | Explicit event heading (page 67) |
| Terra | 5 | Malaga Taerwain | Explicit named candidate (page 75) |
| Terra | 5 | Jorney Yovurn | Explicit named candidate (page 75) |
| Terra | 5 | Someth Skullcleaver | Explicit named candidate (page 75) |
| Terra | 5 | Harlyot | Explicit named person reference (page 75) |
| Terra | 5 | Nibhin Blondbeard | Explicit named candidate (page 75) |
| Terra | 5 | Hemlet Slayer | Explicit label, but typed as NPC where the cross-chunk reference treats the murders as an event (page 75) |
| Terra | 5 | Jeanas Clocker | Explicit named candidate (page 76) |
| Terra | 5 | Borden | Explicit named prisoner (page 82) |
| Terra | 5 | Gower | Explicit named prisoner (page 82) |
| Terra | 4 | Jelinghi the Wise's Home | Explicit location heading (page 58) |
| Terra | 4 | Luna Valley | Explicitly named location (page 58) |
| Terra | 4 | Ice Tongue Glacier | Explicitly named location (page 63) |
| Terra | 4 | Cult of Chaos | Explicitly named faction (page 63) |
| Terra | 4 | Fort Icewind Refugee Camp | Explicit location heading (page 63) |

There were no ambiguous matches or within-output duplicate identities. Luna also typed `Reson's Body` as a quest rather than the reference event. Treating source grounding rather than reference membership as the precision question yields 100% grounded-identity precision for both current models in this sample, but does not erase the frozen-reference precision or the type errors.

## Richness and output pressure

| Metric | Historical Luna | v0.4.8 Luna | v0.4.8 Terra |
|---|---:|---:|---:|
| Entities returned | 75 | 79 | 121 |
| Facts | 226 | 208 | 309 |
| Facts per true positive | 3.10 | 3.01 | 3.12 |
| Evidence per true positive | 5.16 | 5.20 | 5.27 |
| Relationships | 62 | 42 | 71 |
| Summary characters | 7,733 | 7,247 | 11,822 |
| Entities with at most one fact | 12 | 20 | 39 |
| Output JSON characters | 115,772 | 100,777 | 148,617 |
| Output JSON bytes | 116,244 | 101,069 | 149,091 |

Terra retained substantially more shallow entities without reducing average facts or evidence per matched identity. Its 48 extra output entities versus Luna came with 101 extra facts, 163 extra evidence records, and 29 extra relationships. This is a real quality gain, not merely verbose naming. However, Terra used 40.3% more output tokens and produced 47.5% more JSON characters. Both current models still exhibit breadth/depth competition: current Luna regressed below the historical output on facts and relationships, while Terra's larger output still omitted every quest in the reference. No response reported an incomplete finish or explicit truncation, so the experiment does not claim hard truncation.

The manual qualitative review covered the dense NPC/election material in chunk 5, item-heavy hooks in chunks 3/5, location-heavy camp material in chunks 3/4, and quest/event headings across all three chunks. Luna favored richer major-entity records and omitted many minor named identities. Terra retained far more minor NPCs and locations, including Borden and Gower, but still missed explicit item/quest headings. Generic-noun candidates were limited to arrow/herb items. Unsupported evidence, facts, entities, and relationships were rejected by the existing validator; no invented relationship survived validation.

## Cost and latency

Luna consumed 42,653 input and 27,928 output tokens (70,581 total) in 168.513 seconds. Terra consumed the same 42,653 input tokens and 39,194 output tokens (81,847 total) in 268.550 seconds. Terra therefore used 11,266 more output tokens (+40.3%), 11,266 more total tokens (+16.0%), and 100.037 more seconds (+59.4%).

The repository pricing table does not contain Luna pricing, so Luna cost and the exact total experiment cost/delta are unavailable and are not guessed. Terra's consistently calculated estimate was $0.5635378 total, $0.005692 per frozen-reference true positive, and $0.0225415 per recovered historical-miss occurrence. Across the 47 unique source pages represented, Terra extrapolates to $1.198 per 100 source pages. At the observed three-chunk average, a nine-chunk Terra extraction extrapolates to $1.6906134. These are sample extrapolations, not invoices.

## Decision

`REDESIGN_EXTRACTION_PIPELINE`

Terra is materially better than Luna on recall and is the stronger extraction model under the current single-pass task. Nevertheless, the experiment's architecture threshold controls: both current models remain below 90% supported recall, both show systematic category failures, and Terra remains at 0% quest recall despite materially larger output. A permanent production model switch is therefore not recommended as the complete remedy, and no production model setting was changed.

The next milestone should be a narrow extraction-pipeline redesign before M6: first produce a compact entity inventory with explicit category coverage, then perform a rich fact/relationship pass over that inventory. Re-run this same frozen benchmark deterministically after implementing the redesign. Terra is the leading model candidate for the inventory pass, but that choice should be tested within the redesigned two-pass budget rather than silently promoted now.

## Benchmark integrity

- Test 2, original Test 3, and Test 3 Recovery were read-only.
- Campaign writes: 0.
- Official extraction-cache/checkpoint writes: 0.
- Reconciliation calls: 0.
- Enrichment calls: 0.
- Luna generation calls: 3.
- Terra generation calls: 3.
- Total application-level OpenAI generation calls: 6; SDK retries: 0.
- Known Terra cost: $0.5635378; Luna and exact combined experiment cost unavailable because the pricing table does not know Luna.

Post-experiment read-only verification confirmed Test 2 remained complete at 156 entities/262 relationships with `updated_at` `2026-09-05T16:26:22.735256+00:00`; original Test 3 remained failed at 0 persisted entities/relationships with `updated_at` `2026-09-10T16:54:42.631934+00:00`; and Test 3 Recovery remained complete at 112 entities/145 relationships with `updated_at` `2026-09-12T12:08:38.933672+00:00`. The cached Test 3 graph fingerprint remained `3784abc868d51b2df1ff7b212a391b09424f918fe33814b4485c56e4293bc5d6`.

## Deterministic verification

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: 31 files and 262 tests passed.
- `npm run build`: pass under Next.js 16.3.4.
- `npm run evaluate:recall`: pass; 52 extraction misses and 0 reconciliation losses unchanged.
- `npm run evaluate:extraction-workload`: pass; 9 cached chunks and graph fingerprint unchanged.
- `npm run evaluate:extraction-ab -- --summary`: pass; read-only scoring, 6 recorded attempts, and 0 campaign/reconciliation/enrichment writes or calls.
- `git diff --check`: pass (line-ending conversion warnings only).
