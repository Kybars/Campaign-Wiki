# Test 10 Sweetwater — v3 single-chunk offline preflight

Status at this preflight: **runnable when separately authorized; no model/API call had yet executed**. A later single-chunk v3 request completed; its structural result and limits are recorded in `docs/CURRENT_STATE.md`.

The original Sweetwater PDF has SHA-256 `87f0d5f8099d1881ecad6a6bba03d2807df6bd07138975dead3d1fea373e42cc`. The unchanged extracted pages 6–13 have fixture hash `61452bd607529afae3cf944114f9e56e57da18c3112e4a1f274b62c6f58ab03b`.

The reviewed `inventory.v2.json` is preserved as proposed. Its exact entity list is frozen in the private `fixtures/private/test10-sweetwater-v1/inventory.v3.frozen.json`, SHA-256 `cb1830f904f217004022b85b7ea0e0d2d6961e390a797d65d021e4ad6e7400d4`. The v3 file records its v2 source hash; it contains the same 27 entities, names, aliases, source-scoped identifications, and source evidence. The private `annotation-worksheet.v3.json`, SHA-256 `f288f67da9cc845a53e0aa293722a26ae775e0302b8e1072c7b6d88758b23c1d`, preserves all original row IDs and pre-model selections. Relative to v2, only SW10-31 and SW10-23 expected propositions change. SW10-31 states the successful DC 13 Wisdom (Perception) prerequisite for finding the lifesaver ring. SW10-23 states that Callia does not attack the characters or her mother unless attacked first.

The new private `evidence-units.v3.json` has manifest SHA-256 `86c639143593147d61f50ba1945c1918f6103e494289673ce250d0e0cd00b3a9`. One request spans physical PDF pages 6–13. It retains all 163 original unit IDs, raw text, page numbers, and offsets. The original v0.6.7 Claims-2 prompt, schema, request serialization, and claim validator are imported unchanged. The v3 request has a distinct operation key, input hash, upstream fingerprint, checkpoint path, and result path.

Preflight uses the existing four-character token estimator: source 3,954, entity context 259, prompt 256, schema 144; total estimated input **4,613**. With a 1.2 input multiplier, reserved input is **5,536**. The configurable maximum output is **12,000**, yielding a **17,536-token** reservation against the **24,000-token** run and stage budget. SDK retries are **zero**. The reservation fits; `fatalDispatchBlockers` is empty and `runnable` is true. This estimate is a planning safeguard, not a billing guarantee.

Known evaluation limitations are retained as test conditions. The page 6 sidebar separates a phrase from its page 7 continuation, so the unchanged validator will reject a nonadjacent two-unit citation. The original heading inheritance and sentence segmentation remain intact at pages 10–11 and 11–12. Galell's source-scoped identification as the merath is visible in the single source chunk; it is not promoted to a global alias. These limitations do not block dispatch or make unsupported citations valid.

Offline preflight:

```powershell
node --import tsx scripts/evaluate-test10-sweetwater-claims2-v3.ts
```

Command for the later authorized paid run, **already completed once**; the private checkpoint prevents an unchanged rerun:

```powershell
$env:ALLOW_PAID_TEST10_SWEETWATER_CLAIMS2_V3_LUNA='1'; node --import tsx scripts/evaluate-test10-sweetwater-claims2-v3.ts --live-luna
```
