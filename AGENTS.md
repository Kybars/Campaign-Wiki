<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Campaign Wiki engineering contract

## Project purpose

Campaign Wiki turns supplied campaign material into an interconnected, source-backed campaign wiki. AI performs transcription, extraction, linking, and tedious organization. The GM owns authorial decisions: importance, visibility, corrections, and campaign state.

## Source-of-truth order

1. This file
2. `docs/CURRENT_STATE.md`
3. The active milestone in `IMPLEMENTATION_PLAN_V0_4.md`
4. Task-relevant code and tests
5. `PRODUCT_SPEC.md` when product semantics are involved

Old implementation plans are historical unless the active plan references them. If code and prose disagree, report the conflict; do not silently reinterpret either.

## Processing architecture

- Provider and processing mode are orthogonal.
- Providers include OpenAI and an explicitly configured local compatible endpoint; the model/provider identity remains visible in diagnostics.
- The default mode is `lean`.
- Lean flow: extraction → reconciliation → canonical graph → lean projection → transactional persistence → Wiki Ready.
- Lean makes zero post-reconciliation enrichment calls.
- `full` enrichment is optional and retained as a reference path.
- A local-provider failure must never silently fall back to paid OpenAI.

## Knowledge and provenance

- Every displayed extracted fact needs supporting evidence.
- Entity-existence evidence and fact evidence are distinct.
- Store each logical relationship once and render it bidirectionally.
- Location containment is authoritative, source-backed, and cycle-safe.
- Prefer false negatives to invented facts, false positives, or wrong merges, but do not omit clearly named, source-backed entities merely because they are minor or have few facts.
- `Enemy` is a role/tag, not an entity type; `Deity` is an entity type; `Other` is the sparse fallback.
- Search must not depend on prominence.

## Visibility and Player View

- Visibility is `dm_only` or `player_visible`.
- Lean imports default entities, facts, and relationships to `dm_only`.
- Player View fails closed.
- Hidden knowledge must not leak through counts, search, sources, relationships, breadcrumbs, location hierarchy, timelines, summaries, or fallbacks.
- Never use a GM summary as a Player fallback.
- Player-generated text may use only Player-safe canonical knowledge.
- Current DM/Player View is preview/read mode, not authentication or authorization.

## Durability and checkpoints

> Validated AI work is durable work.

- Reuse identity is provider-, model-, semantic-input-, prompt/behavior-, schema-, and upstream-aware.
- Revalidate cached output before reuse.
- Failed or invalid output is never a successful checkpoint.
- Changing provider, model, semantic input, behavior version, schema, or upstream fingerprint invalidates reuse.
- Never fabricate checkpoint metadata for historical caches that did not store it.

## Security

- Service-role and model credentials remain server-only.
- Never put provider secrets under `NEXT_PUBLIC_*`.
- RLS stays enabled for private server data; checkpoint/cache tables have no public policies.
- Keep Vercel upload protection enabled.
- Local-provider configuration and endpoints are server-side.
- Cached campaign-secret model output is never exposed to clients.

## Database migrations

- Put schema and policy changes in committed, timestamped Supabase migrations.
- Apply migrations through the linked Supabase CLI workflow; verify remote history before declaring a milestone complete.
- Preserve existing migration history and campaign data unless a separately authorized migration explicitly changes them.
- Do not use destructive remote reset commands for normal development or verification.

## Benchmarks

- Test 2 is immutable unless explicitly authorized.
- Preserve Test 3 history.
- Do not re-extract, re-reconcile, or execute models for Test 3 unless explicitly authorized.
- Deterministic reads, dry-runs, and evaluations are allowed.
- Current Test 3 counts and fingerprint belong in `docs/CURRENT_STATE.md`, not here.

## Costs

- Do not make paid model calls without explicit authorization.
- Dry-run and preflight perform no generation.
- Reused checkpoints are not new model calls.
- A server-side OpenAI attempt ceiling must preflight planned work and guard actual application-level dispatches; semantic retries consume it, while local calls and reuse do not.
- Unknown local token usage is `null`, never zero.
- Never apply OpenAI pricing to local usage.
- Keep costly optional enrichment explicit.

## Scope discipline

- Implement only the active milestone.
- Do not opportunistically build later roadmap features.
- Do not weaken validators to make local models or tests pass.
- Prefer the smallest backward-compatible change.
- Preserve unrelated working-tree changes.
- Stop and report if a required change conflicts with these durable rules.

## Versioning and verification

- Inspect `package.json`; document or run only commands that exist.
- Canonical checks: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` when appropriate.
- Deterministic evaluations: `npm run evaluate:replay`, `npm run evaluate:enrichment`, `npm run evaluate:lean`, `npm run evaluate:enrichment-workload`, `npm run evaluate:extraction-workload`, `npm run evaluate:checkpoints`, and `npm run evaluate:recall`.
- `npm run evaluate` is the optional live extraction evaluation and requires configured OpenAI credentials; it is never part of normal verification.
- Provider preflight is `npm run ai:preflight`; it makes no generation call. `npm run smoke:local` requires an already running local model.
- Normal deterministic verification must not need OpenAI credits or a running local model unless a dedicated smoke test says so.
- For a product release, increment the package patch version and keep `package.json`, `package-lock.json`, and the newest changelog entry aligned. Do not create a meaningless version bump for docs-only work.

## Future compatibility

- Campaign knowledge will later become multi-source and incremental.
- Future inputs may include PDF, DOCX, Markdown, text, supplements, and session notes.
- Do not add assumptions that a campaign is exactly one PDF.
- Preserve provenance and GM corrections when later sources are introduced.

## Future milestone prompt contract

Start normal milestone work with:

```text
Read:
1. AGENTS.md
2. docs/CURRENT_STATE.md
3. the active milestone section of IMPLEMENTATION_PLAN_V0_4.md
4. only task-relevant code/tests
```

Do not perform a broad repository scan unless the targeted files reveal an unresolved dependency.
