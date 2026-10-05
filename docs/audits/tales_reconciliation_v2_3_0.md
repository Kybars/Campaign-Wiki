# Tales frozen extraction: reconciliation 2.3.0 diagnostic audit

Application checkpoint: 0.6.10. Baseline HEAD:
`5f3e645979cd8a0b0dd55d63d5ab9afe9edf7d3b`.
All counts below are deterministic diagnostics, not scores or optimization targets.

## Frozen inputs and private output

Acceptance manifest SHA-256:
`eb970869b2b54ea72d7a5a220a8120abda8b43fd6e6cd149337e1f699b399621`.
Every listed artifact was hash/size-verified before consumption and reverified
after export. The acceptance directory and historical bundles were never mutated.

Final replay: `fixtures/private/tales-full-reconciliation-230-replay-v3/`.
Replay manifest SHA-256:
`4e765cfb4fe0757c6061f250dc0beb4b09b41e8bdf4db6d469bb0f06a78e41b0`.
Earlier development exports v1/v2 remain private and preserved. The final export
contains one complete document-wide reconciliation pass and no extraction calls.

Raw Claims file SHA-256 before/after:
`377a26670a3e7879bf36f78d24933f5f2b8bfc68f5e425e976b1db33052c170d`.
Raw proposal JSON-value SHA-256 before/after:
`e52dd78bd74543454ed7a5343b3c11ecfd61695f0ea542351d5c39421ace6584`.
All 1,891 proposal fields, order, original values and request/local/global indexes
are preserved. All 1,999 evidence-unit IDs, order, text and raw spans are preserved.

Frozen prompt SHA-256:
`d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58`.
Frozen model-schema SHA-256:
`16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb`.
The v2.2.4 module and packer/source-builder module remain unchanged. The copied
mechanics function has the same SHA-256 in both versions:
`fa239d0911f57c6e4fa0947af57d1eadea6eb2f8fb35bca1d78a8b43df08bed2`.

## Diagnostic deltas

| Metric | Acceptance 2.2.4 | Replay 2.3.0 |
|---|---:|---:|
| Inventory entities | 317 | 306 |
| Inventory normalization merges | 0 | 11 |
| Inventory aliases | 0 | 11 |
| Exact normalized same-name groups | 6 | 5 |
| Raw proposals | 1,891 | 1,891 |
| Resolved claims | 1,512 | 1,331 |
| Needs review / GM Review | 331 | 512 |
| Mechanical-only claims | 48 | 48 |
| Canonical participants | 2,631 | 2,570 |
| Candidate participants | 320 | 17 |
| Descriptor participants | 1 | 1 |
| Generic non-entity participants | 237 | 385 |
| Unresolved participants | 395 | 611 |
| Candidate entities | 143 | 8 |
| Duplicate normalized candidate groups | 5 | 0 |
| Entity-associated claims | 1,748 | 1,640 |
| Timeline-associated claims | 0 | 11 |
| No useful home | 95 | 201 |
| Context-evidence claims | 39 | 14 |
| Context-evidence references | 40 | 14 |

Exact normalized same-name metrics do not strip articles. Six ambiguous identity
groups remain under article-aware lookup: normalization keeps different types
separate, and merging an article variant changes one visible primary name without
removing its alias or competing identity. Review increases because existing
inventory ambiguities and unsupported candidate identities remain unresolved.
No rule was tuned to reduce review or hit a candidate count.

| Source status | Before | After |
|---|---:|---:|
| Established | 1,681 | 1,633 |
| Conditional | 173 | 180 |
| Rumor | 1 | 31 |
| Scheduled | 0 | 11 |
| Plan | 16 | 16 |
| GM instruction | 20 | 20 |

## Source-backed regressions

All 19 assertions pass. The annotator detects 321 heading records and suppresses
28 recurring furniture lines. It rejects wrapped sentence fragments, preserves
source-introduced labeled rumor collections, and confines MAGIC to ten source
units that actually contain that heading. No heading changes raw evidence spans.

- All 31 claims sourced from the complete three Rumors sections retain rumor
  status; child district headings do not erase the parent context.
- Day 1/2/3 produce 4/4/3 published scheduled associations with literal relative
  labels. They never become occurred history or real calendar dates.
- All 14 claims sourced from the complete two random-event sections remain
  conditional, with no scheduled Timeline association. There are 17 claims in
  random structural context overall.
- Source-supported proper-name shortening and article-only faction normalization
  preserve aliases, member/original IDs and evidence. Distinct same-named
  identities remain separate.
- Existing ambiguous inventory names spawn no candidates. All 139 checked
  ambiguous participants remain unresolved. All 87 checked common participant
  references become generic non-entities. Candidate normalized-name duplicates
  are absent.

Synthetic tests also cover explicit naming, repeated candidate reuse, sentence
capitalization, alias collisions, wrapped heading fragments, dice-table rows,
hierarchical rumor labels, plans/GM instructions, manifest tampering/traversal and
long-source substitution checks. Private source bytes are not required in CI.

## Historical regression

Both historical and document-wide v2.2.4 entry points reproduce all saved result
fields exactly for WotBS (106 proposals) and Sweetwater (148). Saved bytes remain
intact. Result hashes excluding export-only metadata:

- WotBS: `c5b7c6dc7643074bbbe7d9ad121d17f9dd125c3ef692aa75a37a60ae0bbc7046`.
- Sweetwater: `653fbfe3b64e4bb71e75386cc17362477e02cf033fb008b085d8b1c7b35bba81`.

Separate v2.3.0 replay leaves Sweetwater per-claim results unchanged. WotBS proposal
indexes 27, 71, 79, 80, 95, 98 and 99 expose existing name/alias ambiguity:
canonical participants 215→208, unresolved 10→17, resolved 94→87 and GM Review
12→19. Its generic/descriptor/candidate counts, source statuses and 101 Timeline
associations stay unchanged. Generic efficiency changes preserve this historical
delta report byte-for-byte.

## Verification and boundaries

The tracked test suite plus the two new public test files passes (94 files,
1,107 tests), including source cleaning/mapping, inventory, document pipeline,
Claims-4.1, v2.2.4/v2.3.0 and changelog/version checks. Typecheck and lint pass;
lint retains one pre-existing unused-variable warning. `git diff --check` passes.
Private audit scripts are excluded from lint without changing their bytes.
Four pre-existing untracked holdout files remain outside this release.

Zero model/API calls, zero DB writes/schema changes, zero frontend implementation
changes and zero deployments were performed. Private artifacts and source-derived
outputs are not committed. Only evaluator code, synthetic tests, hashes, counts
and this audit are public.
