# Campaign Wiki v0

Campaign Wiki turns one text-based tabletop campaign PDF into a persistent, interconnected wiki. It extracts text per page, asks an OpenAI model for evidence-backed entities and relationships, reconciles duplicate references globally, stores the canonical knowledge graph in Supabase/PostgreSQL, and renders searchable wiki pages with clickable relationships and source quotes.

This is deliberately a focused v0. It has no authentication, editor, OCR, multi-document support, semantic search, chat, maps, timelines, or graph visualization.

## Architecture

The application is a single Next.js App Router project:

```text
browser upload
  -> server-side PDF.js page extraction
  -> Supabase Storage + document_pages
  -> complete-page chunks with one-page overlap
  -> OpenAI Responses API structured extraction (Zod)
  -> persisted raw + validated per-chunk extraction cache
  -> programmatic page/quote/endpoint validation
  -> deterministic normalized-name and explicit-alias grouping
  -> conservative AI global reconciliation
  -> canonical endpoint remapping and relationship deduplication
  -> transactional PostgreSQL graph replacement
  -> server-rendered campaign, category, search, and entity pages
```

Important design properties:

- The PDF is stored in the private `campaign-pdfs` Supabase Storage bucket.
- PDF page identity is preserved in `document_pages`.
- Entity and relationship sources have foreign keys to real stored document pages.
- Model output is parsed directly into Zod schemas using the official OpenAI SDK. Normal browsing never invokes OpenAI.
- Uploaded text is delimited and explicitly treated as untrusted data in the extraction prompt.
- Exact normalized names and explicit aliases merge deterministically. Similar names alone do not.
- One directional relationship row is stored and rendered from both endpoints.
- Graph replacement is one PostgreSQL function call, so a partial canonical graph is not exposed.
- `processing_runs` and reconciliation metadata preserve candidate IDs, merge reasons, counts, and discarded-item diagnostics.
- Every successful future import stores raw parsed chunk output, provenance-validated chunk output, validation diagnostics, and the reconciliation decision for cost-safe replay.

