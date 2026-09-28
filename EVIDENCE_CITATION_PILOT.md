# Offline evidence-citation pilot

## Method

Read-only replay of the frozen cleaned inputs and saved `narrative_first` outputs for Sweetwater 6–13, WotBS 10–14, and Tales 27–30. The one-off [private pilot script](fixtures/private/narrative-dev/evidence-citation-pilot.ts) manually identifies 13 short, page-local **raw PDF.js spans** for eight previously rejected propositions and one already raw-valid relationship. It constructs two sidecars over the same frozen reading payload: **A** lists each raw snippet with a page-bound ID; **B** lists the same raw snippets and pages for exact copying. No model received either sidecar. The script substitutes the resulting raw citations in memory and calls the existing `partitionGrounding` validator; it does not change saved outputs or validation code.

An A ID is deterministic from the source identifier, physical page, raw `[start,end)` offsets, and raw-page hash, for example `E:SW:6:1103-1112:84d13ada562b`. The server-side prototype resolves it only through a prebuilt catalog, checks sample and cited page, rehashes the immutable raw page, compares its exact slice, then passes `{page, quote: rawSlice}` to the **unchanged** validator. For a sentence crossing SW pages 6–7, two IDs resolve to two separate citations; neither approach manufactures a cross-page quote. B instead asks the model to copy the corresponding short raw snippets. A WotBS snippet retains the PDF.js inline `*`; a Tales snippet retains `fi gure`. These are raw evidence, not cleaned paraphrases.

## Results

| Saved item | Original quote failure | A: valid ID | B: exact raw copy | Remaining issue |
| --- | --- | --- | --- | --- |
| SW `p5` | Page-spanning quote | Raw spans on pages 6 and 7 pass | Same | `Ullae’s priests` and `Galell` subjects remain unresolved |
| SW `p10` | Spacing before punctuation | Pass | Pass | `Jeanas Clocker` and `Galell` identity failures; chosen snippet does not cover every clause |
| SW `p11` | Truncated dialogue | Pass | Pass | `Galell` and `Room of Sorrow` name mismatches remain |
| WOTBS `p4` | Inline `*` | Pass | Pass | No structural issue after substitution; meaning still needs review |
| WOTBS `p7` | Two generated ellipses | Both pass | Both pass | `Shahalesti` entity remains rejected |
| Tales `p3` | `fi gure` / `sacrifi ce` | Pass | Pass | Span supports Silas’s belief, but not the proposition’s additional assertion that the captive is a demon |
| Tales `p18` | `profi t` | Pass | Pass | No structural issue after substitution; meaning still needs review |
| Tales `p26` | Quote crosses pages and column bleed | Two page-local spans pass | Same | No structural issue after substitution; actor/action meaning still needs review |
| Tales `Cult → built → Temple of Light` | **None**: original quote was raw-valid | Valid ID | Valid copy | **Wrong actor**: the source attributes building to converted locals, not the Cult |

Across the eight rejected propositions, the saved output has **nine quote failures**. In this idealized replay, A resolves all nine to raw slices and B's exact copies also pass all nine. This measures citation mechanics, **not model compliance or claim accuracy**. Six negative checks reject an invented ID, a shifted-offset ID, a wrong page, a wrong source, a changed raw page, and a cleaned-only phrase with no raw span. Both approaches retain the same frozen base payload hashes recorded in `SOURCE_CLEANING_REVIEW.md`. For these 13 hand-selected snippets, the sidecars add 2,227 characters for A and 1,793 for B across all three windows; this is not a full-source token estimate.

## Recommendation and limits

**Use A for a later controlled citation trial.** B keeps the current schema and is simpler to present, but its success here assumes a perfect copy. The saved model already omitted words, changed punctuation, and generated ellipses, so a raw-quote sidecar cannot guarantee valid output. A removes retyping from the output path: a listed ID either resolves to an exact raw slice on the claimed page or fails closed. It still cannot establish that the slice supports the whole proposition, choose the correct actor, reconcile `Galell`/`Shahalesti`, determine whether a claim is unsupported, or recover missing story information. The current catalog was selected with knowledge of the saved failures; automatic, comprehensive span selection and model ID choice remain untested. Long or cross-page claims may need two short IDs, and page/column artifacts must stay separate. The pilot ID uses a sample code; a real implementation would scope IDs to a document identity and continue to require catalog lookup.

If approved later, A would replace each generated quote field with an `evidence_id` plus physical page in proposition, entity-existence, and relationship evidence. A resolver would convert IDs to raw quotes **before** the current grounding validator; semantic review remains separate. The extraction prompt would ask for listed IDs rather than copied quotations. B would retain quote fields and add a copy-exactly instruction. No schema, prompt, or validator was changed in this pilot.

Before any Prompt A/B comparison, choose one citation contract, freeze its combined **cleaned reading payload plus identical raw-snippet sidecar** for both prompts, and pin the same schema, resolver, raw pages, and validation rules. Only the extraction prompt may vary. New input/behavior identities are required; saved raw-input results are historical diagnostics, not a controlled comparator. Stop here for review before any paid run.

## Exact files changed

- `EVIDENCE_CITATION_PILOT.md` — this report.
- `fixtures/private/narrative-dev/evidence-citation-pilot.ts` — gitignored, offline-only assertions over saved private material.

Verification: pilot completed; `npm run typecheck` passed; `npm run lint` had 0 errors and one pre-existing unrelated warning. No paid calls, extraction, AI judge, tournament mutation, or external changes occurred.
