import packageMetadata from "@/package.json";
import ChangelogPage from "@/app/changelog/page";
import { VersionLink } from "@/components/version-link";
import { CHANGELOG_PATH, changelog, currentChangelog, currentVersion, isNewestFirst, type ChangelogEntry } from "@/lib/changelog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLAIMS_4_1_RECONCILIATION_V2_2_4_VERSION } from "@/lib/ai/claims-4-1-reconciliation-v2-2-4";
import { CLAIMS_4_1_RECONCILIATION_V2_3_0_VERSION } from "@/lib/ai/claims-4-1-reconciliation-v2-3-0";

import { CLAIMS_4_1_RECONCILIATION_V2_3_1_VERSION } from "@/lib/ai/claims-4-1-reconciliation-v2-3-1";
import { CLAIMS_4_1_RECONCILIATION_V2_3_2_VERSION } from "@/lib/ai/claims-4-1-reconciliation-v2-3-2";

describe("changelog", () => {
  it("matches the current release to the package version", () => {
    expect(currentVersion).toBe("0.6.13");
    expect(currentChangelog.version).toBe("0.6.13");
    expect(currentChangelog.date).toBe("2026-10-06");
    expect(currentVersion).toBe(packageMetadata.version);
    expect(changelog[0].version).toBe(packageMetadata.version);
    expect(currentChangelog).toBe(changelog[0]);
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.version).toBe(packageMetadata.version);
    expect(lock.packages[""].version).toBe(packageMetadata.version);
    expect(CLAIMS_4_1_RECONCILIATION_V2_2_4_VERSION).toBe("claims-4-1-reconciliation-2.2.4");
    expect(CLAIMS_4_1_RECONCILIATION_V2_3_0_VERSION).toBe("claims-4-1-reconciliation-2.3.0");
    expect(CLAIMS_4_1_RECONCILIATION_V2_3_1_VERSION).toBe("claims-4-1-reconciliation-2.3.1");
    expect(CLAIMS_4_1_RECONCILIATION_V2_3_2_VERSION).toBe("claims-4-1-reconciliation-2.3.2");
  });

  it("keeps releases newest first with unique versions", () => {
    expect(new Set(changelog.map((release) => release.version)).size).toBe(changelog.length);
    expect(isNewestFirst(changelog)).toBe(true);
  });

  it("includes complete summaries and details for every release from 0.6.7 through 0.6.13", () => {
    const versions = ["0.6.13", "0.6.12", "0.6.11", "0.6.10", "0.6.9", "0.6.8", "0.6.7"];
    expect(changelog.slice(0, versions.length).map(release => release.version)).toEqual(versions);
    for (const version of versions) {
      const entries: readonly ChangelogEntry[] = changelog.filter(release => release.version === version);
      expect(entries).toHaveLength(1);
      expect(entries[0].title.trim().length).toBeGreaterThan(0);
      expect(entries[0].summary?.trim().length).toBeGreaterThan(0);
      expect(entries[0].changes.length).toBeGreaterThan(0);
      expect(entries[0].changes.every(change => change.trim().length > 0)).toBe(true);
      expect(entries[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("records each implemented v0.3 milestone release", () => {
    expect(changelog.filter((release) => release.version.startsWith("0.3.")).map((release) => release.version)).toEqual([
      "0.3.10", "0.3.9", "0.3.8", "0.3.7", "0.3.6", "0.3.5", "0.3.4", "0.3.3", "0.3.2", "0.3.1", "0.3.0",
    ]);
  });

  it("supplies a complete current-release preview and changelog route", () => {
    expect(CHANGELOG_PATH).toBe("/changelog");
    expect(currentChangelog.title).not.toHaveLength(0);
    expect(currentChangelog.changes.length).toBeGreaterThan(0);
    expect(currentChangelog.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("preserves the historical release entries", () => {
    expect(changelog.map((release) => release.version)).toEqual(expect.arrayContaining([
      "0.4.0",
      "0.5.0",
      "0.5.3",
      "0.6.0",
      "0.6.1",
      "0.6.8",
    ]));
  });

  it("retains the complete historical 0.6.8 entry after the new release", () => {
    expect(changelog.find(entry => entry.version === "0.6.8")).toEqual({
      version: "0.6.8",
      date: "2026-10-01",
      title: "Claims-4.1 extraction research checkpoint",
      summary: "Established the Claims-4.1 extraction architecture with fine-grained propositions, source-grounded participants and evidence, and frozen WotBS/Sweetwater extraction checkpoints.",
      changes: [
        "Checkpointed the separate Claims-4/4.1 research line, with fine-grained propositions, source-grounded participants and evidence, and full raw-proposal retention.",
        "Recorded the frozen 106-proposal WotBS and 148-proposal Sweetwater extraction runs and deterministic reconciliation v2/v2.1/v2.2 source, tests, and offline replay tools.",
        "Reconciliation v2.2 remains under semantic audit; production extraction, wiki persistence, and the database path are unchanged. Private sources and generated artifacts remain local-only.",
      ],
    });
  });

  it("renders the current badge as a changelog link with a focusable preview", () => {
    const badge = renderToStaticMarkup(createElement(VersionLink));
    expect(badge).toContain(`href="${CHANGELOG_PATH}"`);
    expect(badge).toContain('role="tooltip"');
    expect(badge).toContain(">v0.6.13</a>");
    expect(badge).toContain(currentChangelog.title);
    expect(badge).toContain(currentChangelog.summary);
    expect(badge).toContain('aria-describedby="current-release-preview"');
    expect(badge).toContain('id="current-release-preview"');
    for (const change of currentChangelog.changes) expect(badge).toContain(change);
    expect(badge).toContain("group-focus-within:visible");
    expect(badge).not.toContain("fixed");
  });

  it("renders the changelog in the declared newest-first order", () => {
    const page = renderToStaticMarkup(createElement(ChangelogPage));
    let previousIndex = -1;
    for (const release of changelog) {
      const currentIndex = page.indexOf(`>v${release.version}</h2>`);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it("renders summaries between release titles and detailed bullets", () => {
    const page = renderToStaticMarkup(createElement(ChangelogPage));
    for (const release of changelog as readonly ChangelogEntry[]) {
      if (!release.summary) continue;
      const titleIndex = page.indexOf(release.title);
      const summaryIndex = page.indexOf(release.summary);
      const detailsIndex = page.indexOf(release.changes[0]);
      expect(summaryIndex).toBeGreaterThan(titleIndex);
      expect(detailsIndex).toBeGreaterThan(summaryIndex);
      expect(page).toContain(`text-[var(--ink)]">${release.summary}</p>`);
    }
  });

  it("keeps the title and bullet layout for historical releases without summaries", () => {
    const page = renderToStaticMarkup(createElement(ChangelogPage));
    const historical = changelog.slice(7) as readonly ChangelogEntry[];
    expect(historical[0].version).toBe("0.6.6");
    for (const release of historical) {
      expect(release.summary).toBeUndefined();
      const section = page.split(`>v${release.version}</h2>`)[1].split('</ul>')[0];
      expect(section).toContain(release.title);
      expect(section).not.toContain('text-[var(--ink)]');
      for (const change of release.changes) expect(section).toContain(change);
    }
  });
});
