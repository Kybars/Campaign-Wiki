# Tales reconciliation 2.3.2 offline audit

Baseline: `f7e92e4a601c50c2de6d723fb27a341199c5ef1b`.
The single document-wide 2.3.2 execution preserved all 1,891 proposals, their
indexes, evidence IDs and raw spans. No model/API calls, DB/frontend changes or
deployment occurred. Inventory remains 304 entities with 13 existing merges;
no additional normalization was performed.

| Metric | 2.2.4 acceptance | 2.3.0 parity | 2.3.1 | 2.3.2 |
|---|---:|---:|---:|---:|
| Resolved | 1512 | 1331 | 1381 | 1464 |
| GM Review | 331 | 512 | 462 | 379 |
| Canonical participants | 2631 | 2570 | 2626 | 2632 |
| Candidate participants | 320 | 17 | 17 | 17 |
| Generic participants | 237 | 385 | 385 | 526 |
| Unresolved participants | 395 | 611 | 555 | 408 |
| Candidate entities | 143 | 8 | 8 | 8 |
| Entity-associated claims | 1748 | 1640 | 1672 | 1674 |
| Timeline-associated claims | 0 | 11 | 11 | 11 |
| No useful home | 95 | 201 | 169 | 167 |

Mechanical-only claims remain 48. Source statuses remain exactly equal to
2.3.1: established 1633, GM instruction 20, conditional 180, plan 16, rumor 31,
scheduled 11. Counts are diagnostic, not numeric targets.

| Collision | Occurrences | 2.3.1 canonical / unresolved | 2.3.2 canonical / unresolved |
|---|---:|---:|---:|
| Moon Spire | 61 | 8 / 53 | 9 / 52 |
| Gibbering Fever | 12 | 7 / 5 | 7 / 5 |
| Academy of Engineers | 9 | 3 / 6 | 5 / 4 |
| Void | 28 | 9 / 19 | 10 / 18 |

New anchored canonical occurrences (zero-based indexes): Moon Spire 770,
Academy 1332/1333, Void 1534, and stronghold 1533/1534. Anchors respectively
`u-22-1-7`, `u-35-1-1`, `u-40-1-10`. Physical Moon references select location;
Academy organizational references select faction. The other four identities
are not merged. Existing disease coreferences now carry explicit proposition
anchor provenance while preserving their identity.

Every one of the 53 prior Moon residual occurrences and all five prior disease
residual occurrences is exported with its direct evidence, context and preceding
scope unit IDs. Most Moon references occur in sibling frozen contexts that do
not contain the named/type anchor; the resolver does not cross those boundaries.
Disease residuals at 654, 657, 658 and 660 concern carriers, Insanity or
transformation rather than an unambiguous disease reference. Index 667 occurs
in a sibling scope without the anchor. Academy's four residuals and Void's
18 retain insufficient unique bounded support. This task does not repair
source-structure boundaries or manufacture missing anchors.

| Generic audit | Occurrences | Generic 2.3.1 → 2.3.2 | Remaining unresolved |
|---|---:|---:|---:|
| Cursed creature | 16 | 0 → 15 | 1 |
| Character | 10 | 0 → 10 | 0 |
| Orcs | 36 | 27 → 31 | 5 |
| Gremlins | 7 | 0 → 6 | 1 |
| Boggarts | 5 | 0 → 5 | 0 |
| miners | 17 | 17 → 17 | 0 |
| ghouls | 9 | 9 → 9 | 0 |
| demons | 5 | 5 → 5 | 0 |
| cultists | 10 | 10 → 10 | 0 |
| guards | 3 | 3 → 3 | 0 |

These mentions create zero candidates. Across all mentions, 141 occurrences
change unresolved → generic and six unresolved → canonical. Another 217 generic
and ten canonical participants retain their resolution with new source proof.
All 374 changed participant objects are exported individually, including proposal
and participant index, before/after, reason, raw source evidence and anchor.

## Residual decision artifact

334 unresolved participant occurrences belong to presentable claims; another
74 belong to unchanged mechanical-only claims. Deterministic audit categories:
missing stable unique identity 214; unresolved structural/coreference 114;
source/provenance problem 1; other 5; proven genuine inventory ambiguity 0;
generic not recognized by the implemented proof rules 0. These labels are
diagnostic: neither a missing identity's uniqueness nor semantic homonymy is
established merely by counting inventory types. Remaining generic-looking
mentions may lack sufficient bounded proof.

| Top unresolved mention | Frequency | Audit category |
|---|---:|---|
| Moon Spire | 52 | structural/coreference; other |
| Void | 18 | structural/coreference; other |
| City Council | 16 | missing stable unique identity |
| stronghold | 7 | missing identity; structural/coreference |
| Drudge Loyalist Caves | 6 | missing stable unique identity |
| Ghastly Chorus | 5 | missing stable unique identity |
| Gibbering Fever | 5 | structural/coreference; other |
| Orcs | 5 | missing identity; structural/coreference |
| shadow manifestation | 5 | missing stable unique identity |
| Academy of Engineers | 4 | structural/coreference |

Unique-designation handling remains deferred. The principal remaining work is
source-scope/coreference coverage and missing stable designations, rather than
additional global inventory merging. No further semantic class was implemented.

## Historical regression and verification

Saved 2.2.4 results remain exact for WotBS 106 and Sweetwater 148 proposals,
using both historical and document entry points. Result hashes:
`c5b7c6dc7643074bbbe7d9ad121d17f9dd125c3ef692aa75a37a60ae0bbc7046` and
`653fbfe3b64e4bb71e75386cc17362477e02cf033fb008b085d8b1c7b35bba81`.
2.3.0/2.3.1 source remains unchanged; their historical outputs remain equal.

2.3.2 changes only source-proof annotations in WotBS indexes 101/102 and
Sweetwater 23, 80, 85, 86, 93, 94, 95, 108, 109, 120, 126, 131, 142, 144.
Participant kinds/IDs, resolution, associations, source statuses, mechanics and
identity relations are unchanged. Sweetwater 23/94/95/109/144 also add the
supporting context unit to claim evidence. Complete claim objects are exported
privately. WotBS remains resolved/review 87/19; Sweetwater 137/8 with three
mechanical-only claims. Historical artifacts were not overwritten.

Verification includes 24 source-agnostic 2.3.2 tests, old reconciliation tests,
inventory normalization, source structure, offline replay, document pipeline and
historical exact replay. Typecheck and lint pass (one pre-existing unused-variable
warning). Full tracked-suite results are recorded in CURRENT_STATE. An unrelated
pre-existing untracked holdout test remains excluded; its frozen-code hash fails.

## Private artifact identities

Bundle: `fixtures/private/tales-full-reconciliation-232-replay-v1/`.
Manifest: `e9a40e03cc185787103d2d47ab52b97773dbd0e34420ed04c166d81c5adf1d79`.
Acceptance manifest:
`eb970869b2b54ea72d7a5a220a8120abda8b43fd6e6cd149337e1f699b399621`.
Raw bytes: `377a26670a3e7879bf36f78d24933f5f2b8bfc68f5e425e976b1db33052c170d`.
Raw value: `e52dd78bd74543454ed7a5343b3c11ecfd61695f0ea542351d5c39421ace6584`.
Frozen prompt: `d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58`.
Frozen schema: `16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb`.

No private source text or source-derived participant/claim outputs are published.
