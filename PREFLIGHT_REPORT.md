# Narrative tournament: updated offline preflight

**Status:** GPT-6 Luna is configured for both extraction and blinded judging in the development tournament and isolated holdout. The proposed USD ceiling is not approved. **No paid model/API calls were made.** No production campaign, Supabase resource, deployment, frozen historical test, commit, or remote was changed. No Delian holdout material was opened or supplied to the optimizing context.

## Frozen plan and approved scoring changes

Current SHA-256 plan hash: **`a34d058ad7957501b3440db1824f74077fcedbe7434bf16c36d1dde1595d5d56`**. The preceding GPT-5.6 Luna plan hash **`1bef04d5b68331829a3931b9ad1873c1b7a4f38edebd17c3e77fab4f5eb58d00` is invalid**. The ignored development scoring JSON SHA-256 remains **`426f4410e743a7b328255321ece019089fb93dbdff2933620d927f34948d5ebb`**. The new plan binds the model, `medium` reasoning, Standard (`default`) service tier, installed SDK version and strict JSON format, source/scoring bytes, all four initial prompts, schemas, judge prompt, revision directives, criteria, PDF.js serialization, request builder, runner, and holdout code. A code, gold, or source change invalidates this plan and any authorization or checkpoint based on it.

[GOLD_REVIEW.md](GOLD_REVIEW.md) records every changed field and its exact new value for **SW-N05, SW-N19, SW-N21, SW-X01, TALES-N18, and TALES-N20**. No other scoring rows changed. The three Sweetwater claims now include page 6 companion identity evidence while keeping page 10/11 fact anchors. SW-X01 credits an explicit source-discrepancy flag, never a clean assertion that Ullae was imprisoned. TALES-N18 distinguishes Ezard's completed participation from conditional betrayal for advantage. TALES-N20 says **one rendezvous was missed two nights ago**; Merry's standing-stones search is planned and her Old Wood search is conditional. The judge receives those distinct modality parts, and deterministic exact-match credit is disabled for compound rows. WotBS timeline modalities and all other draft rows remain as audited.

## Exact proposed paid-run plan

| Phase | Frozen rule | Maximum paid GPT-6 Luna requests |
| --- | --- | ---: |
| First development round | Four prompts × Sweetwater, WotBS, Tales; finish all 12 extractions before judge-informed selection. Every valid extraction receives a separate blinded judge request. | 12 extraction + 12 judge = 24 |
| Adaptive development | At most two revisions, each derived only from a weighted **general** failure pattern and compared on all three development sources. Stop below a `0.02` quality gain, on no complete candidate/pattern, or on budget exhaustion. | 6 extraction + 6 judge = 12 |
| Finalist freeze | After a completed development comparison, freeze the selected prompt and the next strongest complete prompt, with prompt hashes, evaluation hash, the actual development usage ledger, and the exact authorization-file hash. | 0 |
| Isolated Delian holdout | In a separately permissioned context, run the two frozen prompts once on the holdout. Each valid extraction receives one blinded judge request. No revisions, prompt changes, optimizer feedback, or source/answer transfer back to the optimizing context. | 2 extraction + 2 judge = 4 |
| **Total planned** | 20 extractions and at most 20 judges. | **40** |

The same ledger enforces **50 paid requests and 2,000,000 actual total tokens** across development and holdout. The extra 10 calls are hard-limit headroom, not authorized retries or extra variants. Known-use failures consume a request and their actual tokens, then independent planned work continues. Unknown usage, ambiguous dispatch, unresolved checkpoint, plan/input mismatch, judge evidence-integrity failure, or reservation discrepancy stops the phase. SDK retries are disabled. The holdout handoff refuses incomplete or unresolved development usage; the isolated runner carries that ledger into every reservation and records its own progress. Automatic semantic verdicts remain **provisional**, with cited evidence and uncertainty, never verified gold.

The holdout evaluator is a distinct entry point (`scripts/narrative-tournament-holdout.ts`) that accepts only a bundle under an explicit root outside this checkout. It reads no development fixture path. A path check is useful defense in depth; **actual isolation requires running it under separate filesystem permissions or a separate host/container that the optimizing agent cannot read**. The optimizing agent receives only aggregate finalist results after the freeze, and no Delian pages, gold rows, or judge explanations. The actual holdout bundle is not present here and was not inspected.

## GPT-6 Luna compatibility, availability, and pricing

