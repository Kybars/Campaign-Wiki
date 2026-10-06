# Claims reconciliation 2.3.2

Application 0.6.12 uses the separate `claims-4-1-reconciliation-2.3.2`
entry point in the isolated Claims document backend. Reconciliation 2.2.4,
2.3.0 and 2.3.1 remain unchanged. Claims extraction, packing, inventory
normalization and mechanics classification remain unchanged.

Generic classification examines actual direct source wording and preceding
contiguous source scope. Determiners, quantities, lower-case plurality and
common-noun morphology can establish a class even when Claims capitalizes its
participant. Inventory names/aliases, explicit naming, possible internal title
case and known named owners block generic guesses. Qualified singular labels
require descriptive modifiers supported by source; this does not introduce
unique-designation candidate handling. Every new generic resolution retains its
source proof and creates no candidate.

Source reference recovery inspects definite/common references and local
pronouns even when the canonicalized participant is absent from the direct
sentence. An existing inventory identity must have a proposition anchor that
explicitly names and establishes its type. Heading text alone provides no type
preference. Reference nouns must bind to that subject, rather than merely share
its entity type. Anchors persist only in contiguous equal/ancestor-compatible
semantic heading paths. Sibling/unrelated paths, competing subjects and
contradictory type anchors prevent inheritance; page breaks alone do not.
Pronouns additionally require a local unique explicit subject with no competing
named/unknown subject. No gender or world knowledge is used.

The stage records decisions and supporting anchor units. Existing exact,
candidate, descriptor, collision, discrepancy, schedule, rumor and random-event
stages remain available. Inventory collisions never create a candidate. Source
form decisions run before the preserved fallback stages, while explicit naming
and persistent identity-transition proof continue to protect existing candidates.

`scripts/replay-claims-acceptance-v232.ts` validates pinned private inputs,
blocks network dispatch, executes reconciliation once document-wide and refuses
an existing export directory. `scripts/claims-source-form-audit.ts` exports each
changed participant and the residual audit; it checks frozen claim fields,
preserved canonical identities and absence of new candidates. The read-only
`scripts/verify-claims-source-form-replay.ts` validates saved acceptance cases,
bounded anchors and unchanged inventory/proposals without rerunning reconciliation.
`scripts/replay-claims-historical-v232.ts` preserves historical artifacts and
exports every WotBS/Sweetwater claim delta.

See [the Tales decision audit](audits/tales_reconciliation_v2_3_2.md).
