# Claims reconciliation 2.3.0: offline full-document hardening

This is a deterministic downstream revision of 2.2.4. The 2.2.4 module remains
unchanged. Normal graph imports, database persistence and frontend flows are
outside this checkpoint. Mechanics detection is copied unchanged from 2.2.4.
Claims-4.1 prompt, model schema, proposal semantics and packing rules remain frozen.

## Source structure

`annotateSourceStructure` reads raw lines inside the existing evidence spans.
Short all-capital, title-case, numbered and Markdown headings become context;
hierarchical numbering and relative day headings retain a parent context path.
Lowercase sentence continuations and closed-class fragments do not become titles;
numbered dice-table rows do not become persistent headings. Source-introduced
labeled rumor collections retain their parent context through child headings.
Recurrence across pages plus page-edge recurrence identifies running furniture.
Recurring rumor/day labels remain semantic headings. Statblock context is confined
to its own evidence unit and never persists into later units/pages. This annotation
does not change text, rawSource spans, evidence IDs, source order or proposal IDs.
Headings embedded in a sentence remain embedded; the evidence is never repacked.

Rumors/reports/hearsay supply rumor source status. Relative `Day N` headings supply
published scheduled Timeline associations with a literal `Day N` presentation label,
using the existing scenario branch convention. They are never occurred history and
do not imply calendar dates. Random contexts remain conditional, with no scheduled
Timeline association. Existing plans and GM instructions retain precedence.

## Inventory identity

The document backend normalizes the result of `buildFinalGraphInventory` before
Claims consumption. Exact normalized and leading-article variants merge only for
the same entity type. Single-token NPC surnames may merge with one uniquely matching
full proper name when source evidence supports the shortening: referential source
usage in a shared cited excerpt or bounded adjacent same-section usage after the full name. Overlap alone
never merges identities. Different entity types remain separate even with the same
visible name. Merges preserve canonical IDs, aliases, original/member IDs, source
records and the supporting normalization reason. No lore claims are generated.

## Participant handling

Existing inventory name/alias/article ambiguity stays unresolved and cannot spawn
a reconciliation-local candidate. This block applies before identity, descriptor,
generic classification and coreference stages. Stable candidates reuse their
normalized document identity and deterministic ID. Explicit competing introductions
remain unresolved rather than being collapsed into an existing candidate.

Candidate evidence must establish a proper name, designation, explicit naming or
persistent transformation endpoint. A solitary sentence-initial capitalized word
does not suffice. Known common roles/objects become `generic_non_entity` unless
source evidence establishes an independent identity or bounded unique coreference.
Identity ambiguity remains in GM Review. Generic participants alone do not create
an unresolved-participant reason; source problems and claims with no useful home
retain their existing review reasons. There is no target review count.

Descriptor registries cache by candidate identity/name/aliases. Name/adjectival
presence filters avoid rebuilding impossible descriptor patterns, and alias
connectivity caches by the enabled identity graph and stops at its fixed point.
Name-pattern caching and clause-presence filters avoid rebuilding impossible
provenance patterns. These are deterministic efficiency changes,
not new resolution rules. Source substitution checks match the existing claim
windows against source tokens without materializing every source window. Long
evidence-unit tests retain discrepancy detection and original-source precedence.

## Offline replay

```powershell
node --conditions=react-server --import tsx scripts/replay-claims-acceptance.ts fixtures/private/tales-full-claims-acceptance-v1 fixtures/private/tales-full-reconciliation-230-replay-v4 eb970869b2b54ea72d7a5a220a8120abda8b43fd6e6cd149337e1f699b399621
node --conditions=react-server --import tsx scripts/verify-claims-document-union-replay.ts
node --conditions=react-server --import tsx scripts/replay-claims-historical-v230.ts
```

Use a new private directory for each export. The replay verifies the pinned root
manifest and every listed artifact before consumption, blocks network transports
before importing downstream modules, copies raw proposals byte-for-byte, and
preserves request/local/global provenance. It reconciles the entire document once;
there is no per-request reconciliation and no extraction dispatch. Injectable
structure/inventory/reconciliation stages support future acceptance comparisons.

Source-backed Tales assertions run only with the private bundle. Public CI uses
synthetic fixtures and manifest-security tests and does not need private bytes.
The source-backed checks validate rumor and relative schedule interpretation,
furniture suppression, bounded statblocks, unique surname/article normalization,
preserved homonyms, generic participants and candidate deduplication. Before/after
counts are diagnostic, not quality scores. Historical outputs are read-only and
hash-verified before exact 2.2.4 comparison and separate 2.3.0 delta reporting.

The full raw Tales union is 1,891 proposals. The frozen prompt hash is
`d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58`;
model schema hash is
`16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb`.
The complete audit bundle remains private/local-only and is never committed.

Application release 0.6.10 uses the completed v3 replay bundle. Its manifest hash is
`4e765cfb4fe0757c6061f250dc0beb4b09b41e8bdf4db6d469bb0f06a78e41b0`.
Earlier development exports v1/v2 are preserved. The exported v3 result contains
one complete document-wide reconciliation execution, with 19 source-backed
assertions passing. Diagnostic counts and historical deltas are recorded in
`docs/audits/tales_reconciliation_v2_3_0.md`.
