# Claims reconciliation 2.3.1

Application 0.6.11 adds a deterministic downstream version alongside immutable
2.3.0 and 2.2.4 modules. Claims-4.1 extraction, model schema, packing, raw proposal
values and mechanics are unchanged. No database, frontend or deployment changes.

## Inventory collision resolution

`matchingInventoryEntities` collects all canonical name, alias and leading-article
matches without name-over-alias precedence. One identity resolves normally. Multiple
matches never create a candidate. `resolveInventoryCollision` uses only the claim's
direct source spans and the existing inventory source records. Generic explicit
type grammar or a uniquely matching source excerpt on the same page can select
one existing entity. Page overlap alone cannot select an entity. Conflicting or
nonunique signals remain unresolved; source discrepancy review still applies.

Type grammar is anchored to the actual mention, not capitalization or unsupported
proposal wording. Named location, faction, deity, item, quest, event and disease
grammar is supported. A matching structural section can anchor a definite physical
referent or disease in the direct span; a heading alone never proves quest identity.
Chapter titles do not convert all same-named propositions into adventure claims.
The resolver receives server-side inventory source records separately from the
frozen extraction request and model serialization.

`normalizeClaimsInventoryV231` first runs historical normalization unchanged. Its
additional merge requires the same normalized name, exactly one specific-type
identity, a shared source passage explicitly supporting that type, and **every**
independent record on both identities supporting that same interpretation. Only
`other` fallback records may merge. Unknown or conflicting sources block merging.
Canonical IDs, aliases, member/original IDs, source records, reason and evidence
remain available. Shared passages with unsupported type disagreements stay separate.

Candidate deduplication, generic classification, source structure, rumor/random
semantics, Day N scheduling, identity/descriptor rules and source-discrepancy logic
are inherited from 2.3.0. The experiment's document backend selects 2.3.1; normal
wiki graph imports are unchanged.

## Offline parity and exports

`replayAcceptanceBundle` now normalizes `structure.units`, fixing its use of
`originalUnits`. A mocked production inventory run and a synthetic offline replay
assert equal structured evidence units at the normalization boundary. All raw
coordinates, IDs, text and order remain unchanged.

The new exporter verifies the acceptance manifest and every artifact, blocks
network transports, reconciles the document once and writes an exclusive private
directory. The saved-result audit exporter verifies and copies immutable payloads
without calling reconciliation, correcting diagnostic classifications and adding
the seven requested source-backed case assertions. Existing exports remain intact.

```powershell
node --conditions=react-server --import tsx scripts/replay-claims-acceptance-v231.ts <acceptance-directory> <new-private-output> <acceptance-manifest-sha> <historical-report>
node --conditions=react-server --import tsx scripts/replay-claims-historical-v231.ts <new-private-report>
node --conditions=react-server --import tsx scripts/verify-claims-document-union-replay.ts
node --conditions=react-server --import tsx scripts/audit-saved-claims-v231.ts <acceptance> <acceptance-sha> <saved-replay> <replay-sha> <new-private-output>
```

The completed release export is
`fixtures/private/tales-full-reconciliation-231-replay-v2/`, manifest
`7a16d46c5a9fadfd17a6a92d492a8b0b8e50db7ddfe539dbd7b7b5cd8e49fb2d`.
Its reconciliation bytes come from the single v1 execution; the v2 export performs
zero additional reconciliation executions. All private source-derived payloads
remain gitignored. Public CI uses synthetic fixtures.

Frozen prompt SHA-256:
`d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58`.
Frozen model schema SHA-256:
`16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb`.
See [the completed audit](audits/tales_reconciliation_v2_3_1.md).
