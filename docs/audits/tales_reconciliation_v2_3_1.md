# Tales reconciliation 2.3.1 offline audit

Release 0.6.11 starts from `1abfc735a8c30e42f91aaef65cb491bcaaada040` on
`codex/v0.6.7-claims-experiment`. Zero model/API calls, extraction, database writes,
frontend changes or deployment. Git commit/push is the only authorized remote
operation. Claims-4.1 and the 2.2.4/2.3.0 reconciliation modules remain unchanged.

## Frozen inputs and execution

Acceptance: `fixtures/private/tales-full-claims-acceptance-v1/`, manifest
`eb970869b2b54ea72d7a5a220a8120abda8b43fd6e6cd149337e1f699b399621`.
All 1,891 raw proposals, proposal indexes, request provenance, evidence IDs and raw
spans are preserved. Raw proposal file byte SHA-256:
`377a26670a3e7879bf36f78d24933f5f2b8bfc68f5e425e976b1db33052c170d`.
Raw proposal value SHA-256:
`e52dd78bd74543454ed7a5343b3c11ecfd61695f0ea542351d5c39421ace6584`.

The offline parity fix was applied first: normalization receives `structure.units`.
The corrected 2.3.0 replay, `tales-full-reconciliation-230-parity-v1`, manifest
`ae487f7dc2f621844788b4050523b79a2676b30c904c164a60be9908a718b656`,
is exactly equal to the saved 2.3.0 v3 complete result. Its counts do not change.

Exactly one full-document 2.3.1 execution produced immutable replay v1, manifest
`1905d4a22df48d75b7b057ac7abc6af3510f4e8df279f7d7611454d6dbd9334e`.
The final private `tales-full-reconciliation-231-replay-v2` export, manifest
`7a16d46c5a9fadfd17a6a92d492a8b0b8e50db7ddfe539dbd7b7b5cd8e49fb2d`,
copies those result bytes and corrects audit reasons/classifications while adding
case assertions. It performs zero additional reconciliation executions. v1 and all
historical artifacts remain intact; every manifest-listed artifact is hash-verified.

## Before/after diagnostic counts

Counts are observations, not accuracy scores or tuning targets. Literal same-name
groups use case/whitespace normalization; article-normalized groups also remove
leading `The`. Cross-type groups use the latter, and remain separate unless proven.

| Metric | 2.2.4 acceptance | 2.3.0 parity replay | 2.3.1 |
|---|---:|---:|---:|
| Inventory entities | 317 | 306 | 304 |
| Normalization merges | 0 | 11 | 13 |
| Literal same-name groups | 6 | 5 | 3 |
| Remaining article-normalized cross-type groups | 7 | 7 | 5 |
| Raw proposals | 1,891 | 1,891 | 1,891 |
| Resolved | 1,512 | 1,331 | 1,381 |
| GM Review | 331 | 512 | 462 |
| Mechanical-only | 48 | 48 | 48 |
| Canonical participants | 2,631 | 2,570 | 2,626 |
| Candidate participants | 320 | 17 | 17 |
| Generic participants | 237 | 385 | 385 |
| Unresolved participants, including mechanical-only | 395 | 611 | 555 |
| Descriptor participants | 1 | 1 | 1 |
| Candidate entities | 143 | 8 | 8 |
| Entity-associated claims | 1,748 | 1,640 | 1,672 |
| Timeline-associated claims | 0 | 11 | 11 |
| No useful home | 95 | 201 | 169 |

| Source status | 2.2.4 | 2.3.0 | 2.3.1 |
|---|---:|---:|---:|
| Established | 1,681 | 1,633 | 1,633 |
| GM instruction | 20 | 20 | 20 |
| Conditional | 173 | 180 | 180 |
| Plan | 16 | 16 | 16 |
| Rumor | 1 | 31 | 31 |
| Scheduled | 0 | 11 | 11 |

The 2.3.1 delta is 56 newly canonical participants and 50 newly resolved claims.
Candidate, generic and descriptor counts are unchanged. Every claim retains its
2.3.0 mechanics disposition, source status, Timeline association, direct/context
evidence, identity relations and source-discrepancy flag.

## Requested collision groups

Occurrences below count present claims; mechanical-only participants are excluded.
The full private collision audit lists canonical/original IDs, entity types,
proposal indexes, resolution method and reason for every occurrence in every
same-name inventory group. Merged occurrences are counted separately from the
number of inventory merge records.

| Group | Final interpretations | Occurrences | Direct provenance | Type grammar | Safe merges / merged occurrences | Unresolved |
|---|---|---:|---:|---:|---:|---:|
| Moon Spire | location / quest | 61 | 0 | 8 | 0 / 0 | 53 |
| Void | location / other | 28 | 2 | 7 | 0 / 0 | 19 |
| Iron Titan | item (other absorbed) | 27 | 0 | 0 | 1 / 27 | 0 |
| Gibbering Fever | other / quest | 12 | 0 | 7 | 0 / 0 | 5 |
| Academy of Engineers | faction / location | 9 | 0 | 3 | 0 / 0 | 6 |
| The Red Light of the Woods | deity (other absorbed) | 2 | 0 | 0 | 1 / 2 | 0 |
| Temple of Shadows | location / quest | 0 | 0 | 0 | 0 / 0 | 0 |

