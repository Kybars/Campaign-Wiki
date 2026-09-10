import packageMetadata from "@/package.json";
import ChangelogPage from "@/app/changelog/page";
import { VersionLink } from "@/components/version-link";
import { CHANGELOG_PATH, changelog, currentChangelog, currentVersion, isNewestFirst } from "@/lib/changelog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("changelog", () => {
  it("derives the current release from the package version", () => {
    expect(currentVersion).toBe(packageMetadata.version);
    expect(currentChangelog).toBe(changelog[0]);
  });

  it("keeps releases newest first with unique versions", () => {
    expect(new Set(changelog.map((release) => release.version)).size).toBe(changelog.length);
    expect(isNewestFirst(changelog)).toBe(true);
  });

  it("records each implemented v0.3 milestone release", () => {
    expect(changelog.slice(1, 6).map((release) => release.version)).toEqual(["0.3.6", "0.3.5", "0.3.4", "0.3.3", "0.3.2"]);
  });

  it("supplies a complete current-release preview and changelog route", () => {
    expect(CHANGELOG_PATH).toBe("/changelog");
    expect(currentChangelog.title).not.toHaveLength(0);
    expect(currentChangelog.changes.length).toBeGreaterThan(0);
    expect(currentChangelog.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
      const currentIndex = page.indexOf(`v${release.version}`);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });
});
