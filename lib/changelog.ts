export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  summary?: string;
  changes: readonly string[];
}

export const CHANGELOG_PATH = "/changelog";

export const changelog = [
  {
    version: "0.6.13",
    date: "2026-10-06",
    title: "PDF model-text decontamination",
    summary: "Improved PDF model-text cleaning to remove interleaved page furniture, watermarks, page ornaments and duplicate overlays while preserving exact raw source provenance.",
    changes: [
      "Improved PDF model-text decontamination for interleaved page furniture, recurring purchaser watermarks, page ornaments and exact duplicate overlay fragments.",
      "Raw source and provenance remain unchanged; removal diagnostics preserve raw offsets and reasons, and model evidence never joins across removed layers.",
      "Claims-4.1 and reconciliation 2.3.2 remain frozen. Prepared three small Claims-only Tales regression requests without executing them; zero model/API calls in this release.",
    ],
  },
  {
    version: "0.6.12",
    date: "2026-10-06",
    title: "Source-form participant references",
    summary: "Added source-form generic participant handling and bounded structural coreference in reconciliation v2.3.2.",
    changes: [
      "Added source-form generic participant handling based on source determiners, quantity, plurality and common-noun usage, with inventory and explicit-designation safeguards.",
      "Added bounded structural/source coreference backed by explicit proposition anchors; headings alone never choose an identity and conservative inventory ambiguity is preserved.",
      "Claims-4.1 extraction remains frozen. Preserved all 1,891 Tales proposals, previous reconciliation versions and mechanics; zero new model extraction was performed and zero model/API calls were made.",
    ],
  },
  {
    version: "0.6.11",
    date: "2026-10-06",
    title: "Source-backed inventory ambiguity correction",
    summary: "Added source-backed claim-local resolution for ambiguous inventory identities and reconciliation v2.3.1.",
    changes: [
      "Corrected over-conservative cross-type inventory ambiguity handling in reconciliation v2.3.1 with source-backed claim-local disambiguation of existing identities.",
      "Added narrowly proven specific-type/fallback normalization with source records, original IDs and merge reasons; retained distinct identities when source proof is insufficient.",
      "Fixed offline replay parity with production structured evidence units passed into inventory normalization.",
      "Claims-4.1 prompt/schema remain frozen. Preserved all 1,891 Tales proposals and historical v2.2.4/v2.3.0 behavior; zero new model extraction was performed and zero model/API calls were made.",
    ],
  },
  {
    version: "0.6.10",
    date: "2026-10-05",
    title: "Full-document reconciliation hardening",
    summary: "Hardened full-document reconciliation with source structure, rumor and relative-timeline context, conservative inventory normalization and reconciliation v2.3.0.",
    changes: [
      "Improved generic source structure and context, including heading paths, running furniture suppression, bounded statblocks, rumors and relative scheduled Timeline associations.",
      "Added conservative document-global inventory normalization with aliases, original IDs and source-backed merge provenance.",
      "Introduced reconciliation v2.3.0 with conservative inventory ambiguity handling, stable candidate identity reuse and generic-participant classification; retained v2.2.4 and existing mechanics semantics.",
      "Validated offline against the frozen full Tales acceptance extraction, preserving all 1,891 raw Claims proposals. Claims-4.1 extraction prompt/schema remain frozen; no new model extraction was performed for this replay.",
    ],
  },
  {
    version: "0.6.9",
    date: "2026-10-04",
    title: "Claims reconciliation v2.2.4 and full-document pipeline",
    summary: "Connected the production PDF and inventory pipeline to Claims-4.1 and added document-wide proposal union and reconciliation v2.2.4.",
    changes: [
      "Checkpointed reconciliation v2.2.4, frozen after the WotBS/Sweetwater semantic audit: identity-relation metadata stays on its source claim while preserving one document-level identity relation.",
      "Bounded context evidence to what resolution needs, improved source-established descriptor continuation conservatively, and preserved source discrepancies proposition-by-proposition in GM Review. Retained candidate entities, many-to-many claim associations, Campaign Timeline associations, and mechanical-only disposition.",
      "Connected production PDF cleaning, page chunking, inventory extraction, and inventory completeness to Claims-4.1 with generic evidence construction and bounded request packing. Unioned request-level proposals into one document-wide stream for one v2.2.4 reconciliation, producing a Claims-native backend artifact for later wiki visualization instead of CanonicalGraph.",
      "Prepared the complete Tales PDF offline/preflight path with all upcoming acceptance-run AI stages constrained to gpt-6-luna. Live full-document Tales extraction has not run; production database persistence and frontend integration remain unchanged.",
      "Next: source-vs-output DM/player table-usability validation, followed by Claims-native visualization if successful. The 400-proposal extraction limit applies per model response; document unions validate every proposal without that ceiling.",
    ],
  },
  {
    version: "0.6.8",
    date: "2026-10-01",
    title: "Claims-4.1 extraction research checkpoint",
    summary: "Established the Claims-4.1 extraction architecture with fine-grained propositions, source-grounded participants and evidence, and frozen WotBS/Sweetwater extraction checkpoints.",
    changes: [
      "Checkpointed the separate Claims-4/4.1 research line, with fine-grained propositions, source-grounded participants and evidence, and full raw-proposal retention.",
      "Recorded the frozen 106-proposal WotBS and 148-proposal Sweetwater extraction runs and deterministic reconciliation v2/v2.1/v2.2 source, tests, and offline replay tools.",
      "Reconciliation v2.2 remains under semantic audit; production extraction, wiki persistence, and the database path are unchanged. Private sources and generated artifacts remain local-only.",
    ],
  },
  {
    version: "0.6.7",
    date: "2026-09-28",
    title: "Claims-2 development checkpoint",
    summary: "Introduced Claims-2 development experiments for granular source-backed facts, completeness testing, bounded budgets and citation auditing.",
    changes: [
      "Added isolated Claims-2 and completeness experiments with source-backed participant validation, bounded run budgets, and Test 9/10/11 development runners.",
      "Recorded narrative extraction and citation audits, including the stopped acceptance test and known context limits.",
      "Kept Claims experiments outside normal wiki uploads; the end-to-end browser upload test remains pending.",
    ],
  },
  {
    version: "0.6.6",
    date: "2026-09-23",
    title: "Graph extraction research checkpoint",
    changes: [
      "Recorded V3, two-chunk, and completeness graph extraction experiments with bounded source and endpoint validation.",
      "Hardened semantic page cleaning, focused graph windows, and evaluator scoring without changing production model defaults.",
    ],
  },
  {
    version: "0.6.5",
    date: "2026-09-22",
    title: "Granular import progress",
    changes: [
      "Added deterministic work-unit progress across campaign import stages.",
      "Import progress now survives refresh and retry while reflecting reused processing checkpoints.",
    ],
  },
  {
    version: "0.6.4",
    date: "2026-09-22",
    title: "Semantic coverage recovery",
    changes: [
      "Made occurrence and prominence scans consistently use boilerplate-masked semantic text, including callers that provide raw document pages.",
      "Split overloaded adaptive-recovery windows into bounded target batches so every suspicious multi-page zero-degree entity is considered.",
    ],
  },
  {
    version: "0.6.3",
    date: "2026-09-20",
    title: "Bounded entity reconciliation",
    changes: [
      "Split duplicate-entity adjudication into bounded deterministic batches to prevent large campaigns from producing oversized reconciliation requests.",
      "Added batch-level checkpointing and regression coverage for complete, non-overlapping candidate-pair adjudication.",
    ],
  },
  {
    version: "0.6.2",
    date: "2026-09-20",
    title: "Append-only release history",
    changes: [
      "Restored missing historical release entries and made changelog versions explicit instead of deriving release identity from the package version.",
      "Added regression coverage so future package-version bumps cannot silently overwrite prior changelog history.",
    ],
  },
  {
    version: "0.6.1",
    date: "2026-09-20",
    title: "Graph pipeline hardening",
    changes: [
      "Graph pipeline hardening: authoritative entity merge application, semantic-text coverage, model-driven relationship reconciliation, and bounded adaptive gap recovery.",
      "Preserved exact raw-source provenance while excluding recurring page boilerplate from semantic extraction, mentions, prominence, and coverage.",
      "Added versioned audit traces for pair-level merge conflicts, relationship validation and semantic reconciliation, adaptive gaps, final dedupe, and provenance union.",
    ],
  },
  {
    version: "0.6.0",
    date: "2026-09-19",
    title: "Lean graph correctness",
    changes: [
      "Reconciled explicit NPC same-person relationships before duplicate adjudication and expanded conservative polity duplicate candidacy.",
      "Unified exact source-occurrence provenance with deterministic prominence and preserved inventory-derived evidence.",
      "Added conservative canonical display capitalization and safe relationship grammar deduplication.",
    ],
  },
  {
    version: "0.5.3",
    date: "2026-09-18",
    title: "Import workflow and interface refinements",
    changes: [
      "Added a dedicated campaign import page, returned upload errors to the import form, and kept first-campaign onboarding on the homepage.",
      "Improved connection visibility controls and relationship presentation for more reliable campaign curation.",
      "Refined campaign overview layout and information density for easier scanning.",
    ],
  },
  {
    version: "0.5.2",
    date: "2026-09-17",
    title: "Campaign organization and Player View safety",
    changes: [
      "Added deterministic imported prominence and quest-status defaults while preserving durable GM overrides across replay.",
      "Reworked campaign browsing into responsive organization boards with compact curation controls and a sidebar/mobile campaign navigator.",
      "Closed Player View stale-list and relationship-evidence leaks, and added compact connected-entity visibility curation from Connections.",
    ],
  },
  {
    version: "0.5.1",
    date: "2026-09-16",
    title: "Durable GM curation",
    changes: [
      "Added replay-safe entity type, prominence, visibility, quest status, and relationship visibility controls without changing extraction behavior.",
      "Reworked category and entity pages around accessible GM organization, fail-closed Player View navigation, source evidence, and grouped relationship presentation.",
      "Made the campaign library the homepage focus once campaigns exist while retaining focused first-run onboarding.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-09-16",
    title: "Main-site redesign",
    changes: [
      "Redesigned the home experience around a clear campaign library, campaign status, and an obvious import path.",
      "Added a responsive product shell and dedicated campaign-library route while preserving existing campaign, processing, and DM/Player views.",
    ],
  },
  {
    version: "0.4.9",
    date: "2026-09-14",
    title: "Compact two-pass source extraction",
    changes: [
      "Separated compact entity inventory from rich fact and relationship extraction so validated entity breadth cannot be silently removed.",
      "Added independently durable substage checkpoints, model overrides, planning, workload diagnostics, and a frozen local Ollama re-benchmark.",
      "Reduced Pass A to source-grounded identity fields, assigned stable chunk-local IDs in application code, and moved alias discovery to inventory-grounded Pass B.",
    ],
  },
  {
    version: "0.4.8",
    date: "2026-09-13",
    title: "Recall audit and local extraction baseline",
    changes: [
      "Audited Test 2 and Test 3 entity recall with a complete deterministic crosswalk and controlled Luna/Terra comparison.",
      "Froze the qwen3.5:9b single-pass Ollama failure baseline and its isolated stress/variance harness.",
    ],
  },
  {
    version: "0.4.7",
    date: "2026-09-12",
    title: "Derived lean recovery",
    changes: [
      "Added an explicit, server-only command for creating a new lean campaign from validated cached extraction and reconciliation.",
      "Preserved source-campaign history while copying source provenance and recording zero-call recovery lineage.",
    ],
  },
  {
    version: "0.4.6",
    date: "2026-09-12",
    title: "Failure and paid-call guards",
    changes: [
      "Added deterministic corrupt-checkpoint recovery and OpenAI application-attempt budget coverage.",
      "Added server-side recovery planning and runtime enforcement for configurable OpenAI call ceilings.",
    ],
  },
  {
    version: "0.4.5",
    date: "2026-09-11",
    title: "Durable AI operation checkpoints",
    changes: [
      "Persisted validated extraction, reconciliation, and full-enrichment operations before dependent work continues.",
      "Added exact provider/input/version identity, interruption-safe reuse, and zero-call resume planning.",
    ],
  },
  {
    version: "0.4.4",
    date: "2026-09-11",
    title: "Local core processing providers",
    changes: [
      "Extended the structured-model provider to extraction and reconciliation without weakening validation.",
      "Added stage-specific local models, three-stage preflight, fixture smoke, and extraction workload diagnostics.",
    ],
  },
  {
    version: "0.4.3",
    date: "2026-09-11",
    title: "Lean default campaign processing",
    changes: [
      "Made source-backed canonical wiki generation complete without mandatory post-reconciliation enrichment.",
      "Added explicit lean/full processing modes, safe Player defaults, and zero-call cached recovery diagnostics.",
    ],
  },
  {
    version: "0.4.2",
    date: "2026-09-11",
    title: "Lean processing decision",
    changes: [
      "Evaluated enrichment value and cost and defined the lean processing target for v0.4.",
      "Added a zero-model-call Test 3 workload measurement command.",
    ],
  },
  {
    version: "0.4.1",
    date: "2026-09-11",
    title: "Local AI persistence safety",
    changes: [
      "Requires explicit acknowledgement before local enrichment can replace canonical campaign data.",
      "Makes local preflight distinguish confirmed model availability from endpoints that do not report models.",
    ],
  },
  {
    version: "0.4.0",
    date: "2026-09-10",
    title: "Local AI development provider",
    changes: [
      "Added a provider-independent structured AI boundary with local model support.",
      "Added provider preflight and provider-aware recovery diagnostics.",
    ],
  },
  {
    version: "0.3.10",
    date: "2026-09-10",
    title: "Enrichment evidence validation",
    changes: [
      "Enforced owner-scoped evidence validation before later enrichment stages.",
      "Prevented cross-entity evidence citations in classifications and summaries.",
    ],
  },
  {
    version: "0.3.9",
    date: "2026-09-10",
    title: "Enrichment recovery reliability",
    changes: [
      "Made large-campaign knowledge classification reliable with bounded, verified batches.",
      "Added safe cached enrichment recovery for failed imports.",
    ],
  },
  {
    version: "0.3.8",
    date: "2026-09-10",
    title: "Regression and replay readiness",
    changes: [
      "Expanded deterministic regression coverage and replay diagnostics ahead of the next campaign benchmark.",
    ],
  },
  {
    version: "0.3.7",
    date: "2026-09-10",
    title: "Campaign overviews, Quests, and Event chronology",
    changes: [
      "Added source-backed GM and Player campaign overviews.",
      "Made Quest pages faster reference guides and Events easier to browse by supported chronology.",
    ],
  },
  {
    version: "0.3.6",
    date: "2026-09-09",
    title: "Prominence-aware campaign browsing",
    changes: [
      "Added sticky campaign navigation and integrated campaign search.",
      "Refined the campaign home and category pages around the most prominent entries.",
    ],
  },
  {
    version: "0.3.5",
    date: "2026-09-09",
    title: "Campaign discovery navigation",
    changes: [
      "Added integrated campaign search and clearer category browsing.",
      "Improved campaign discovery across the homepage and navigation.",
    ],
  },
  {
    version: "0.3.4",
    date: "2026-09-09",
    title: "Rich entity articles",
    changes: [
      "Added type-specific campaign articles with natural connections and entity previews.",
      "Made supporting citations and evidence easier to inspect.",
    ],
  },
  {
    version: "0.3.3",
    date: "2026-09-09",
    title: "Player View preview",
    changes: [
      "Added a centralized Player and DM read model.",
      "Added a Player View preview for checking player-safe campaign knowledge.",
    ],
  },
  {
    version: "0.3.2",
    date: "2026-09-08",
    title: "Campaign knowledge enrichment",
    changes: [
      "Classified campaign knowledge by prominence and GM or Player visibility.",
      "Added campaign overviews and richer, audience-appropriate summaries.",
    ],
  },
  {
    version: "0.3.1",
    date: "2026-09-08",
    title: "Richer source-backed campaign details",
    changes: [
      "Campaign extraction now captures richer source-backed details for characters, places, deities, factions, items, quests, and events.",
    ],
  },
  {
    version: "0.3.0",
    date: "2026-09-08",
    title: "Data and provenance foundation",
    changes: [
      "Prepared campaign data for richer source-backed articles and future player-safe views.",
    ],
  },
  {
    version: "0.2.9",
    date: "2026-09-07",
    title: "Regression and replay validation",
    changes: [
      "Expanded campaign-data regression coverage.",
      "Added deterministic replay evaluation and consistency metrics.",
    ],
  },
  {
    version: "0.2.8",
    date: "2026-09-07",
    title: "Location browsing and navigation",
    changes: [
      "Added hierarchical location browsing with expandable branches.",
      "Added location breadcrumbs, sublocations, and full category navigation.",
    ],
  },
  {
    version: "0.2.7",
    date: "2026-09-07",
    title: "Compact entity pages",
    changes: [
      "Made entity pages denser with prose-style connections.",
      "Added compact, expandable source references and summaries.",
    ],
  },
  {
    version: "0.2.6",
    date: "2026-09-07",
    title: "Versioning and changelog",
    changes: [
      "Added a site-wide changelog and release preview.",
      "Made the version badge a direct link to release notes.",
    ],
  },
  {
    version: "0.2.5",
    date: "2026-09-07",
    title: "Recursive location hierarchy",
    changes: [
      "Added source-backed, cycle-safe location containment.",
      "Added location paths, children, ancestors, and descendants.",
    ],
  },
  {
    version: "0.2.4",
    date: "2026-09-07",
    title: "Relationship normalization",
    changes: [
      "Normalized known inverse relationships into one logical fact.",
      "Preserved source evidence while removing duplicate relationship views.",
    ],
  },
  {
    version: "0.2.3",
    date: "2026-09-06",
    title: "Cross-type reconciliation",
    changes: [
      "Allowed supported entity matches across different candidate types.",
      "Kept uncertain and similarly named entities separate.",
    ],
  },
  {
    version: "0.2.2",
    date: "2026-09-06",
    title: "Deities and enemy roles",
    changes: [
      "Added deities as an entity type and enemies as a reusable role.",
      "Added Deities and Enemies to campaign navigation and search.",
    ],
  },
  {
    version: "0.2.1",
    date: "2026-09-06",
    title: "Replay smoke coverage",
    changes: [
      "Added a cost-free smoke test for replaying cached campaign data.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-06",
    title: "Application version display",
    changes: [
      "Added the Campaign Wiki version badge.",
    ],
  },
] as const satisfies readonly ChangelogEntry[];

export const currentChangelog = changelog[0];
export const currentVersion = currentChangelog.version;

export function isNewestFirst(entries: readonly ChangelogEntry[]) {
  return entries.every((entry, index) => {
    if (index === 0) return true;
    const previousParts = entries[index - 1].version.split(".").map(Number);
    const currentParts = entry.version.split(".").map(Number);
    for (let partIndex = 0; partIndex < Math.max(previousParts.length, currentParts.length); partIndex += 1) {
      const difference = (previousParts[partIndex] ?? 0) - (currentParts[partIndex] ?? 0);
      if (difference !== 0) return difference > 0;
    }
    return false;
  });
}