The OpenAI integration follows the official [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs) (`responses.parse` plus `zodTextFormat`). The default `gpt-5.6-terra` model supports both the Responses API and structured outputs. `OPENAI_EXTRACTION_MODEL`, `OPENAI_RECONCILIATION_MODEL`, and `OPENAI_ENRICHMENT_MODEL` configure the stages independently and each falls back to `OPENAI_MODEL`, preserving existing `.env.local` files. See the official [model page](https://developers.openai.com/api/docs/models/gpt-5.6-terra).

## Key directories

- `app/` — upload, processing, campaign, category, search, entity pages, and route handlers
- `lib/pdf/` — page-preserving extraction and deterministic chunking
- `lib/ai/` — centralized schemas, prompts, OpenAI calls, provenance validation, and reconciliation
- `lib/graph/` — aggregation, normalization, duplicate grouping, canonicalization, and relationship resolution
- `lib/processing/process-campaign.ts` — end-to-end processing orchestration
- `lib/db/` — typed Supabase access, persistence, and wiki queries
- `lib/knowledge/` — shared fact fields, provenance, visibility, and prominence domain types
- `supabase/migrations/` — schema, private storage bucket, constraints, RLS, and transactional persistence function
- `fixtures/` — six-page evaluation campaign in JSON and PDF form
- `scripts/` — fixture generation and optional live extraction evaluation
- `tests/` — deterministic pipeline and PDF tests

## Prerequisites

- Node.js 20.9 or newer (Node 22 LTS is a sensible local choice)
- npm
- A Supabase project
- The Supabase CLI for applying migrations
- An OpenAI API project/key with access to the configured model

## Environment

Copy `.env.example` to `.env.local` and fill in:

```dotenv
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5.6-terra
OPENAI_EXTRACTION_MODEL=gpt-5.6-terra
OPENAI_RECONCILIATION_MODEL=gpt-5.6-terra
OPENAI_ENRICHMENT_MODEL=gpt-5.6-terra

NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Campaign imports
ALLOW_CAMPAIGN_UPLOADS=true

AI_EXTRACTION_CONCURRENCY=3
PDF_CHUNK_TARGET_CHARACTERS=45000
```

`SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` are server-only secrets. Never prefix them with `NEXT_PUBLIC_`, commit `.env.local`, or expose them in browser code. The anon key is included for conventional Supabase project configuration, although v0 database access is server-only.

### Campaign upload access

For local development, enable campaign imports in `.env.local`:

```dotenv
ALLOW_CAMPAIGN_UPLOADS=true
```

For Vercel, explicitly configure the deployment as read-only:

```dotenv
ALLOW_CAMPAIGN_UPLOADS=false
```

Existing Supabase-backed campaigns and wiki pages remain readable when imports are disabled, but the upload form is hidden and the upload API rejects direct requests before parsing a PDF or performing Supabase/OpenAI work. If the variable is omitted, uploads default to disabled when `VERCEL=1` and enabled otherwise. Explicit values must be `true` or `false` (case-insensitive).

## Supabase setup

1. Create a Supabase project and copy its URL, anon key, and service-role key into `.env.local`.
2. Install and authenticate the Supabase CLI.
3. From this repository, link and push the committed migrations:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

The migrations create:

- `campaigns`
- `documents`
- `document_pages`
- `entities`
- `entity_sources`
- `entity_facts` and fact-specific `fact_evidence`
- separate entity-summary and campaign-overview evidence tables
- `relationships`
- `relationship_sources`
- `processing_runs`
- `extraction_cache_runs` and `extraction_cache_chunks`
- `reconciliation_cache_results`
- `enrichment_cache_runs`
- the private `campaign-pdfs` Storage bucket
- `replace_campaign_graph(...)` for transactional/idempotent graph persistence
- DM/player visibility, nullable universal prominence, and separate GM/player summaries and overviews
- explicit `service_role` table grants (newer Supabase projects may not create these default grants)

RLS is enabled with no public policies. The server-side service role performs all v0 access. Do not add a browser-facing service-role client.

## Install and run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`, enter a campaign name, choose one text-based PDF, and select **Generate Wiki**. Upload extracts and stores all pages first. The processing screen then runs candidate extraction, reconciliation, and persistence before redirecting to the wiki.

An image-only/scanned PDF is rejected with a text-based-PDF explanation; v0 does not attempt OCR.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The normal test command makes no network or paid model calls. It covers:

- name and relationship normalization
- page-preserving chunking and overlap
- real PDF text extraction and blank-PDF rejection
- the six-page campaign PDF fixture
- exact-name and explicit-alias duplicate handling
- similarly named distinct people
- AI-decision safety and canonical endpoint remapping
- relationship deduplication/source consolidation
- self-edge rejection after reconciliation
- source page/quote validation
- bidirectional relationship rendering

## Release notes

The current application version is the `version` in `package.json`. Release notes live in `lib/changelog.ts`; the newest entry reads that manifest version and powers the version-badge preview and `/changelog` page. For each future release, run `npm version patch --no-git-tag-version` (or the intended semver command), add a concise newest-first entry to `lib/changelog.ts`, and keep the changelog tests passing.

## Deterministic replay evaluation

Run `npm run evaluate:replay` to build the small regression fixture from cached candidate data, apply its saved reconciliation decision, and report graph, source, role, and location metrics with zero OpenAI or Supabase calls. `npm run evaluate` remains the optional live fixture extraction evaluation and requires configured OpenAI credentials.

The replay evaluation also exercises the v0.3 rich-fact fixture. Rich extraction cache schema version 4 requires per-candidate `facts`; older cache versions remain replayable as intentionally factless legacy data. See [`docs/V0_3_RICH_FACT_EXTRACTION.md`](./docs/V0_3_RICH_FACT_EXTRACTION.md).

Run `npm run evaluate:enrichment` for the deterministic post-reconciliation prominence, visibility, summary, overview, and consistency fixture. It makes zero OpenAI and Supabase calls. See [`docs/V0_3_CANONICAL_ENRICHMENT.md`](./docs/V0_3_CANONICAL_ENRICHMENT.md).

## Milestone 8 benchmark checklist

Before one final real import, record duplicate and false-merge rates, major missing entities, type/deity/enemy-role accuracy, missing or inverse-duplicate relationships, endpoint and source fidelity, parent/missing/incorrect containment, wiki compactness/navigation/source inspection, and extraction/reconciliation model calls, tokens, and estimated cost. Compare those results with the Test 2 baseline; do not overwrite it.

## Extraction evaluation

Generate or refresh the known PDF fixture:

```bash
npm run fixture:pdf
```

With `OPENAI_API_KEY` and `OPENAI_MODEL` configured, run the optional paid live-model evaluation:

```bash
npm run evaluate
```

The harness extracts the fixture PDF page by page, deliberately creates overlapping chunks, runs the real structured extraction and reconciliation calls, and reports:

- expected/missed/unexpected entities
- expected/missed relationships
- rejected source evidence
- discarded relationships
- candidate and canonical counts

The fixture includes a recurring NPC, an explicit alias, two similarly named distinct NPCs, multiple locations and factions, important items, an event, a quest, explicit relationships, and repeated relationships across overlapping chunks. Evaluation is diagnostic rather than a strict probabilistic test.

## Replaying a cached import

After applying the Milestone 0 migration, every new successful import persists its candidate extraction before reconciliation and graph persistence. Rebuild a campaign's canonical graph from its latest complete cache with no OpenAI calls:

```bash
npm run replay -- CAMPAIGN_UUID
```

This reuses both the validated candidates and latest cached reconciliation decision. To deliberately rerun only reconciliation while still avoiding all chunk extraction calls:

```bash
npm run replay -- CAMPAIGN_UUID --refresh-reconciliation
```

The refresh form requires `OPENAI_API_KEY`; the default replay only requires Supabase configuration. Graph replacement remains transactional. Validation or model failures before replacement leave the previously persisted graph and campaign status intact.

Campaigns imported before the Milestone 0 cache migration have page text and a canonical graph, but not the raw candidate payloads needed for this replay. In particular, the existing `Test 2` baseline cannot be fully replayed without another extraction and must not be regenerated merely to create a cache.

Run the cheapest end-to-end Milestone 0 smoke test against the configured Supabase project with:

```bash
npm run smoke:replay
```

This test makes no OpenAI request and reads no PDF. It creates a uniquely named temporary campaign with deterministic page and candidate data, persists raw and validated extraction cache rows, replays the cached graph, verifies entities, relationships, sources, diagnostics, and zero model calls, then deletes the temporary campaign and all cascading rows. It never touches an existing campaign or Storage object.

## Processing and debugging

`processCampaign(campaignId)` owns the orchestration. Chunk extraction is limited to `AI_EXTRACTION_CONCURRENCY` concurrent calls. Any chunk/model/persistence failure marks the campaign failed; failed chunks are never silently skipped. Retrying replaces the prior graph instead of appending duplicates.

For debugging, inspect:

- `campaigns.processing_stage`, `error_message`, and `processing_diagnostics`
- `processing_runs` for stage counts and failures
- `extraction_cache_chunks` for raw/validated candidates, validation diagnostics, model, response ID, and per-call token/cost data
- `reconciliation_cache_results` for cached decisions and reconciliation call usage
- `entities.reconciliation_metadata` for originating candidate IDs and merge reason
- `relationships.resolution_metadata` for candidate relationship IDs
- `document_pages`, entity sources, and relationship sources for page-level evidence

The application intentionally avoids logging API keys, service-role keys, or full campaign documents.

Model diagnostics record the stage, actual response model, API call count, input tokens, cached input tokens, cache-write tokens, output tokens, total tokens, and estimated standard-tier USD cost. Cost estimates use a small explicit table of official rates for known models; an unknown configured model records full token usage with a `null` estimate rather than guessing. Actual billing can vary by service tier and pricing changes.

## Known limitations

See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md) for limitations confirmed during implementation and local fixture testing. A credentialed Supabase + OpenAI import should be the first environment-specific acceptance test.
