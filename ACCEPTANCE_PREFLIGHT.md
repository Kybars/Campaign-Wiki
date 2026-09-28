# Narrative acceptance preflight

**Status:** Offline only. No new model generation, authorization file, tournament restart, or Delian access. The new development plan hash is `8030307e3ea36571b924423799f567cf1108c1df3e74c6cf9d86b64f707a74cf` (`narrative-adaptive-5`). The former authorization binds to `a34d058ad7957501b3440db1824f74077fcedbe7434bf16c36d1dde1595d5d56` and does not authorize this plan.

## Historical dispatch reconciliation

The immutable historical ledger has ten extraction dispatch slots. Nine failed with known usage: **40,287 input + 73,719 output = 114,006 actual tokens**. The tenth, `extract:relevance_gated:SW`, remains `dispatching`, with **actual usage unknown**. Its saved checkpoint has no response ID, response body, or usage. A read-only query to the OpenAI organization usage completions endpoint using the configured project key returned HTTP 403; no independently attributable provider record was available. The endpoint is an admin usage API with time buckets, not a per-response retrieval mechanism ([OpenAI usage reference](https://developers.openai.com/api/reference/ruby/resources/admin/subresources/organization/subresources/usage/methods/completions)). No usage was assigned as zero.

The tenth request's old plan, serialized source, prompt, schema, and operation identity all match the saved checkpoint. The reconstructed prompt + source + schema string is **17,691 UTF-8 bytes**. The saved request permitted **128,000 output tokens**. Rather than infer actual tokens from byte count, the gate reserves **1,050,000 input + 128,000 output = 1,178,000 tokens**. The input figure is GPT-6 Luna's published context ceiling; the output figure is its published maximum and the saved request allowance ([GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna)). Reserving both maxima is conservative even if the context limit constrains their combined use. The reservation is distinct from actual usage in checkpoints, comparisons, and holdout handoff.

At the authorized safeguard rates of **$0.275/M input** and **$0.825/M output**, known usage consumes **$0.0718971** of safeguard capacity and the unresolved request reserves **$0.39435**. These are budget charges, **not actual billed costs**. The rates cover published Standard pricing, long-context and regional premiums, including cache writes, provided the run uses no Fast processing or billable tools ([GPT-6 Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna)). The actual bill and tenth usage remain unknown.

| Shared ceiling | Charged before acceptance | Remaining |
| --- | ---: | ---: |
| Paid requests | 10 of 50 | **40** |
| Total tokens | 1,292,006 of 2,000,000 (114,006 actual + 1,178,000 reserved) | **707,994** |
| USD safeguard | $0.4662471 of $1.65 (calculated at conservative rates) | **$1.1837529** |

The tenth slot stays in the original historical file with unknown actual usage. The next runner copies it into the budget view with a pinned reservation and validates its identity, state, and allowance before dispatch. A different unresolved request still blocks continuation. If a trustworthy provider record later establishes the actual tenth usage, a new audited plan must replace the reservation; it cannot silently disappear.

## Acceptance-only phase

The new `--acceptance` mode sends `narrative_first` to **Sweetwater, WotBS, and Tales**, then sends a blinded judge request only for each usable extraction. It permits at most **three extraction and three judge requests**, with SDK retries disabled. Each request is charged to the same 50-request, 2-million-token, USD 1.65 ledger. The output allowance is computed from the remaining shared budget and the verified 128,000-token model maximum; there is no arbitrary 20,000-token per-request limit. The gate may stop before six requests if tokens or dollars cannot be safely reserved.

The acceptance operations use the same frozen prompts, PDF.js source payloads, schemas, scoring, operation identity and checkpoint file as the full first round. A later full run reuses all six completed or known-use-failed checkpoints and cannot dispatch them again. `--paid` requires a separate full-tournament authorization and a saved acceptance result with a nonempty grounded extraction and positive provisional score on **all three sources**. The full phase remains unapproved. The development maximum remains 36 new requests and the isolated holdout maximum remains four; together these are 40 new requests, inclusive of acceptance. Completion of all phases is conditional on the remaining shared budget.

After an authorized acceptance run, private `acceptance-comparison.json` reports for **each source**: accepted proposition IDs, entity names, relationship identifiers and discrepancy pages; rejected output IDs with every grounding reason; exact reason-category counts; extraction and judge states; provisional narrative quality; and actual input, output and total tokens. Schema-valid raw responses, response IDs, source pages, issues and usage are durably saved before grounding. These future model results cannot be reported before paid calls occur.

The current **offline known-good fixtures** demonstrate the reporting/scoring path but are not model acceptance results:

| Source | Fixture accepted | Rejected items | Grounding errors | Provisional fixture quality | Model tokens |
| --- | --- | --- | --- | ---: | --- |
| Sweetwater | `sw-known-1` | none | none | 0.020623 | not applicable |
| WotBS | `wotbs-known-1` | none | none | 0.017663 | not applicable |
| Tales | `tales-known-1` | none | none | 0.020978 | not applicable |

These qualities come from a single constructed claim per source against the full development scoring set; they do not estimate Luna quality. Each fixture used actual PDF.js physical pages and verbatim evidence. All three survived serialization, schema validation, grounding and scoring. Source payload hashes match the frozen plan, and all 17 selected pages have their expected model-input anchors.

## Proposed authorization and command

Following explicit approval of **this plan hash**, create `fixtures/private/narrative-dev/tournament/acceptance-authorization.json` with exactly these values, replacing only `userApprovalReference` with the text of that new approval:

```json
{
  "approvalPhrase": "I approve the paid narrative acceptance test",
  "scope": "acceptance_only",
  "planHash": "8030307e3ea36571b924423799f567cf1108c1df3e74c6cf9d86b64f707a74cf",
  "model": "gpt-6-luna",
  "reasoningEffort": "medium",
  "serviceTier": "default",
  "maxUsd": 1.65,
  "inputUsdPerMillion": 0.275,
  "outputUsdPerMillion": 0.825,
  "modelMaxOutputTokens": 128000,
  "maxRequests": 50,
  "maxTotalTokens": 2000000,
  "userApprovalReference": "<text of explicit future acceptance approval>"
}
```

Proposed paid command **after that separate approval only**:

```powershell
node --use-system-ca --conditions=react-server --import tsx scripts/narrative-tournament.ts --acceptance --authorization-file fixtures/private/narrative-dev/tournament/acceptance-authorization.json
```

No authorization file exists yet. The full tournament would need `scope: "full_tournament"`, its own approval phrase and explicit approval after the acceptance results are reviewed; the acceptance file cannot authorize `--paid` or the holdout.

## Offline verification

- PDF.js known-good fixture harness: **3/3** passed, with zero grounding issues and positive proposition scores.
- Typecheck: passed. Tests: **79 files, 568 tests passed**. Lint: passed with one pre-existing unused-variable warning in `tests/entity-reconciliation.test.ts`. Build: passed.
- `npm run evaluate:narrative-tournament -- --preflight` and `--replay`: passed with the hash above; zero new paid dispatches. Offline tests show six-call acceptance containment, per-source reporting, known-failure continuation, strict historical reservation, and first-round checkpoint reuse.
- An offline `--acceptance` invocation without an authorization file exited before preparation or network use with `Explicit monetary-cap authorization file required; no paid dispatch`.
- No new paid-progress or authorization file exists. The development gold and historical checkpoint files were read but not changed. No production campaign, Supabase resource, or deployment was changed; no Delian material was accessed.
