import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  extractPdfPages: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/pdf/extract-text", () => ({
  extractPdfPages: mocks.extractPdfPages,
  PdfExtractionError: class PdfExtractionError extends Error {},
}));

import { POST } from "@/app/api/campaigns/route";

describe("disabled campaign upload route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects before parsing the request or creating campaign data", async () => {
    vi.stubEnv("ALLOW_CAMPAIGN_UPLOADS", "false");
    const formData = vi.fn();
    const request = {
      url: "https://campaign-wiki.example/api/campaigns",
      formData,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://campaign-wiki.example/import?error=Campaign+uploads+are+disabled+on+this+deployment.",
    );
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.extractPdfPages).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("returns validation errors to the import workflow", async () => {
    vi.stubEnv("ALLOW_CAMPAIGN_UPLOADS", "true");
    const formData = vi.fn().mockResolvedValue(new FormData());
    const request = {
      url: "https://campaign-wiki.example/api/campaigns",
      formData,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://campaign-wiki.example/import?error=Enter+a+campaign+name.");
    expect(mocks.extractPdfPages).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("keeps successful uploads directed to the campaign processing page", async () => {
    vi.stubEnv("ALLOW_CAMPAIGN_UPLOADS", "true");
    mocks.extractPdfPages.mockResolvedValue([{ pageNumber: 1, text: "Campaign text" }]);
    mocks.createAdminClient.mockReturnValue({
      from: (table: string) => table === "campaigns"
        ? {
            insert: () => ({ select: () => ({ single: async () => ({ error: null }) }) }),
            update: () => ({ eq: async () => ({ error: null }) }),
          }
        : { insert: async () => ({ error: null }) },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
    });
    const formData = new FormData();
    formData.set("name", "The Long Road");
    formData.set("pdf", new File(["%PDF-test"], "campaign.pdf", { type: "application/pdf" }));
    const request = {
      url: "https://campaign-wiki.example/api/campaigns",
      formData: async () => formData,
    } as unknown as Request;

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toMatch(/^https:\/\/campaign-wiki\.example\/campaigns\/[0-9a-f-]+\/processing$/);
  });
});
