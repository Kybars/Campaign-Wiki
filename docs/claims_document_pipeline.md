# Full-document Claims backend experiment

This isolated backend runner reuses PDF extraction, `cleanDocumentPagesForModel`,
`chunkPages` with the configured `PDF_CHUNK_TARGET_CHARACTERS` and one page of
inventory overlap, `extractInventoryChunksLimited` (initial inventory and
completeness per chunk), and `buildFinalGraphInventory`. Normal upload processing
remains on its existing graph path. Application release checkpoint 0.6.9 records
this backend experiment, Claims-4.1 extraction, and reconciliation algorithm v2.2.4.
It does not enable live extraction, production persistence, or frontend integration.

After global inventory union, the new path builds generic ordered Claims evidence
units with production semantic-to-raw mapping factored into `source-mapping.ts`.
Offsets address the existing extracted `DocumentPage.text`, not PDF byte offsets.
Standalone explicit Markdown headings or confidently uppercase raw headings are
interpretive only. Other prose remains claim-bearing regardless of participants.
Cleaning may join raw lines; heading recovery does not change extraction/cleaning.
Evidence coverage counts all cleaned non-whitespace characters, including headings.

The Claims packer operates over evidence units, independently of inventory page
chunks. Every sentence has one primary owner, with no overlap or context copies.
Each request uses the complete global inventory and permanent Heroes identity.
It calls frozen `planClaims41Request` and `serializeClaims41Request`, estimating
prompt + complete serialized payload + JSON schema at four characters per token.
Target input is 12,000 estimated tokens; hard input limit is 16,000. An indivisible
unit plus inventory over the hard limit stops planning. Unit context travels with
each unit even when its original heading lies in an earlier request.

Raw proposals are concatenated in planned request order and model proposal order;
separate request/local/global proposal indexes preserve audit provenance. All
evidence is supplied to exactly one invocation of frozen `reconcileClaims41V224`.
The backend artifact preserves raw proposals, candidate entities, identity/alias
metadata, GM Review, mechanical-only claims, entity and Timeline associations.
It does not convert Claims to CanonicalGraph. Graph first pass, relationship span
extraction/rescue/reconciliation, enrichment, graph-core construction and production
persistence are bypassed. No frontend or database integration is included.

## Safety and dependent planning

Every new model stage explicitly uses `gpt-6-luna`. Model environment defaults and
fallbacks cannot select another model. Initial inventory and completeness each have
a 12,000-token output ceiling; Claims has 24,000. Inventory emits compact
name/type/page triples over production-sized source chunks, rather than rich entity
articles. The 12,000 ceiling is a conservative generic reservation for these
unbounded-array schemas, not a predicted entity count or guarantee against output
truncation. An incomplete response stops without retry. Optional generic provider
`maxOutputTokens` leaves historical payloads unchanged when absent.

The dedicated SDK client and each dispatch set `maxRetries: 0`. Exclusive file
creation and fsync commit an attempt before dispatch. Raw response (including usage)
is flushed before parsing. Validated output and usage are stored before the next
operation. Source hash, stage, operation ID, provider/model, behavior/pipeline
versions, schema hash, serialized input hash, output reservation and upstream source
and inventory payload fingerprint determine checkpoint identity. Compatible successes
are hash-checked and schema-revalidated on reuse. Uncertain, failed, incomplete or
invalid prior attempts cannot automatically redispatch. This reuses operation hash
primitives and the inspected holdout file-write safety design, with no dependency
on benchmark-specific dispatch/reconciliation. All four prior untracked holdout
files are left intact and outside this implementation commit.

Inventory results determine final Claims request IDs and count. Authorization is
therefore staged: review/authorize inventory, then review the resulting frozen Claims
plan and explicitly authorize Claims. Each stage requires its exact full ID allowlist
and max-call count; dispatches are checked against both. Checkpoint reuse consumes
zero calls. `--checkpoint-run` points a new artifact version at earlier checkpoints
for resume; ambiguous attempts still block. Claims mode replays and validates actual
inventory checkpoints in reuse-only mode, without creating a client or dispatching
inventory. A planning inventory is never substituted for the actual inventory.

**Frozen contract blocker:** `claims41OutputSchema` limits output to 400 proposals,
and v2.2.4 validates the document union with that schema. A union exceeding 400 is
saved intact and reconciliation stops. Nothing is truncated, deduplicated, summarized
or independently reconciled. A separately authorized frozen-contract decision is
required before claiming arbitrary full-document reconciliation capacity.

## Offline acceptance preflight

Run the source-agnostic CLI with explicit source, new private output directory,
expected source hash and expected page count:

```powershell
node --conditions=react-server --import tsx scripts/claims-document-pipeline.ts --preflight '--source=fixtures/private/narrative-dev/Tales_of_the_Demon_Lord_no_bkgd_v6-5-16 (1).pdf' --output=fixtures/private/tales-full-claims-pipeline-preflight-v8 --expected-sha256=07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377 --expected-pages=49
```

Acceptance completed locally on the complete private Tales PDF, hash
`07f3bda14d7375f3da6f008aa499bc0fe2ee90e7183e11f2a64eeeb96fdf3377`:
49 pages, 6 coarse inventory chunks, 12 planned inventory calls, 1,999 evidence units.
All spans round-trip, all cleaned non-whitespace text is accounted for, and no
primary ownership is duplicated or omitted. Actual Claims counts and total planned
calls/input tokens remain unknown until actual inventory exists. Synthetic inventory
demonstrates generic packing over the complete source; its counts are capability-only.
No model calls, API requests, database writes or frontend changes occurred.
The v0.6.9 release preflight bundle lives under ignored `fixtures/private/tales-full-claims-pipeline-preflight-v7/`;
v1–v6 remain preserved prior preflights. The PDF is not copied into any bundle.

Deterministic verification passed 93 test files / 1,093 tests (including all 14 new
generic pipeline tests), typecheck, lint (three pre-existing warnings, zero errors)
and `git diff --check`. Frozen Claims implementation/reconciliation and historical
fixtures have no diff from baseline `29857f5125cf022809b35b3217bfe0da3be8b95f`.

The runner emits source, cleaning, inventory-chunk, evidence, packing, model-policy,
call-safety, pipeline-preflight and verification artifacts, plus per-artifact SHA-256
manifest and a hash of the manifest. Full run checkpoints and outputs are private too.

Future live modes (implemented, not executed) require `--live-luna`,
`ALLOW_PAID_CLAIMS_DOCUMENT_LUNA=1`, `--phase=inventory` or `--phase=claims`,
`--allow-requests=<exact comma-separated IDs>` and `--max-calls=<exact stage count>`.
Claims additionally requires `--inventory-run=<reviewed actual inventory directory>`.
Every output directory must be a new version beneath `fixtures/private/`.
Do not enable live mode until human code review, the frozen 400-proposal limitation
and staged authorization have been addressed. No semantic quality verdict is implied.
