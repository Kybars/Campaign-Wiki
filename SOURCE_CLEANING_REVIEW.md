# Source cleaning review

## Scope and pipeline

Offline audit of the saved `narrative_first` extractions for Sweetwater physical PDF pages 6–13, WotBS Campaign Guide 10–14, and *In the Name of Love* 27–30. The saved outputs and issues came from `acceptance-saved-results.json` and `paid-progress-narrative-adaptive-5.json`; no extraction or judge ran.

`extractPdfPages` concatenates PDF.js text items in returned order, using `hasEOL` for line breaks, then removes NULs and excess blank lines. The existing production `model-text.ts` makes a separate `modelText`: it detects recurring lines among the first/last two lines, removes page ornaments, collapses lines into paragraphs, and automatically rejoins a line-ending hyphen before a lowercase next line. The narrative tournament wraps that text in physical `<campaign-page>` tags. Its `partitionGrounding` checks each generated quote against the **raw text of the cited physical page** through `findVerbatimEvidence`, which tolerates whitespace and a narrow line-wrap hyphen case. Neither it nor the saved issues were changed. PDF.js item order still permits column bleed and page-spanning sentences.

## Rejected quotation audit

There are **34 rejected quotation instances** (SW 5, WOTBS 10, Tales 19). The quotation issue records agree exactly between the acceptance summary and paid-progress checkpoint. Each instance has one primary cause below; several have secondary defects. IDs are those in the saved extraction. “Rel.” identifies a relationship output.

| Primary cause | Count | Rejected quotations |
| --- | ---: | --- |
| Horizontal whitespace near punctuation | 3 | SW `p10`; Tales `p19`, `p20` |
| PDF.js split words | 8 | Tales `p2`, `p3`, `p6`, `p8`, `p13`, `p17`, `p18`, `p28` |
| Physical page boundary / column order | 2 | SW `p5` spans pages 6–7; Tales `p26` spans pages 27–28, with a header/column intrusion |
| Inline layout marks | 4 | WOTBS entities `Shahalesti`, `trillith`; WOTBS `p4`; rel. `Leska → Inquisitors` (inline `*` markers) |
| Model ellipsis, omitted words, changed wording/case or punctuation | 17 | SW entity `Jeanas Clocker`, `p11`, `p16`; WOTBS `p7` **twice**, `p9`, `p12`, `p16`, rel. `Mother of Dreams → Torch`; Tales entity `Northern Reach`, `p1`, `p7`, `p11`, `p14`, `p23`, rel. `Silas Branson → Black Thorn`, rel. `Xavian → Craven` |
| Wrong page or genuinely unsupported quotation | 0 | None as a primary cause among these 34 |

The mixed cases matter: Tales `p2` also changes initial capitalization; `p7` and the Silas relationship omit source words as well as spelling `sacrifi ced` differently. SW `p11` truncates dialogue before its actual closing words. WOTBS `p9` changes “do not” to “don’t”; the Mother of Dreams relationship changes “whose” to “her.” These are model quotation errors, not whitespace fixes. The `Galell` identity mismatch rejects additional propositions through subject resolution, and the claim that the Cult built the Temple of Light misattributes an action the source gives to locals. Cleaning does not resolve either error.

## Implemented reading copy

`lib/pdf/reading-source.ts` builds a new page-local reading copy. It keeps every raw page string, page number, and retained line’s raw `[start,end)` offsets. It normalizes horizontal spacing and spaces before basic punctuation, repairs a fixed list of observed PDF.js ligature splits, and removes only caller-confirmed running lines plus obvious edge page ornaments/order watermarks. The freeze script supplies the confirmed WOTBS and Tales running lines; SW has none. It removed 0, 10, and 20 lines respectively. Twenty-five Tales lines contained the listed ligature splits. Genuine section headings, dialogue, names, numbers, and page boundaries remain. It does not reorder columns, stitch pages or paragraphs, or join hyphenated line wraps. It leaves WOTBS inline `*` marks and ambiguous layout intrusions in place. This is a development input artifact; the existing production cleaner and historical tournament runner remain untouched.

