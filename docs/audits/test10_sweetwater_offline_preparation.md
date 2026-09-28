# Test 10 Sweetwater Village — offline preparation

Status: prepared for human review. No model calls or production writes.

- Source: `C:\Users\rynde\Documents\RPG\Demonplague\The Demonplague Sweetwater Village.pdf`; SHA-256 `87f0d5f8099d1881ecad6a6bba03d2807df6bd07138975dead3d1fea373e42cc`.
- Private fixture: `fixtures/private/test10-sweetwater-v1/fixture.v1.json`; fixture hash `61452bd607529afae3cf944114f9e56e57da18c3112e4a1f274b62c6f58ab03b`. This hashes version 1 and the exact extracted page objects, not the PDF bytes.
- Proposed inventory: `fixtures/private/test10-sweetwater-v1/inventory.v1.json`; 26 entities with source references and aliases, inventory file SHA-256 `d4467db24b0310f9b7ab5a0e0545d88c755a6d7530f3c4234440ef840cd69930`. This inventory is not frozen.
- Preselected annotation worksheet: `fixtures/private/test10-sweetwater-v1/annotation-worksheet.v1.json`; 36 rows with physical page, raw offsets, exact anchor text, expected proposition, material entities, review fields, and blank judgments.
- Private outputs remain gitignored under `fixtures/private/`. The runner and synthetic tests contain no source fixture bytes.

The source covers physical PDF pages 6–13 inclusive, 13,289 extracted characters. The sole proposed request spans the introduction/background (6–7), village ruins (8–9), catacombs (10–12), and conclusion (13). It has 163 evidence units. One request keeps page-spanning prose in the model context. The printed page numbers differ from the physical PDF page numbers.

The source extractor preserves irregular heading spaces. On page 6, a sidebar interrupts prose continuing on page 7. Page 8 ends inside a skill-check sentence that continues after a running header on page 9. Page 6 says priests bound Ullae; the fixture retains that surprising wording for review. A map caption on page 11 is excluded from model evidence while the raw page remains intact. No map image, appendix, license, or standalone stat block is selected.

The unchanged Claims-2 prompt, schema, and validator are reused. The source-specific planner only selects pages and heading context; it does not add an extraction prompt rule. Checkpoint identity includes the Test 10 fixture and proposed inventory hashes. Any source or inventory change invalidates resume identity. The paid path requires a frozen inventory, explicit environment authorization, zero SDK retries, known token usage, a pre-dispatch reservation, and a persisted `dispatching` checkpoint. A budget stop leaves the request pending rather than marking it complete.

Preflight uses the existing four-characters-per-token estimator: source 3,954; inventory 261; prompt 256; schema 144; total estimated input 4,615. A 1.2 input reserve is 5,538; configured output maximum is 12,000; one request reserves 17,538 tokens. The configured run and stage budget is 24,000 tokens, with zero SDK retries. Estimates are planning values, not billing guarantees.

Offline preflight:

```powershell
node --import tsx scripts/evaluate-test10-sweetwater-claims2.ts
```

Future paid run, **not executed**. Review and freeze a versioned inventory before setting the authorization variable:

```powershell
$env:ALLOW_PAID_TEST10_SWEETWATER_CLAIMS2_LUNA='1'; node --import tsx scripts/evaluate-test10-sweetwater-claims2.ts --live-luna
```
