# Tales model-source cleaning and future slice preflight

Baseline `935bab6c24705e57789bc1a2aab5a48f6b84d664`; release 0.6.13.
Reconciliation remains `claims-4-1-reconciliation-2.3.2`. No model/API calls,
inventory extraction, database/frontend changes or deployment occurred.

The supplied private PDF hash matches
`07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377`.
The full raw extraction is unchanged: 49 pages / 216,811 characters.

| Diagnostic | 0.6.12 | 0.6.13 |
|---|---:|---:|
| Model characters | 212500 | 206203 |
| Removed lines/fragments | 83 | 266 |
| Recurring header | 47 | 47 |
| Recurring footer | 30 | 15 |
| Recurring furniture | 0 | 82 |
| Page ornament | 6 | 13 |
| Watermark | 0 | 49 |
| Duplicate overlay | 0 | 60 |
| Evidence units | 1999 | 1983 |
| Structural headings | 321 | 320 |
| Provenance errors | 0 | 0 |
| Units containing intrusive running book title | 47 | 0 |
| Intrusive running chapter fragments | 55 | 0 |
| Units containing purchaser/order watermark | 19 | 0 |
| Suspicious duplicate lines adjacent to removed layers | 70 | 16 |

The 47 old contaminated book-title units contain 48 standalone book-title
fragments. Four natural book-title mentions in body/legal prose remain. Zero
new evidence spans cross a removed fragment. No standalone furniture-number
paragraphs remain. Old removal reasons are reconstructed by instrumentation of
the pinned cleaner without altering its output. New classification differs, so
reason-category changes are not semantic recall scores.

The 16 remaining suspicious duplicate lines are exported for human inspection.
Some are legitimate headings/original passages near removed furniture, while
others are adjacent duplicates without the required bracketed insertion proof.
The cleaner does not broaden removal to reach a count target.

Page 7 preserves the single complete spell entry containing `minor healing (4)`,
`cure (2)` and `moderate healing (1)`. The second partial spell overlay is
removed, along with its running book/chapter titles, page ornament and purchaser
watermark. Original narrative and raw offsets remain intact. Samples on pages
3, 6, 19, 21, 23 and 30 export old/new model input and removal provenance.

Source assertions pass for Rumors on page 19; Day 1, Day 2 and Day 3 on page
30; random-section contexts; running-title suppression; bounded statblock
scopes; and heading hierarchy. Existing source-structure tests remain unchanged.
The old 1,891-claim replay is preserved separately and was not run against new IDs.

Synthetic negative regressions preserve book titles inside prose, repeated NPC
names, repeated semantic location headings, numbered rooms, dice table numbers,
statblock values, repeated narrative and a one-off short heading. Tests also
verify unchanged raw values and exact LF/CRLF diagnostic offsets.

## Future live plan — prepared only

Actual PDF contents establish the selected ranges. Pages 19–20 contain the
outbreak/disease material, Rumors and the related temple; 21–22 contain the
physical tower description, adventure introduction, named Moon Spire and
subsequent tower/spire references; 29–30 contain Verge character context and
the Day 1/2/3 schedule plus Random Events. Each slice starts structural annotation
independently; all reuse the same document-global inventory.

| Slice | PDF pages | Request ID | Estimated input tokens |
|---|---|---|---:|
| Gibbering Fever / Rumors | 19–20 | `claims4-1-doc-0001-8228ba794d01` | 6993 |
| Moon Spire | 21–22 | `claims4-1-doc-0001-3f50f695e675` | 7253 |
| Verge days | 29–30 | `claims4-1-doc-0001-b6af015a25c9` | 7007 |

Exactly three future Claims requests, no inventory requests, model IDs
`[gpt-6-luna]`, 24,000 output cap each, `maxRetries = 0`. Estimates use the
existing character/4 estimator including the system prompt and schema; these
are estimates, not billed tokens. All remain below the normal 16k hard bound.
No live calls are authorized or executed by this preflight.

Saved inventory is normalized by unchanged 0.6.12 semantics: 304 entities,
13 merges. Global inventory SHA-256 over `JSON.stringify(normalized.inventory)`:
`76762453d1fc477b4021867ccbdf86c7a32f65c7bf891d9e84038185e8871b22`.

Later human review must establish useful outbreak fact coverage and faithful
rumor attribution; physical tower facts versus adventure/title identity;
scheduled Day N knowledge versus plans/conditions; conditional random events;
valid provenance; no heading-only direct proof; no furniture claims; and no
invented lore. The evaluator compares new proposals with source units and
2.3.2 reconciliation, not old extraction counts. It requires complete exact
request ownership and reads a verified plan manifest before evaluation.

## Verification and private artifacts

All 98 relevant tracked test files / 1,160 tests pass. Typecheck passes; lint
passes with its pre-existing unused-variable warning. The pre-existing untracked
holdout test is excluded and its unrelated files remain untouched. Historical
WotBS/Sweetwater saved 2.2.4 outputs remain exact; all old reconciliation source,
Claims source/packing/prompt/schema and inventory-normalization code remains
unchanged. No historical artifact overwrite occurs.

Final immutable private bundle:
`fixtures/private/tales-source-cleaning-v0613-v8/`.
Manifest SHA-256:
`96a8814e639604ea81d4fd844ff927bf163c612c5f08ebc78c542ab8a9a3df5d`.
Earlier development exports remain preserved; v8 is the final source audit and
plan. The private source, cleaned text, evidence and serialized requests are
excluded from Git.

Frozen prompt SHA-256:
`d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58`.
Frozen schema SHA-256:
`16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb`.