| Physical page | Raw PDF.js fragment | Reading copy | Limit |
| --- | --- | --- | --- |
| Tales 27 | `demonic fi gure`; `blood sacrifi ce` | `demonic figure`; `blood sacrifice` | Raw spelling remains citation authority |
| Tales 28 | `Their eff orts` | `Their efforts` | Raw spelling remains citation authority |
| SW 7 | `potions of healing .` | `potions of healing.` | Raw spacing remains citation authority |
| WOTBS 10 | `• 9 •`; repeating guide header; `Campaign Outline` | Ornament/header removed; `Campaign Outline` kept | Inline `*` remains |
| SW 6–7 | `Each day,` / `the priests must…` | Still on two pages | No cross-page quote created |

Sweetwater’s source wording `bound Ullae` is preserved exactly. Every retained reading passage maps to one nonempty raw line on one physical page; the frozen artifact includes raw text and offsets for verification. A cleaned phrase is **not** accepted as a verbatim raw quotation. If a future transform cannot retain this mapping, its output must be excluded from verified citation evidence.

## Offline verification and citation limits

The synthetic tests cover raw immutability, offsets, page boundaries, section headings, dialogue, names, columns, hyphenated wraps, broken words, and strict raw quotation matching. All three saved raw windows were frozen successfully, with **1,248 mapped passages**. Full suite: **80 files/572 tests passed**; typecheck passed; lint had **0 errors, 1 pre-existing warning** in `tests/entity-reconciliation.test.ts`. A second freeze produced the same artifact hash. The cleaned payloads contain the expected 8/5/4 physical page tags, no order watermark, and Sweetwater’s unchanged `bound Ullae`.

With unchanged validation, **0/34 historical rejected quotations can be counted as prevented**. Nine rejected quote strings are now present in the cleaned reading copy (SW `p10`; Tales `p3`, `p6`, `p8`, `p13`, `p17`, `p18`, `p20`, `p28`), but they still fail the raw-page validator. This is a potential input-quality improvement, not a measured extraction improvement. The other 25 are still absent even from the cleaned copy and need a prompt/output-format change, a narrower evidence selection, or manual correction. No new cleaned-input model run was compared with the saved raw-input run.

Short, pre-identified **raw** spans could later receive stable IDs: the model would return an ID and the server would resolve the exact raw page slice. That could avoid retyping, provided spans are short enough to support the claim and validated by page and offsets. It would require a separately reviewed prompt/schema contract and is **not implemented** here. No new judge or looser quotation matcher was added.

## Frozen input identities and next step

The gitignored private artifact is `fixtures/private/narrative-dev/cleaned-source-inputs-v1.json` (SHA-256 `21fec4818a07b4e0b215bca20022f78f25a33fa3b5ca544720b7e00f74d6977b`). Its `sourcePayload` is the proposed identical input for a later Prompt A/B comparison; each sample also stores its raw-page hash and passage offsets.

| Window | Raw-page SHA-256 | Cleaned `sourcePayload` SHA-256 |
| --- | --- | --- |
| SW 6–13 | `df33f78805966317edeba43686ec5a517a81958453013a97128b9de3478b744f` | `7547c16dc8343a4020696a78133cfa3482468efc73c36033e244cfee57499585` |
| WOTBS 10–14 | `0ae0bcc135ae0bfcd83d1ddf69e34827f3d4ae0293c43057094d4481c4fe944b` | `89a29c4192d6f872fdbb7b90134318cf39472ac766bc9ce6c7c3344f546ccd14` |
| Tales 27–30 | `5b79103e6fa2abe7370f6c783a4b6a562fb11fb33d28af9d478ca6ee71ac4be4` | `fb61e1bcfc8d449891f14a09f1c4dc0ef2af3f5bdbcdc31b1de8ff8430affc74` |

The artifact pins the saved checkpoint, cleaner, grounding, and verbatim-verifier file hashes. **Next:** review this copy and the remaining quotation errors, then design Prompt B. Any later paid A/B comparison should load these same frozen payload bytes for both prompts, retain the same raw pages and validation rules, and use new input identities rather than reusing historical raw-input checkpoints. Wait for approval before a paid comparison.
