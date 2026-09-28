# Test 10 Sweetwater — offline review proposal v2

No model/API calls, production writes, migrations, commits, or pushes were made. The original PDF, PDF SHA-256 `87f0d5f8099d1881ecad6a6bba03d2807df6bd07138975dead3d1fea373e42cc`, and extracted fixture hash `61452bd607529afae3cf944114f9e56e57da18c3112e4a1f274b62c6f58ab03b` are unchanged. The v1 proposed inventory, worksheet, preflight, and runner remain in place.

## Revised private artifacts

- `fixtures/private/test10-sweetwater-v1/inventory.v2.json` — 27 proposed entities; SHA-256 `9dafd54b85d11aca5a863a70692583427ea33ccef10b33a004273b4fcb9fd8d6`. The S4 room is `[S4] Putrid Moss` (Location); `putrid mosses` is a separate creature-type `Other`. Descriptive identification of Galell as “the nymph” or “the merath” is supported by source-scoped evidence and no longer exported as a global alias.
- `fixtures/private/test10-sweetwater-v1/annotation-worksheet.v2.json` — original 36 pre-model row IDs retained; SHA-256 `0f3ef95266f1056dbf566e1e9b31035a9f38724e36bc89c3001814806683f954`. It contains proposed exact evidence spans, conditions/modality, canonical entity references, and blank judgments. There are 33 independently scored fact rows, one source-inconsistency/abstention row, and two merged, non-independent rows.
- `fixtures/private/test10-sweetwater-v1/worksheet-review-diff.v1-to-v2.json` — row-by-row review of proposition, entity, scoring, and evidence-span changes.
- `fixtures/private/test10-sweetwater-v1/evidence-units.v2.json` — 163 source units, each with ID, chunk, physical page, raw offsets, exact raw text, kind, and inherited section context; SHA-256 `7bd005ac5384430ad90d6c28a0fe57c2247826f30c2438c0055b3d3bd5b08057`.
- `fixtures/private/test10-sweetwater-v1/preflight.v2.json` — two-request plan and checkpoint identities.

SW10-20 now includes the complete page 8–9 check, while SW10-21 remains for traceability and is not scored separately. SW10-08 is an abstention test for contradictory source wording. SW10-14 and SW10-36 describe the same Jeanas reward; SW10-36 is corroborating evidence, not another scored reward. SW10-24 records the separate Callia dagger reward with the kill, escort, and arrival conditions. SW10-15, SW10-18, SW10-32, and SW10-35 retain their source conditions and attribution. The worksheet is a source-only proposal, not a model-derived gold set.

## Split preflight

| Chunk | Physical PDF pages | Evidence units | Estimated input | Output limit | Reserved tokens |
| --- | --- | ---: | ---: | ---: | ---: |
| `test10-sweetwater-claims2-v2-1` | 6–9 | 74 | 2,553 | 9,000 | 12,319 |
| `test10-sweetwater-claims2-v2-2` | 10–13 | 89 | 2,713 | 9,000 | 12,527 |

Total estimated input is 5,266 tokens; output limits total 18,000. A 1.3 input reserve and zero SDK retries reserve 24,846 tokens against a 32,000-token document and stage budget. These are deterministic four-character estimates, not billing guarantees. No request was dispatched. The split, manifest, inventory, model, prompt/schema identity, and budget are versioned independently from v1 and Test 9.

The boundary audit covers pages 6–7, 8–9, 10–11, and 11–12. Page 8–9 is an adjacent sentence continuation with consistent section context. Page 11 begins with S1 mold before the S2 heading; page 12 begins in S3 before its next heading. Page 6–7 has a sidebar between the two sentence fragments, preventing a valid adjacent two-unit citation in the existing Claims-2 validator.

**This two-chunk proposal is not runnable as an unchanged Claims-2 comparison.** Pages 10–13 use “the merath” without repeating the page 6 evidence that identifies that description with Galell. The existing Claims-2 request exposes global canonical names and aliases, but no source-scoped identity-evidence channel. Adding the description as a global alias would defeat the review correction. The preflight records both this cross-chunk identity gap and the page 6–7 citation gap. The v2 runner rejects `--live-luna` until a general, source-backed context mechanism is reviewed; it has no model dispatch path.

Offline preflight command:

```powershell
node --import tsx scripts/evaluate-test10-sweetwater-claims2-v2.ts
```
