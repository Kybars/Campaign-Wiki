# GPT-6 Luna acceptance test — stopped

Plan `8030307e3ea36571b924423799f567cf1108c1df3e74c6cf9d86b64f707a74cf` ran **three extraction requests and one blinded-judge request**. It stopped on judge evidence integrity. No further judge, full-tournament, or holdout request was sent. The first command, without `.env.local`, exited before dispatch; the four requests came from the authorized `--acceptance` command with the server-side key loaded.

The complete, private [checkpoint ledger](fixtures/private/narrative-dev/tournament/paid-progress-narrative-adaptive-5.json) retains each schema-valid raw response before validation, its response ID, physical PDF.js source pages, complete extraction grounding issues, accepted output, and actual usage. The private [derived results](fixtures/private/narrative-dev/tournament/acceptance-saved-results.json) list **every accepted and rejected item by ID**, each rejection reason, and all seven independently detected invalid judge citations. Both files remain under the ignored private fixture directory. The historical ledger remains unchanged.

## Per-source extraction results

All three extractions were schema-valid. Accepted propositions, entities and relationships passed the frozen grounding checks; discrepancy pages passed the page check. Rejected items cannot receive recovery credit, and dependent claims and relationships were rejected when an endpoint entity was rejected. These are **grounding results, not narrative-quality scores**.

| Source | Accepted propositions / entities / relationships / discrepancies | Rejected items | Grounding issues by exact category | Actual input / output / total tokens | Provisional quality |
| --- | ---: | ---: | --- | ---: | --- |
| Sweetwater | 3 / 21 / 5 / 2 | 16 | unknown or rejected subject 18; unknown or rejected endpoint 2; quote absent from raw PDF.js page 5 | 3,607 / 4,650 / 8,257 | unavailable |
| WotBS | 6 / 33 / 3 / 0 | 21 | unknown or rejected subject 15; unknown or rejected parent 6; unknown or rejected endpoint 1; quote absent from raw PDF.js page 10 | 4,931 / 6,099 / 11,030 | unavailable |
| Tales | 14 / 47 / 6 / 3 | 19 | quote absent from raw PDF.js page 19 | 4,867 / 7,140 / 12,007 | unavailable |

The item count and issue count differ because one rejected item can have several validation issues. Rejected claims are not counted as recovered. The complete accepted ID lists and each rejected ID's issues are in the private derived results.

## Judge failure and diagnosis

The Sweetwater judge returned schema-valid output and **8,558 input + 7,164 output = 15,722 actual tokens**. Its response and usage were saved before adjudication validation. The checkpoint is marked `failed_unknown` because the runner treats an integrity failure as terminal; **this request's usage is known**. WotBS and Tales judges were not dispatched.

`validateAdjudication` checks every cited quote against the stated physical page's raw PDF.js text. It permits whitespace normalization but requires the remaining characters to form a contiguous verbatim span. The judge supplied **seven nonmatching citations**: propositions `SW-N01`, `SW-N08`, `SW-N10`, `SW-N26`; entities `SW-E18`, `SW-E21`; and negative check `SW-X07`. The first mismatch stopped scoring with `Adjudication source quote not found on cited page`. Offline inspection of the saved response found the other six; it did not repair or rescore the judge.

Representative causes are visible in the saved source and judge records:

- `SW-N01` ends its cited sentence after “Ullae.” The PDF.js text continues with “Ullae, goddess of life.” The changed punctuation makes the citation nonverbatim.
- `SW-N08` and `SW-E18` use an ellipsis to skip a parenthetical reference in the PDF.js text. The validator requires a contiguous span.
- `SW-X07` omits the intervening item-reference parenthetical. `SW-E21` similarly omits the beginning of a treasure sentence and its parenthetical. Those are paraphrased excerpts, even where the underlying facts may be supported.

This is a **judge citation failure**, not evidence that the cited facts are necessarily false. The frozen evidence rule correctly refused to treat the paraphrases as source quotations. Since the judge cannot be validated, there is **no valid provisional score for any source** and the all-three-sources acceptance criterion was **not met**. No prompt, scoring, validator, or historical checkpoint was changed during the test. A future repair must receive a new offline preflight and separate authorization before any further paid call.

## Shared budget after the stop

Nine historical responses and all four new responses have known usage. The tenth historical dispatch alone remains unresolved; its actual usage is **unknown**, while the approved **1,050,000 input + 128,000 output** reservation stays charged.

| Measure | Current accounting | Remaining hard limit |
| --- | ---: | ---: |
| Paid requests | 14 of 50 | 36 |
| Known actual tokens | 62,250 input + 98,772 output = **161,022** | — |
| Tokens charged including unresolved reservation | **1,339,022** of 2,000,000 | **660,978** |
| USD safeguard at approved conservative rates | **$0.49295565** of $1.65 | **$1.15704435** |

The USD figures are conservative budget charges, **not actual billed costs**. No new request has unknown usage. The acceptance-only authorization cannot start the full tournament, and the full-run gate remains closed because no source has a validated judge score.