Iron Titan's shared source explicitly establishes the construct; its independent
appendix source supports the same classification. The Red Light records share the
same explicit worship source. Both fallback merges preserve original IDs, source
records and evidence. No additional cross-type merge is permitted.

Moon Spire selects location for direct physical/entry grammar; it never globally
merges location and quest. Academy selects faction for a commissioned organizational
action and location for source-supported site/complex grammar. Disease grammar
selects the existing other identity for Gibbering Fever. Void uses both unique
provenance and direct spatial grammar; unresolved mentions retain their source
limitations. Temple retains distinct records and receives no manufactured claim.
No collision group creates a new reconciliation candidate. Residual same-label
type conflicts are not asserted to be genuine semantic homonyms.

Other original same-name groups retain 2.3.0 same-type normalization. Their present
participant occurrence counts are Demon Lord 21, New God 5, Brotherhood of Shadows
60, Brown Cloaks 14, Old Faith 8, Eye of the Demon Lord 58, Old Fishery 6, Pit 1,
and Shrine of the Ascended 7. All resolve through compatible-type normalization;
none has a new cross-type merge or unresolved occurrence. Void also retains its
historical compatible location merge; its two remaining types are not merged.

## Residual GM Review diagnostic audit

There are 481 unresolved occurrences on present claims; another 74 unresolved
participant records belong to mechanical-only claims and are excluded here.
Classification is diagnostic and changes no production semantics. An unmatched
non-generic mention is classified as unresolved unique identity without claiming
that uniqueness is proven. Same-label type conflicts without proof of independent
identities are `other`, not automatic true identity ambiguity. Collision mentions
absent from the direct span are classified as unresolved coreference. The complete
frequency-sorted private export contains all mentions and proposal indexes.

| Category | Occurrences |
|---|---:|
| True inventory ambiguity established by independent named identities | 0 |
| Unresolved unique identity / unmatched non-generic mention | 342 |
| Unresolved coreference | 62 |
| Generic not recognized | 55 |
| Source/provenance problem | 1 |
| Other, including unresolved same-label type interpretation | 21 |

| Top mention | Frequency | Diagnostic category |
|---|---:|---|
| Moon Spire | 53 | coreference / other |
| Void | 19 | other / coreference |
| City Council | 16 | unmatched identity |
| Cursed creature | 16 | generic not recognized |
| Character | 10 | generic not recognized |
| Orcs | 9 | generic not recognized |
| Stronghold | 9 | unmatched identity |
| Gremlins | 7 | generic not recognized |
| Academy of Engineers | 6 | other / coreference |
| Drudge Loyalist Caves | 6 | unmatched identity |
| Eyeball | 6 | generic not recognized |
| Ritual | 6 | unmatched identity |
| Boggarts | 5 | generic not recognized |
| Ghastly Chorus | 5 | unmatched identity |
| Gibbering Fever | 5 | coreference |

This audit points to possible later source-linked coreference and generic handling
work. Neither is changed in this release to improve counts.

## Historical replay and verification

Saved WotBS/Sweetwater 2.2.4 complete results remain exact through both historical
and document entry points. Hashes:
`c5b7c6dc7643074bbbe7d9ad121d17f9dd125c3ef692aa75a37a60ae0bbc7046`
and `653fbfe3b64e4bb71e75386cc17362477e02cf033fb008b085d8b1c7b35bba81`.

| Benchmark | Proposals | 2.2.4 resolved/review | 2.3.0 | 2.3.1 |
|---|---:|---:|---:|---:|
| WotBS | 106 | 94 / 12 | 87 / 19 | 87 / 19 |
| Sweetwater | 148 | 137 / 8 | 137 / 8 | 137 / 8 |

WotBS keeps its seven previously exposed ambiguities. Sweetwater retains three
mechanical-only claims. Neither benchmark has changed claim indexes from 2.3.0 to
2.3.1; source status, candidate counts and Timeline counts remain unchanged.

Final tracked verification passes 95 files / 1,126 tests. The 29 private Tales
assertions pass. Verification includes generic 2.3.1 collision and normalization tests, production /
offline structured-unit parity, source structure, document pipeline, historical
2.2.4 exact replay, 2.3.0 regressions, frozen extraction hashes, typecheck, lint and
diff whitespace checks. The canonical test command passes outside the Windows
temporary-file sandbox. A pre-existing untracked holdout suite is excluded from
tracked verification: its frozen-code byte hash rejects the untouched extraction
file. Its four untracked files are preserved. Lint has one existing unused-variable
warning in `tests/entity-reconciliation.test.ts:315` and zero errors.

Prompt SHA-256:
`d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58`.
Schema SHA-256:
`16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb`.