The [official GPT-6 Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna) identifies API model ID **`gpt-6-luna`**, supports the Responses API and Structured Outputs, lists `medium` as the default reasoning effort, and verifies a **128,000-token maximum output**. The request builder sets `reasoning.effort: "medium"` and `service_tier: "default"` for **both extraction and judging**; it omits billable tools and Fast processing. Output allowance remains dynamic up to 128,000 based on the shared token and USD reserves, with **no arbitrary 20,000-token limit**. The model page lists paid API tiers (Free unsupported); this offline preflight cannot verify this project's live entitlement or quota.

The installed OpenAI TypeScript SDK is **7.10.0**. Its Responses request types accept `gpt-6-luna` through the string model field, although its enumerated model literals do not yet list Luna. Its `zodTextFormat` helper generates strict JSON Schema for the repository's Zod schemas. Typechecking and a **mock-fetch SDK serialization test** verified both extraction and judge requests with no network traffic. Server-side acceptance remains untested until an authorized paid call.

Official Standard text pricing, checked on **2026-09-27**, is **$0.10 per 1M input tokens, $0.01 cached input, $0.125 cache writes, and $0.50 output**. The same model page says prompts above 272,000 input tokens are billed at 2× input/cache and 1.5× output for the full request; regional processing can add 10%. We reserve at **`inputUsdPerMillion: 0.275`** (`$0.10 × 1.25 × 2 × 1.10`) and **`outputUsdPerMillion: 0.825`** (`$0.50 × 1.5 × 1.10`). This covers the documented uplifts without counting cache-read discounts. With no billable tools or Fast tier, the 2,000,000-token ceiling yields a conservative text-token bound of **$1.65** if every token were billed at the larger output rate. **Proposed monetary cap: `maxUsd: 1.65`**, pending explicit approval. Prices must be rechecked before a later paid run.

## Source serialization and evaluation

The development input uses selected pages extracted by PDF.js, the repository's `cleanDocumentPagesForModel`, and production-style `<campaign-page number="…">` tags. All **80** development claim anchors were found on the stated raw and model-input pages across **17** selected pages, including the new page-6 companion identity anchors. The private PyMuPDF passages are gold/diagnostic material only. The holdout entry point uses the same PDF.js extraction and model-text cleaner within its isolated context.

The comparison remains fixed across candidates, but selected-window cleaning is not byte-identical to a full production import. Production calculates repeated headers over whole documents, chooses chunk boundaries/overlap from the full book, and has an upstream entity inventory. Tales' two-column page and illustration-adjacent text remain reading-order risks; the page-29 diagram is excluded. WotBS page-13 successful-heroes heading governs later timeline entries. Sweetwater's page-6 printed “bound Ullae” sentence conflicts with surrounding merath context. These differences can shift absolute recall and modality attribution while leaving the development variants on the same input.

Deterministic checks validate page numbers, verbatim quotes in raw PDF.js text, IDs/endpoints, parent cycles, and exact draft matches; an exact match is labeled `draft_exact_not_verified`. A separate Luna judge, blinded to prompt names, compares uncertain semantics and negatives, requires source evidence, records uncertainty and general failure patterns, and contributes to the same paid ledger. Quality uses frozen weights: `0.50` importance-weighted propositions, `0.15` identity, `0.15` multi-subject relationships, `0.10` presentation/parent, `0.10` negatives, minus `0.05` per unsupported output/entity. Source-wide selection uses `0.8 × mean + 0.2 × weakest source`; near ties within `0.02` favor fewer actual tokens. No Delian information enters selection or revision.

## Offline verification

### Private prompt-comparison deliverable

The separately implemented exporter writes ignored `fixtures/private/narrative-dev/tournament/PROMPT_COMPARISON.md` and `PROMPT_COMPARISON_DETAILS.json`. The preflight report now includes the **complete exact** system prompts for all four initial variants, their SHA-256 hashes and baseline diffs, the shared instructions, and the complete blinded-judge system prompt. It reads frozen definitions and the saved plan; it does not alter any plan-hashed extraction, judging, scoring, request, runner, or holdout file. The output is private because post-run claim examples and source quotes may contain copyrighted text.

