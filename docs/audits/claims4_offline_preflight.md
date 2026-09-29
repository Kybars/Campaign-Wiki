# Claims-4 isolated offline implementation and preflight

Status: **READY FOR CLAIMS-4 LIVE-AUTHORIZATION REVIEW**. This implementation made **zero LLM API calls**, zero database changes, and no production extraction or wiki changes. The four live Luna requests have not been dispatched. The preflight and any future source-derived output are local-only under ignored `fixtures/private/claims4-v1/`.

## Frozen request verification

`npm run evaluate:claims4` verifies the source PDFs, extracted page text, baseline result/checkpoint completeness, physical-page mappings, raw evidence slices, unit IDs, request boundaries, and pinned source, fixture, inventory, evidence-manifest and Claims-2 result SHA-256 hashes. It uses the completed Sweetwater v3 single request. The four requests are exactly:

| Claims-4 request | Claims-2 baseline | Physical PDF pages | Evidence units | Estimated input | Reserved input | Proposed output cap | Planning cost |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| `test9-claims4-1` | `test9-claims2-1` | WotBS 10–12 | 71 | 4,430 | 5,316 | 12,000 | $0.011362 |
| `test9-claims4-2` | `test9-claims2-2` | WotBS 13–14 | 66 | 3,951 | 4,742 | 12,000 | $0.011204 |
| `test10-sweetwater-claims4-v3-1` | `test10-sweetwater-claims2-v3-1` | Sweetwater 6–13 | 163 | 5,264 | 6,317 | 16,000 | $0.014937 |
| `test11-tales-claims4-v1-1` | `test11-tales-claims2-v1-1` | Tales 27–30 | 211 | 6,893 | 8,272 | 18,000 | $0.017125 |
| **Four-call total** | | | **511** | **20,538** | **24,647** | **58,000** | **$0.054628** |

Input estimates use the actual Claims-4 prompt, serialized request, and JSON schema at four characters per token, with a 20% input reserve. Cost applies the historical Claims-2 planning rates ($0.275/M input and $0.825/M output) to reserved input and maximum output. This is a budget assumption, not a current price quote or expected invoice. Claims-3 used 42,000 total output-cap tokens and actually emitted 26,073 across its four completed calls. The larger 58,000-token cap allows more coverage without a claim-count target. The model remains the repository-configured `gpt-6-luna`.

The raw source spans, unit IDs, physical-page offsets and four request boundaries are unchanged. Input differences are recorded in `preflight.v1.json`: Claims-4 changes its prompt, schema and output caps; retains Claims-3 canonical IDs and permanent Heroes identity; retains the deterministic Sweetwater room continuation repair; and deterministically carries WotBS's success-assuming timeline heading forward until the separate no-heroes scenario. Adjacent sentence text and section context are interpretive context; only cited evidence units are direct support.

## Extraction and reconciliation contract

The one-pass extraction schema returns a statement, source participant names and one to five direct evidence-unit IDs. It does not restrict names to the inventory and does not ask the model for section, status or display fields. The prompt covers setting facts, rules, relationships, motives, secrets, rewards, hooks, GM instructions, schedules and possible outcomes, while requiring contingent wording where applicable.

The runner durably saves a `dispatching` attempt before each call. After a response it saves the complete original parsed proposals, raw response output, response ID, status and actual usage before validation or reconciliation. Reconciliation retains every proposal and maps it to `ready`, `pending_identity`, `pending_evidence`, `pending_source_status` or `pending_gm_review`, with reasons, original names and unit IDs, physical offsets, source text and inherited context. An unknown participant or distant context citation therefore remains reviewable. A definite local merath reference can resolve to Galell only through the source's unique nearby nymph-to-merath identity chain; an indefinite creature-type mention stays unresolved. The original statement that priests bound Ullae is preserved and flagged as a possible source discrepancy rather than silently corrected.

Evidence checks validate unit mappings, separate distant timeline context from direct support, and flag low lexical support or missing critical qualifiers. These deterministic checks do **not** prove semantic entailment. The unrelated Pilus citation for the August counteroffensive is a negative regression; a structurally valid ID alone is insufficient. Source status is metadata for established facts, rumors, plans, schedules, conditional events and GM instructions. Identical normalized statements in the same context/status may merge with provenance and associations unioned; differing qualifications remain separate.

The offline comparison command `npm run evaluate:claims4:coverage` is ready for after the four outputs exist. It reads the saved Claims-2 retained claims, Claims-3 original proposals and retained claims, and Claims-4 results. It reports proposition-level and source-unit representation as ready, scenario/GM, pending, or missing, with unresolved identity tracked separately. It allows several Claims-4 sentences to cover one earlier proposition. Its token-overlap matching is a triage aid; a human source audit is required for accuracy metrics. The targeted rescue planner groups nearby missing original evidence spans and emits a non-executable plan. No rescue call is in the four-call benchmark, and executing rescue requires a separate explicit authorization.

Planned comparison metrics: raw proposals, ready claims, pending claims by reason, distinct useful propositions, source-unit coverage, entity-link accuracy, evidence precision, scenario-status accuracy, and actual model usage. Accuracy fields remain unscored until reviewed live output exists.

## Safeguards and known source limit

The offline runner does not import the OpenAI SDK. Live dispatch requires `--live-luna`, a shell-level `ALLOW_PAID_CLAIMS4_V1_LUNA=1` authorization distinct from Claims-2/3, an exact request allowlist, a hard cap of at most four application-level attempts, and the `node --use-system-ca` launch. SDK retries are zero. Any failed or uncertain dispatch blocks automatic resumption. The npm script includes the proven system-CA launch configuration.

The frozen Tales evidence unit `p30.u004` contains signs resembling Dark Speech, but its raw span omits a following parenthetical in the PDF that calls them meaningless scribbles. Claims-4 cannot treat the omitted qualification as directly evidenced by that unit. A proposal asserting “meaningless” from `p30.u004` is retained as `pending_evidence`, and the omitted source line is a coverage limitation of the frozen request. The benchmark does not alter the source span to repair it.

## Offline verification

- Focused Claims-4 tests: 9 passed, including source-backed WotBS, Sweetwater and Tales regressions and authorization gates.
- Full suite: 83 files, 594 tests passed.
- Typecheck and production build passed.
- Lint passed with one pre-existing unused-variable warning in `tests/entity-reconciliation.test.ts`.
- Offline preflight verified four frozen requests and 511 units. No Claims-4 progress checkpoint exists; zero calls were made.
