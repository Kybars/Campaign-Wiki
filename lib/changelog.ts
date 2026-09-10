import packageMetadata from "@/package.json";

export interface ChangelogEntry {
  version: string;
  date: string;
  title: string;
  changes: readonly string[];
}

export const CHANGELOG_PATH = "/changelog";

export const changelog = [
  {
    version: packageMetadata.version,
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
