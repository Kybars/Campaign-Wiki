import { SiteHeader } from "@/components/site-header";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("global site header", () => {
  it("keeps the brand, version, and import action without redundant navigation links", () => {
    const header = renderToStaticMarkup(createElement(SiteHeader));

    expect(header).toContain('href="/"');
    expect(header).toContain("Campaign Wiki");
    expect(header).toMatch(/aria-label="Campaign Wiki version [^"]+\. View changelog\."/);
    expect(header).toContain('href="/import"');
    expect(header).toContain("Import campaign");
    expect(header).not.toContain(">Home</a>");
    expect(header).not.toContain(">Campaigns</a>");
  });
});
