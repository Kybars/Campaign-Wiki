# Claims-4.1 Reconciliation v2 — offline WotBS comparison

This is a deterministic replay of the saved WotBS physical pages 13–14 Claims-4.1 response. It uses the same 106 original proposals, statements, participant strings, evidence IDs, frozen units, offsets, and request boundary. The original reconciler remains callable and its saved 70 ready / 36 pending-identity result reproduces exactly. No model call, entity creation, production write, or extraction change occurred.

The detailed claim-level comparison and one GM Review collection are local-only at `fixtures/private/claims4-1-v2/comparison.v2.json`. That ignored file contains source-derived statements and evidence. This audit records only metrics and concise link changes.

## V2 contract

Each proposal receives `resolutionState: resolved | needs_review`, its unchanged `original`, ordered `evidence`, `sourceOrder`, independent `sourceStatus`, zero or more `entityAssociations`, an optional `timelineAssociation`, participant resolutions, and concise `reviewReasons`. A participant is exactly one of `canonical_entity`, `descriptor`, `generic_non_entity`, or `unresolved`. Canonical and descriptor records retain the source mention plus existing canonical ID and name. Descriptors preserve subdivision wording and link to a source-grounded parent. No claim owner or new entity ID is produced. `gmReview` is the single collection of all `needs_review` claims.

The timeline structure has `branch`, nullable `timeLabel`, `sourceOrder`, `evidenceUnitId`, and `propositionStatus`. Main-branch months propagate from each month marker through subsequent evidence units. Prose before November gets no dated placement. The separate heroes-do-nothing branch has no invented month. `published_scheduled`, `plan`, and `conditional` distinguish the proposition's source status from occurrence in actual play.

The frozen canonical inventory lacks a general Ragesian Army page. For ordinal Ragesian formations, the explicit demonym supports a descriptor association with existing Ragesia. This is national affiliation, not an assertion that the distinct army is identical to Ragesia. A canonical Ragesian Army in another inventory takes priority when the source names it. Shortened later references are resolved only when an earlier explicit ordinal formation and the local shorthand establish the link. Ambiguous generic army references remain in review.

## Counts

| Measure | Count |
| --- | ---: |
| Original proposals / v2 claims | 106 / 106 |
| Old ready / pending identity | 70 / 36 |
| New resolved / needs review | 100 / 6 |
| Participant mentions: canonical / descriptor / generic / unresolved | 215 / 31 / 7 / 4 |
| Campaign Timeline associations | 101 |
| Heroes-do-nothing branch | 25 |
| Claims with entity associations | 102 |
| Resolved solely by Campaign Timeline | 2 |
| Claims with no useful home | 2 |
| Unresolved proper-named identities in this saved output | 0 |

| Old state | Resolved | Needs review |
| --- | ---: | ---: |
| Ready | 68 | 2 |
| Pending identity | 32 | 4 |

| Main month | Claims | Main month | Claims |
| --- | ---: | --- | ---: |
| November | 5 | May | 10 |
| December | 5 | June | 4 |
| January | 10 | July | 3 |
| February | 9 | August | 2 |
| March | 11 | September | 2 |
| April | 8 | October | 7 |

The six review entries are proposal indexes 3 and 4 (no useful home), and 20, 50, 73, and 100 (the proposal says “Ragesian army,” while its cited wording does not establish that specific identity). There is no unresolved proper name in the 106 saved proposals. A synthetic unknown named NPC is covered by a regression test and remains unresolved even with a timeline placement.

## Representative changes

- First, Second, Third, and Fourth Ragesian Army mentions retain their ordinal wording and gain a descriptor association with Ragesia where the source establishes the national affiliation. General Magdus and Nacaan remain separate canonical associations on the relevant claims. Proposal 51 now links Ragesia and Nacaan for the Fourth Army capture in April.
- The Shahalesti fleet gains a descriptor link to Shahalesti, with March timeline placement; no fleet entity is created. Seaquen agents and Gabal’s students likewise become descriptors linked to Seaquen and Gabal.
- A generic participant such as the drow assassins creates no identity-review task. The November teleportation claim resolves solely through the November timeline entry. The pre-November marching-speed observation has no useful home and goes to GM Review.
- The March hurricane has Seaquen and the March main-timeline association. Pilus’s May intention to use the Tempest retains `plan` status. An October main-timeline claim can resolve solely through its dated entry. The heroes-do-nothing claims receive the alternate branch, including the conditional fall of Dassen, without implying actual campaign history.

These counts measure placement and linking under the v2 contract. They do not measure extraction completeness, evidence entailment, or semantic accuracy; a higher resolved count is not proof of any of those.

## Every changed entity-association set

Indexes refer to original proposal order. Blank old associations mean the old reconciler linked no entity. Descriptors add the listed parent ID as an association; they do not rename the participant or statement.

| Index | Old canonical associations | V2 canonical associations |
| ---: | --- | --- |
| 8 | Sindaire; General Magdus | Ragesia; Sindaire; General Magdus |
| 15 | General Danava; Gate Pass | General Danava; Ragesia; Gate Pass |
| 16 | — | Ragesia |
| 17 | Shahalesti | Ragesia; Shahalesti |
| 28 | General Revulus; General Danava | Ragesia; General Revulus; General Danava |
| 29 | Gate Pass | Ragesia; Gate Pass |
| 31 | Dassen | Shahalesti; Dassen |
| 32 | King Steppengard | King Steppengard; Shahalesti |
| 33 | Lyceum; Seaquen | Shahalesti; Lyceum; Seaquen |
| 35 | — | Shahalesti |
| 37 | Seaquen | Seaquen; Dassen |
| 39 | Shahalesti | Ragesia; Shahalesti |
| 40 | Nacaan; Shahalesti | Ragesia; Nacaan; Shahalesti |
| 42 | General Magdus; Ostalin; Sindaire; Turinn | General Magdus; Ragesia; Ostalin; Sindaire; Turinn |
| 46 | General Danava; Shahalesti | General Danava; Ragesia; Shahalesti |
| 47 | General Revulus; Dassen | General Revulus; Ragesia; Dassen |
| 48 | General Revulus | General Revulus; Ragesia |
| 50 | Seaquen | Dassen; Seaquen |
| 51 | Nacaan | Ragesia; Nacaan |
| 52 | Calanis; Shahalesti | Ragesia; Calanis; Shahalesti |
| 62 | Longinus; Castle Korstull | Longinus; Castle Korstull; Seaquen |
| 63 | General Magdus; Shalosha; Castle Korstull | General Magdus; Shalosha; Seaquen; Castle Korstull |
| 67 | Torch of the Burning Sky | Seaquen; Torch of the Burning Sky |
| 68 | Torch of the Burning Sky | Seaquen; Torch of the Burning Sky |
| 69 | Heroes / Party; Torch of the Burning Sky | Heroes / Party; Seaquen; Torch of the Burning Sky |
| 88 | General Magdus | General Magdus; Ragesia |
| 92 | Ostalin; General Revulus; Seaquen | Ostalin; General Revulus; Ragesia; Seaquen |

The exact statements, evidence pages/offsets, participant records, and review reasons for all 106 entries are in the ignored local comparison artifact.
