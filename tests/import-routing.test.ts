import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCampaigns: vi.fn(), uploadsAllowed: vi.fn() }));

vi.mock("@/lib/db/queries", () => ({ getCampaigns: mocks.getCampaigns }));
vi.mock("@/lib/campaign-upload-access", () => ({ areCampaignUploadsAllowed: mocks.uploadsAllowed }));

import HomePage from "@/app/page";
import ImportPage from "@/app/import/page";

describe("import routing", () => {
  beforeEach(() => {
    mocks.getCampaigns.mockReset();
    mocks.uploadsAllowed.mockReset();
    mocks.uploadsAllowed.mockReturnValue(true);
  });

  it("keeps a populated homepage focused on the campaign library", async () => {
    mocks.getCampaigns.mockResolvedValue([{ id: "campaign-1", name: "The Long Road", status: "complete", error_message: null, processing_stage: null, created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z", entityCount: 12 }]);

    const page = renderToStaticMarkup(await HomePage());

    expect(page).toContain("The Long Road");
    expect(page).not.toContain('id="import"');
    expect(page).not.toContain("target:block");
  });

  it("keeps first-campaign onboarding on the homepage", async () => {
    mocks.getCampaigns.mockResolvedValue([]);

    const page = renderToStaticMarkup(await HomePage());

    expect(page).toContain("Import your first campaign");
    expect(page).toContain("Campaign name");
    expect(page).toContain("Campaign PDF");
  });

  it("shows the shared form and returned error on the dedicated import page", async () => {
    const page = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({ error: "Please upload a PDF." }) }));

    expect(page).toContain("Import campaign");
    expect(page).toContain("Campaign name");
    expect(page).toContain("Campaign PDF");
    expect(page).toContain("Create campaign wiki");
    expect(page).toContain('role="alert"');
    expect(page).toContain("Please upload a PDF.");
    expect(page).toContain("Back to campaign library");
  });

  it("shows the existing read-only state on the import page", async () => {
    mocks.uploadsAllowed.mockReturnValue(false);

    const page = renderToStaticMarkup(await ImportPage({ searchParams: Promise.resolve({}) }));

    expect(page).toContain("This deployment is read-only.");
    expect(page).not.toContain("Create campaign wiki");
  });
});
