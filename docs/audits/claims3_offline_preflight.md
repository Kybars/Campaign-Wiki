# Claims-3 isolated extraction — offline implementation and preflight

Status: **READY FOR LIVE-AUTHORIZATION REVIEW**. No Claims-3 model call has been made. This is implementation readiness, not a semantic extraction score.

## Workflow boundary

Production PDF processing extracts physical pages, makes overlapping inventory chunks, and packs semantic evidence units for lean graph extraction. It processes incrementally. Claims-3 is a separate local benchmark harness and is not imported by production processing, persistence, the wiki UI, or GM editing. It uses the four *frozen Claims-2* request windows below, not a whole-PDF call. The private source books and saved model output stay under ignored `fixtures/private/`.

The offline command is:

```powershell
node --conditions=react-server --import tsx scripts/evaluate-claims3.ts
```

It verifies each PDF against the frozen page text, verifies source, inventory, evidence-manifest and result identities, revalidates saved Claims-2 output, and writes only `fixtures/private/claims3-v1/preflight.v1.json`. The latter contains the full request context, hashes and checkpoint identities. Missing private fixtures fail closed; they are never replaced with other source material.

## Verified Claims-2 baselines

All hashes here are SHA-256. The WotBS evidence-manifest and inventory hashes are deterministic hashes derived from the frozen fixture because Claims-2 did not save separate files for them. Its PDF hash is the *local five-page source PDF*, verified against every fixture page; the frozen fixture hash also includes historical inventory, reference and baseline payloads.

| Benchmark | Source PDF hash / fixture hash | Claims-2 requests; physical pages; evidence units | Inventory version / hash | Evidence manifest hash | Completed saved result / file hash |
| --- | --- | --- | --- | --- | --- |
| Test 9 WotBS | `1f9c556e5e4150c9424560e79fa7154826516a13ffedf7da7213185d3134828c` / `d7733ff9705391572d25f0b3c2c6188ee57c37f69d5a3b65507ccd8b4990ade7` | `test9-claims2-1`: 10–12, 71; `test9-claims2-2`: 13–14, 66 | Test 9 fixture inventory / `7169dd94a13ccadbf2e00a17318dc4afea317393952279ae1212c9cd4eee9ac0` | derived `e62fb9c5fd9a692a04c9931776dc15e3468fb0001dd45722cc60fdf5700e0e66` | `fixtures/private/test9-focused-ab/claims2-v067-result.json` / `68870a3d04705cf7d42b13c0353859abec96107bdb4dfc782e63d04faa00f67c` |
| Test 10 Sweetwater | `87f0d5f8099d1881ecad6a6bba03d2807df6bd07138975dead3d1fea373e42cc` / `61452bd607529afae3cf944114f9e56e57da18c3112e4a1f274b62c6f58ab03b` | `test10-sweetwater-claims2-v3-1`: 6–13, 163 | v3 frozen from reviewed v2 / `cb1830f904f217004022b85b7ea0e0d2d6961e390a797d65d021e4ad6e7400d4` | `86c639143593147d61f50ba1945c1918f6103e494289673ce250d0e0cd00b3a9` | `fixtures/private/test10-sweetwater-v1/result.v3.json` / `add2e5e71741231fa2c23329b507ef65db4b499d87e3b93bcc96c85c457aa3ee` |
| Test 11 Tales | `07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377` / `8854dc07e62527eb07c14d6f2f8c0551e4dafa415075d86988c270d04be3787d` | `test11-tales-claims2-v1-1`: 27–30, 211 | v1 frozen / `5744751f7733638fbc66e66fd56cfb3d0079ae5bc24da9834ce016ab7755150d` | `8f5f81aa094494e3373be6f8ec5206e02f0feb71da239e9e24b315733e508fa5` | `fixtures/private/test11-tales-claims2-v1/result.v1.json` / `2505b20b04193a528f41dfca5fd46d8969406c76d75057f1966146a98639e1a1` |

