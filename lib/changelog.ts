export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: readonly string[];
}

export const CHANGELOG_PATH = "/changelog";

export const changelog = [
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
