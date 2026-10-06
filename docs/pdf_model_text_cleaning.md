# PDF model text cleaning — 0.6.13

`DocumentPage.text` is the authoritative PDF extraction. The cleaner returns
new pages with only `modelText` changed. It never edits raw text, reorders pages
or applies fuzzy semantic deduplication. Reconciliation remains 2.3.2; Claims
prompt, schema, packing and inventory normalization semantics are unchanged.

Cross-page edge recurrence first establishes likely running publication titles.
Title characteristics and repeated edge/footer-layer pairing prevent a repeated
NPC name or semantic location heading from becoming furniture merely through
frequency. Proven titles can be removed as standalone lines anywhere in the
extracted order, including lines with a trailing page number. Recurring section
titles require both edge recurrence beside a proven publication title and
cross-page footer-layer proof, including combined purchaser lines. Removal
requires adjacency to a detected furniture layer. A semantic heading elsewhere
is retained. A proven running title interrupting a statblock can also be
removed without removing the following numeric values. Naturally occurring
title mentions inside prose are retained.

Recurring purchaser/order/customer, copyright/download syntax provides a
separate watermark family signal. Numeric values alone are insufficient:
page ornaments require surrounding furniture or explicit decorated/page-label
edge syntax. Table and statblock values remain semantic input.

Duplicate overlay handling requires a short insertion bracketed by detected
furniture fragments and exact whitespace-normalized duplication outside that
insertion on the same page. A duplicated line or prefix span can be removed;
ordinary repeated narrative outside that insertion is preserved. Ambiguous
adjacent duplicates remain for inspection rather than broader deduplication.

Each removed fragment records page, raw text, normalized key, reason, zero-based
line index and exact raw start/end. Reasons are `recurring_header`,
`recurring_footer`, `recurring_furniture`, `page_ornament`, `watermark` and
`duplicate_overlay`. Summary counts and detailed fragments are exposed in the
Claims document preflight diagnostics; they do not enter model prompts.

A removal creates a paragraph boundary. Kept spans are joined and dehyphenated
using the existing rules; semantic evidence maps to contiguous exact raw spans
through the existing mapper. The audit additionally rejects evidence spanning
a removed layer. New IDs/segmentation belong to future extraction, so the
1,891 frozen Tales claims are never replayed against this new stream.

`scripts/prepare-tales-source-cleaning.ts` blocks network access, checks the PDF
and acceptance manifest hashes, extracts all 49 pages, compares the pinned
0.6.12 cleaner with the current cleaner and exports a new private audit. Its
instrumented historical cleaner copy is diagnostic data; that generated file
pattern alone is excluded from application typechecking. No old cleaner or
historical fixture is overwritten.

The script reuses the saved global inventory and current normalization, then
annotates each isolated cleaned slice independently to avoid an unrelated
heading inherited from an excluded page. It uses unchanged packing with the
normal 16k hard bound as the target for these small slices. Serialized requests,
evidence, heading paths, inventory hash, prompt/schema, caps and retry settings
are frozen privately. No inventory extraction or live executor is included.

`scripts/evaluate-tales-live-slices.ts` reads only later saved outputs and a
verified plan bundle. It evaluates provenance, heading direct evidence,
possible furniture claims, source-unit coverage and frozen 2.3.2 source statuses
using inventory source records. Human comparison must still assess useful
facts, missing facts, attribution, physical versus adventure identities and
invented lore. It does not judge success from old claim counts or call a model.

See [the Tales cleaning and slice audit](audits/tales_source_cleaning_v0_6_13.md).