Saved progress confirms two completed WotBS requests and one completed request for each other benchmark. Saved structural results are WotBS 147 claims, Sweetwater v3 104, and Tales 145 valid of 155 proposed; these are *Claims-2* counts, not Claims-3 output or quality scores. Sweetwater `preflight.v1.json` and `preflight.v2.json` exist, but neither `result.v1.json` nor `result.v2.json` exists. The v2 preflight is a blocked **two-request proposal**. The completed single-request **v3** result is the baseline.

## Four-request Claims-3 plan

Prompt SHA-256: `6634296e1cb6ed0f57871c506ff3e338eef59d75af4593f23f59c6752ef3ed43`. JSON schema SHA-256: `5467adb196003345ed7302ff6a54136f3f9aaca0b7da6105c4fdc5e4ade480b7`. Behavior version: `claims-3-experiment-1`; schema version: `1`. Estimated input uses the existing four-characters-per-token estimator, including source, entities, prompt and schema. Reserved input uses a 1.2 multiplier. The dollar estimate reserves **maximum** output and uses the historical planning rates in the saved Tales Claims-2 preflight ($0.275/M input, $0.825/M output). It is not a current price quote or billing guarantee.

| Claims-3 request → Claims-2 baseline | PDF pages | Units | Claims-2 estimated input | Claims-3 estimated input / reserved input | Output cap | Reserved tokens | Planning cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `test9-claims3-1` → `test9-claims2-1` | 10–12 | 71 | 3,651 | 4,425 / 5,310 | 9,000 | 14,310 | $0.008885 |
| `test9-claims3-2` → `test9-claims2-2` | 13–14 | 66 | 3,142 | 3,933 / 4,720 | 9,000 | 13,720 | $0.008723 |
| `test10-sweetwater-claims3-v3-1` → `test10-sweetwater-claims2-v3-1` | 6–13 | 163 | 4,613 | 5,111 / 6,134 | 12,000 | 18,134 | $0.011587 |
| `test11-tales-claims3-v1-1` → `test11-tales-claims2-v1-1` | 27–30 | 211 | 5,955 | 6,629 / 7,955 | 12,000 | 19,955 | $0.012088 |
| **Total** | | **511** | **17,361** | **20,098 / 24,119** | **42,000** | **66,119** | **$0.041283** |

The *raw page spans, evidence-unit IDs, offsets and request boundaries* match Claims-2. Input bytes differ: Claims-3 has its own prompt/schema, includes canonical IDs in entity context, and seeds one system-created Heroes identity. Tales replaces the source-discovered `Party` inventory entry with that identity. Sweetwater additionally repairs inherited room context for the page-11 S1 continuation and S3/S5 subheadings, and strips confident S-number prefixes from display context. These are context-packaging changes, so this is a frozen-source/request comparison, **not** an exact input-level comparison.

## Claim behavior and safeguards

The output schema has self-contained statements, entity names to resolve, and one or two cited unit IDs with physical PDF pages. Validation maps citations back to exact raw-page offsets, rejects headings, incorrect pages, nonadjacent or cross-context pairs, and obvious conditional-event or named-cause omissions. Resolved associations are canonical IDs without semantic roles. Inventory misses stay attached to their claims and appear as possible rescue targets; no rescue call is made. Deduplication requires the same normalized sentence and context, unions evidence and all associations, and retains differently qualified or contradictory sentences. A fixed Heroes identity exists on every request without fabricated PDF evidence. Section headings are optional deterministic metadata with safe fallback; no model heading fields or calls are added.

These deterministic guards **cannot prove full semantic support** for every future generated paraphrase or measure recall. A citation may be structurally valid yet semantically wrong. Live output would need a separate source audit before any quality claim or production integration. A small number of claims alone does not trigger rescue.

The future live path imports the SDK only after `--live-luna`, shell-level `ALLOW_PAID_CLAIMS3_LUNA=1`, an exact `--allow-requests=` list, and `--max-calls=` from 1 to 4 pass. It uses zero SDK retries, records `dispatching` durably before the request, and refuses automatic retries after failed or uncertain dispatch. Claims-2 flags do not authorize it. No live mode was run for this report.
