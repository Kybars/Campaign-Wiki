# Narrative tournament failure diagnosis

**Status:** Manually stopped. No tournament process remains attached to the local execution session. No API call was made for this diagnosis. The frozen plan and authorization file were not changed. This report uses the saved development ledger, offline preflight diagnostics, and the frozen validation code; it does not use Delian material.

## Saved request and usage ledger

The saved state is still `running`, with 10 extraction checkpoints, no judge checkpoints, no revisions, no comparison, and no frozen finalists. Nine API responses returned usage and a schema-parsed extraction, but all nine failed the candidate grounding gate (`failed_known`). **Zero extraction checkpoints completed validation.** The tenth request was recorded as `dispatching` when the runner was stopped. Its response and usage are **unresolved**; it must not be treated as a zero-token or free request.

| Request | Saved state | Grounding issues | Input tokens | Output tokens | Total tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| baseline · Sweetwater | failed_known | 15 | 3,642 | 7,498 | 11,140 |
| baseline · WotBS | failed_known | 88 | 4,966 | 10,570 | 15,536 |
| baseline · Tales | failed_known | 37 | 4,902 | 10,475 | 15,377 |
| narrative_first · Sweetwater | failed_known | 5 | 3,607 | 5,416 | 9,023 |
| narrative_first · WotBS | failed_known | 24 | 4,931 | 5,743 | 10,674 |
| narrative_first · Tales | failed_known | 19 | 4,867 | 6,700 | 11,567 |
| entity_centered · Sweetwater | failed_known | 18 | 3,596 | 7,670 | 11,266 |
| entity_centered · WotBS | failed_known | 35 | 4,920 | 10,485 | 15,405 |
| entity_centered · Tales | failed_known | 61 | 4,856 | 9,162 | 14,018 |
| relevance_gated · Sweetwater | dispatching | unknown | unknown | unknown | unknown |
| **Known returned responses** | **9 failed; 0 valid** | **302** | **40,287** | **73,719** | **114,006** |

The known usage rows each satisfy `total = input + output`. **At least 114,006 tokens were consumed** by the nine returned responses. The true total and monetary charge cannot be determined from saved data while the tenth dispatch is unresolved. Ten paid dispatch slots were started; only nine have known usage. The tenth checkpoint has an output allowance of 128,000 tokens, which is a request setting, **not** a measured output or a charge.

## What failed, and what the saved data cannot prove

The common observed failure is the **post-schema candidate grounding gate**, across three prompts and all three development adventures. This is not evidence of a model entitlement failure, malformed JSON, or a judge failure: the runner reaches the grounding branch only after receiving usage and successfully parsing the extraction schema. No judge call was made because none of these extractions passed grounding.

`validateGrounding` checks several distinct conditions: whether each proposition, entity, and relationship cites a selected physical page with a quote found by `findVerbatimEvidence` in that page's **raw PDF.js text**; whether entity and proposition identities are unique; and whether attachments, parents, proposition subjects, and relationship endpoints resolve without cycles. The quote matcher accepts literal substrings and whitespace-normalized substrings, including a limited line-wrap hyphen case. It does not accept arbitrary paraphrase or punctuation changes. The checkpoint error stores only `Candidate grounding failed: N issues`, so **302 is a total issue count, not a count of citation mismatches**.

The requested representative triples—**model citation, corresponding PDF.js text, and exact rule that rejected it**—cannot be reconstructed from these saved records. Every failed checkpoint has `output` absent. The runner saves `checkpoint.output` only *after* all grounding checks pass and discards the `issues` array when recording a failure. There are no separate saved extraction-response files or HTTP response IDs in the development tournament directory. The preflight's `reading-order.json` shows that all 80 draft claim anchors appeared in both raw PDF.js and model-input text across 17 selected pages, but it does not contain the model's citations and cannot identify any rejected quote. Supplying example model citations or claiming that quote mismatches are the primary cause would be fabricated evidence.

This also means the precise underlying cause is **undetermined**. It could be quote mismatches, page selection, missing entity endpoints, duplicate identities, parent errors, or a mixture. The distribution (5–88 issues per returned extraction on every source) establishes a systematic compatibility problem between generated outputs and the frozen validator, but not which subrule dominates.

## Smallest safe proposed fix

Before another paid extraction, change only the development runner's **private failure recording**: for a schema-valid output rejected by `validateGrounding`, save the parsed candidate output and the full indexed issue list alongside its existing `failed_known` usage and error state. Record the provider response ID at dispatch completion as well, so an interrupted request can be reconciled. Keep the validation decision and scoring unchanged. A local read-only diagnostic can then pair each cited quote with the exact raw PDF.js page and classify the rule failures. Only that evidence can justify a targeted prompt, serialization, or validator fix.

This proposed recording change would alter a plan-hashed runner file; it **has not been made**. It requires a new plan hash, offline preflight, and fresh authorization before any future paid run. Separately, the current `dispatching` checkpoint must be reconciled against provider usage before any continuation or budget accounting is considered safe. The frozen runner already refuses resume with that unresolved checkpoint.
