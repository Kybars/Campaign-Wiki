# WotBS Stage 1 Pass-A identity/page grounding repair

## Decision

`WOTBS_PASS_A_RELIABLE_RECALL_LOW`

The repaired production Pass A is structurally reliable and compact on the frozen three-page WotBS fixture. It returns only `name`, `type`, and `page`; application code grounds each identity to source text, selects bounded evidence, and assigns deterministic IDs. The sole production attempt validated in 29.919 seconds with 39 authoritative entities and no grounding failure or ID collision. Hidden-gold supported-entity recall was 86.0%, below the 90% validation threshold, although all 12 explicit Quests and both Items were recovered.

No Pass B call was made. This audit preserves the earlier `WOTBS_STAGE1_PASS_A_FAILED` result rather than replacing it.

## Starting state and fixture

- HEAD: `cdbaff0b9f06d747ad438c1e2e665e7575517c13`
- All existing v0.4.9, compact-Pass-A, source-size, and WotBS working-tree changes were preserved.
- No reset, discard, commit, push, Demonplague benchmark, campaign persistence, or paid call occurred.
- Frozen source: `War of the Burning Sky Campaign Guide` PDF pages 10-12, 3 pages, 11,083 extracted characters, one production chunk.
- PDF SHA-256: `509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990`.
- Production-normalized text SHA-256: `b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281`.
- Runtime: local Ollama `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, context 32,768, temperature 0, reasoning none, concurrency 1.

## Failed-output analysis

The prior failed Stage-1 response was not retained. The artifact contains only a 500-character prefix and the nested parse error at character 108,215. Therefore completed-object count, full type distribution, duplicate names, repeated evidence, repeated fragments, and n-gram analysis are unavailable and were not reconstructed or guessed.

The surviving prefix contains coherent, source-backed records for Drakus Coaltongue and the Ragesian Empire. It does not itself show repetition, but it is too small a sample to characterize the 108k-character response. The earlier partial JSON was not repaired or scored and no retry was made.

## Diagnostic A - name and type only

Experiment-only strict fields: `name`, `type`.

| Metric | Result |
| --- | --- |
| Valid | yes |
| Latency | 17.569 s |
| Input/output/total tokens | 3,197 / 672 / 3,869 |
| Output characters/bytes | 1,769 / 1,769 |
| Entities | 27 |
| Normalized-name duplicates | 0 |
| Per-type counts | NPC 11, Location 11, Faction 2, Item 1, Event 2; Quest/Deity/Other 0 |
| Supported-entity recall | 23/43 = 53.5% |
| Reference-bounded precision | 23/27 = 85.2% |
| F1 | 65.7% |
| Adventure titles | 0/12 |
| Quest recall | 0% |
| Item recall | 50% |
| Named anchors | 9/9 |

Per-primary-type recall: NPC 9/11 (81.8%), Location 12/14 (85.7%; accepted alternate types count), Faction 1/1, Item 1/2, Quest 0/12, Event 0/2, Other 0/1.

Diagnostic A proves multi-category identity-only structured generation is compact and stable, but its 53.5% recall is severely low. Structural reliability is not treated as quality success.

## Diagnostic B - name, type, and page

Experiment-only strict fields: `name`, `type`, `page`, where page is one of 10, 11, or 12.

| Metric | Result |
| --- | --- |
| Valid | yes |
| Latency | 29.504 s |
| Input/output/total tokens | 3,230 / 1,449 / 4,679 |
| Output characters/bytes | 3,783 / 3,783 |
| Entities | 43 |
| Normalized-name duplicates | 0 |
| Per-type counts | Quest 13, NPC 12, Location 9, Faction 6, Item 2, Event 1 |
| Supported-entity recall | 39/43 = 90.7% |
| Reference-bounded precision | 39/43 = 90.7% |
| F1 | 90.7% |
| Adventure titles | 12/12 |
| Quest recall | 100% |
| Item recall | 100% |
| Named anchors | 8/9; Shalosha missed |

Per-primary-type recall: NPC 10/11 (90.9%), Location 14/14, Faction 1/1, Item 2/2, Quest 12/12, Event 0/2, Other 0/1.

Deterministic page audit: all 43 identities referenced an allowed page and all 43 had an exact normalized-name occurrence on that page. There were zero inferred-token fallbacks, zero grounding failures, and zero exclusions. Page distribution was 20 on page 10, 16 on page 11, and 7 on page 12.

The large A/B recall difference is a model-output result under two separately authorized frozen calls; it is not averaged or hidden. Adding the locator remained compact and provided the better production contract.

## Production repair

### Model contract

Production Pass A now strictly permits only:

```text
name
type
page
```

The model cannot emit IDs, aliases, evidence, excerpts, summaries, facts, relationships, roles, or extra fields. Aliases remain Pass-B data. The general production prompt explicitly preserves named minor entities and explicit adventure/quest/mission/scenario titles while requiring one directly supporting supplied page.

### Deterministic grounding policy

For each schema-valid entity:

1. Resolve the model page against the current chunk; an absent page fails closed.
2. Collapse source whitespace deterministically and tokenize Unicode letters/numbers.
3. Prefer a contiguous exact normalized-name token match on that page.
4. Only for Event or Quest labels without an exact match, allow deterministic anchor matching when at least two significant non-stopword tokens match, at least 75% of significant label tokens match (with a bounded six-character morphological stem), and matched anchors occur within 600 source characters.
5. Select the surrounding source sentence/span, trim on word boundaries where possible, and cap it at 240 characters.
6. If neither grounding strategy yields a bounded source span, exclude the entity from the authoritative inventory and emit source/entity diagnostics. There is no semantic repair generation.

The selected excerpt is derived only from source text. It is never model-generated. The validated inventory fingerprint includes the deterministic grounding output, so a grounding change invalidates dependent rich output.

### Deterministic IDs and checkpoints

Inventory IDs hash:

```text
source/chunk fingerprint
normalized entity type
normalized source-facing name
resolved page
```

Excerpt text is not part of ID identity. Output sorting makes IDs stable across model array reorder, serialization, and restart. Type is part of identity, so same-name/same-page cross-type entities remain distinct without an ordinal. Exact duplicate `name + type + page` records are conservatively deduplicated because the identity-only contract provides no evidence that they represent distinct logical identities; a true hash collision fails closed.

Inventory behavior changed from `v0.4-compact-inventory-2` to `v0.4-identity-page-grounding-3`; inventory contract version changed from 2 to 3. V2 excerpt-producing checkpoints are incompatible. V3 raw output is re-grounded and compared with the stored validated inventory before reuse. Inventory fingerprint changes continue to invalidate rich checkpoints, while rich-model-only changes preserve inventory reuse. The rich contract remains v2.

## Production Call C - repaired Pass A

Exactly one production Pass-A attempt ran through the production prompt, strict schema, local structured provider, source validator, grounding, and deterministic-ID boundary.

| Metric | Result |
| --- | --- |
| Valid | yes |
| Latency | 29.919 s |
| Input/output/total tokens | 3,313 / 1,318 / 4,631 |
| Output characters/bytes | 2,113 / 2,113 |
| Raw entities | 39 |
| Authoritative entities | 39 |
| Deterministic IDs/collisions | 39 / 0 |
| Normalized-name duplicates | 0 |
| Grounding | 39 exact, 0 inferred, 0 failed/excluded |
| Validation diagnostics | 0 |
| Supported-entity recall | 37/43 = 86.0% |
| Reference-bounded precision | 37/39 = 94.9% |
| F1 | 90.2% |
| Adventure titles | 12/12 |
| Quest recall | 100% |
| Item recall | 100% |
| Named anchors | 8/9; Shalosha missed |

Production per-type counts: Quest 12, Location 8, NPC 6, Faction 6, Other 4, Item 2, Event 1.

Per-primary-type recall: NPC 8/11 (72.7%), Location 13/14 (92.9%), Faction 1/1, Item 2/2, Quest 12/12, Event 0/2, Other 1/1.

Frozen-reference misses: Shalosha, Indomitability, Etinifi, Innenotdar, Assassination of Drakus Coaltongue, and The Scourge. The output did contain source-grounded `Scourge` as Event, but the frozen evaluator does not treat removal of the leading article from gold name `The Scourge` as an accepted alias; the gold was not changed after the result.

The two reference-unmatched authoritative identities were manually audited:

- `Scourge` (Event, page 10) is explicitly source-supported; its bounded-gold mismatch is the leading-article naming difference above.
- `Avilona` (Other, page 12) is explicitly source-supported and appears in the frozen soft reference with accepted types Other or Deity.

Thus all 39 authoritative identities have deterministic source grounding, and neither reference-unmatched identity is unsupported. Reference-bounded precision remains reported unchanged at 94.9% rather than rescored after review.

## Verification

Before production Call C, the following passed:

- `npm run lint`
- `npm run typecheck`
- `npm test` - 38 files, 299 tests
- `npm run build`
- `npm run evaluate:two-pass-extraction`
- `npm run evaluate:checkpoints`
- `npm run evaluate:recall`
- focused WotBS source-hash, page-provenance, gold-isolation, identity-only schema, identity-page schema, deterministic grounding, inferred-event grounding, failure exclusion, ID stability, candidate survival, endpoint grounding, and checkpoint-invalidation tests

All deterministic evaluations made zero generation calls and zero writes.

## Safety

- New local generation calls: `3` exactly (Diagnostic A, Diagnostic B, Production C)
- OpenAI generation calls: `0`
- Pass-B live calls: `0`
- Reconciliation calls: `0`
- Enrichment calls: `0`
- Campaign writes: `0`
- Official checkpoint/cache writes: `0`
- Gold-reference leakage: `0`
- Demonplague artifacts: unchanged
- Gold reference and WotBS source: unchanged
- Commit/push: none

## Commit recommendation

The accumulated work is coherent enough for a clearly labeled checkpoint commit of the v3 identity/page grounding contract: the production boundary is deterministic, tested, compact, and live-valid. Do not label that checkpoint as WotBS Stage-1 end-to-end validation; Pass A remains below the recall target and Pass B was intentionally not run.

## Next milestone

Focused repair of the failing WotBS Pass-A recall branch, especially named NPC and Event discovery, while freezing the successful `name + type + page` contract and avoiding gold-fed prompt tuning. Only after that repair should WotBS Stage 1 be rerun end-to-end with Pass B.