Before a paid run there are no adaptive prompts, candidate quality measurements, or actual token measurements. The current comparison explicitly marks those fields unavailable. After an authorized development run, the separate final export reads the saved development checkpoints and comparison, verifies prompt hashes and usage totals, then prints every adaptive prompt and its exact diff against its parent, the recorded general failure pattern, each development source's provisional quality, important recoveries and misses, unsupported claims, page-presentation errors, and actual input/output/total tokens. It reports observed associations and regressions without claiming causation. It excludes invoice-grade costs because the saved records contain token usage, not billed costs. The **USD 1.65 cap remains a technical dispatch safeguard**; it is not presented as an actual charge.

Run the private exporter now or after an approved development run, respectively:

```powershell
node --conditions=react-server --import tsx scripts/narrative-tournament-report.ts --preflight
node --conditions=react-server --import tsx scripts/narrative-tournament-report.ts --final
```

The final command currently refuses to run because no paid development records exist. Neither mode reads or writes Delian holdout material. This reporting step is outside the frozen plan and does not require a new plan hash.

- `npm run evaluate:narrative-tournament -- --preflight`: passed; plan hash above, 17 selected pages, zero missing model-input anchors, zero paid dispatches.
- `npm run evaluate:narrative-tournament -- --replay`: passed; reproduced plan/source/schema hashes and the 24 + 12 + 4 call plan with zero paid dispatches.
- `npm run typecheck`: passed. `npm test`: **78 files, 554 tests passed**, including holdout handoff, shared ledger, one-shot scoring, known-use failure continuation, tamper refusal, ambiguous-dispatch stop, GPT-6 Luna authorization checks, mock-fetch SDK request serialization, and private report export. `npm run build`: passed.
- `npm run lint`: passed with one pre-existing unused-variable warning in `tests/entity-reconciliation.test.ts`.
- Private prompt export preflight: passed; wrote four full initial prompts and the judge prompt under the ignored private tournament directory, verified their hashes, and showed usage as unavailable. Final export was tested to refuse without saved paid records. Three synthetic exporter tests passed, covering full prompt text, adaptive diffs, provisional evidence/usage, and tamper refusal.
- Paid mode without an authorization file refused before client creation. Finalist freeze refused without a completed paid development comparison. The holdout entry point refused to start without an outside isolated root. No live quality score exists.

## Commands reserved for a later, explicitly approved paid run

Only after explicit user approval of **this plan hash, the GPT-6 Luna paid run, and the $1.65 cap**, place this proposed exact JSON in ignored `fixtures/private/narrative-dev/paid-authorization.json`. The `userApprovalReference` sentence describes the approval and must only be used once that approval actually exists:

```json
{
  "approvalPhrase": "I approve the paid narrative tournament",
  "planHash": "a34d058ad7957501b3440db1824f74077fcedbe7434bf16c36d1dde1595d5d56",
  "model": "gpt-6-luna",
  "reasoningEffort": "medium",
  "serviceTier": "default",
  "maxUsd": 1.65,
  "inputUsdPerMillion": 0.275,
  "outputUsdPerMillion": 0.825,
  "modelMaxOutputTokens": 128000,
  "maxRequests": 50,
  "maxTotalTokens": 2000000,
  "userApprovalReference": "Explicit user approval of GPT-6 Luna plan a34d058ad7957501b3440db1824f74077fcedbe7434bf16c36d1dde1595d5d56 and USD 1.65 cap"
}
```

Then the development command is:

```powershell
npm run evaluate:narrative-tournament -- --paid --authorization-file fixtures/private/narrative-dev/paid-authorization.json
```

Only after that completes, freeze finalists with the **same authorization file**:

```powershell
npm run evaluate:narrative-tournament -- --freeze-finalists --authorization-file fixtures/private/narrative-dev/paid-authorization.json
```

A separately permissioned holdout operator then copies only `holdout-handoff.json` and that exact authorization file into an isolated root outside this checkout, prepares its Delian PDF/scoring bundle there, and runs the isolated phase with the same code version:

```powershell
node --conditions=react-server --import tsx scripts/narrative-tournament-holdout.ts --preflight --isolated-root <isolated-root> --handoff holdout-handoff.json --bundle holdout-bundle.json
node --conditions=react-server --import tsx scripts/narrative-tournament-holdout.ts --paid --isolated-root <isolated-root> --handoff holdout-handoff.json --bundle holdout-bundle.json --authorization-file paid-authorization.json
```

The holdout bundle has `sample`, `pdfFile`, `pdfSha256`, `selectedPages`, and `gold` fields. Its `pdfFile` and every holdout artifact must stay inside the isolated root; none belongs in the optimizing workspace. **No paid command is authorized by this report.**
