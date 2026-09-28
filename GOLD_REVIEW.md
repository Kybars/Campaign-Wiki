# Approved development scoring corrections

The six approved rows below are applied only to ignored `fixtures/private/narrative-dev/campaign_wiki_DEV_scoring.json`. The attached original and frozen historical benchmarks remain unchanged. All fields not shown retain their original values.

| Row | Exact changed field | New value |
| --- | --- | --- |
| SW-N05 | `companionIdentityEvidence` | `{"physicalPdfPage":6,"sourceAnchors":["Galell, a nymph","nymph returned as an undead horror known as a merath"]}` |
| SW-N19 | `companionIdentityEvidence` | `{"physicalPdfPage":6,"sourceAnchors":["Galell, a nymph","nymph returned as an undead horror known as a merath"]}` |
| SW-N21 | `companionIdentityEvidence` | `{"physicalPdfPage":6,"sourceAnchors":["Galell, a nymph","nymph returned as an undead horror known as a merath"]}` |
| SW-X01 | `mustNot` | `Do not assert as established history that the priests imprisoned Ullae. Credit a candidate that flags the literal 'bound Ullae' wording as conflicting with the surrounding merath narrative.` |
| TALES-N18 | `expectedProposition` | `Ezard helps Silas conceal Salla's death and kidnapped Craven; he will betray Silas if doing so offers Ezard an advantage.` |
| TALES-N18 | `modalityParts` | `[{"modality":"established secret","proposition":"Ezard helps Silas conceal Salla's death and kidnapped Craven."},{"modality":"conditional","proposition":"Ezard will betray Silas if doing so offers Ezard an advantage."}]` |
| TALES-N20 | `expectedProposition` | `Craven missed one rendezvous with Merry two nights ago. Merry fears for him and plans to look at the standing stones; if he does not appear, she plans to seek him in the Old Wood.` |
| TALES-N20 | `modalityParts` | `[{"modality":"established","proposition":"Craven missed one rendezvous with Merry two nights ago."},{"modality":"established","proposition":"Merry fears for Craven."},{"modality":"intention","proposition":"Merry plans to look for Craven at the standing stones."},{"modality":"conditional intention","proposition":"If he does not appear, Merry plans to seek him in the Old Wood."}]` |

The Sweetwater companion evidence identifies Galell with the merath; the existing page 10/11 anchors remain the fact evidence. The Tales page 29 text says **one** rendezvous was missed **two nights ago**. Merry's searches remain plans, with the Old Wood search conditional on Craven not appearing. WotBS timeline rows were audited earlier and remain unchanged.
