import packageMetadata from "@/package.json";
import ChangelogPage from "@/app/changelog/page";
import { VersionLink } from "@/components/version-link";
import { CHANGELOG_PATH, changelog, currentChangelog, currentVersion, isNewestFirst } from "@/lib/changelog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CLAIMS_4_1_RECONCILIATION_V2_2_4_VERSION } from "@/lib/ai/claims-4-1-reconciliation-v2-2-4";
import { CLAIMS_4_1_RECONCILIATION_V2_3_0_VERSION } from "@/lib/ai/claims-4-1-reconciliation-v2-3-0";

describe("changelog", () => {
  it("matches the current release to the package version", () => {
    expect(currentVersion).toBe("0.6.10");
    expect(currentChangelog.version).toBe("0.6.10");
    expect(currentChangelog.date).toBe("2026-10-05");
    expect(currentVersion).toBe(packageMetadata.version);
    expect(changelog[0].version).toBe(packageMetadata.version);
    expect(currentChangelog).toBe(changelog[0]);
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
    expect(lock.version).toBe(packageMetadata.version);
    expect(lock.packages[""].version).toBe(packageMetadata.version);
    expect(CLAIMS_4_1_RECONCILIATION_V2_2_4_VERSION).toBe("claims-4-1-reconciliation-2.2.4");
    expect(CLAIMS_4_1_RECONCILIATION_V2_3_0_VERSION).toBe("claims-4-1-reconciliation-2.3.0");
  });

  it("keeps releases newest first with unique versions", () => {
    expect(new Set(changelog.map((release) => release.version)).size).toBe(changelog.length);
    expect(isNewestFirst(changelog)).toBe(true);
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
    expect(badge).toContain(`v${currentVersion}`);
    expect(badge).toContain(currentChangelog.title);
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
});
