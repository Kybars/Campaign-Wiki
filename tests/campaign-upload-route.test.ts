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
      "https://campaign-wiki.example/?error=Campaign+uploads+are+disabled+on+this+deployment.",
    );
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.extractPdfPages).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});
