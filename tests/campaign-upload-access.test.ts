import { describe, expect, it } from "vitest";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";

describe("campaign upload access", () => {
  it("allows uploads when explicitly enabled", () => {
    expect(areCampaignUploadsAllowed({ ALLOW_CAMPAIGN_UPLOADS: "TrUe" })).toBe(true);
  });

  it("blocks uploads when explicitly disabled", () => {
    expect(areCampaignUploadsAllowed({ ALLOW_CAMPAIGN_UPLOADS: "false" })).toBe(false);
  });

  it("blocks uploads on Vercel when no override is defined", () => {
    expect(areCampaignUploadsAllowed({ VERCEL: "1" })).toBe(false);
  });

  it("allows uploads locally when no override is defined", () => {
    expect(areCampaignUploadsAllowed({})).toBe(true);
  });

  it("rejects invalid explicit values", () => {
    expect(() => areCampaignUploadsAllowed({ ALLOW_CAMPAIGN_UPLOADS: "yes" }))
      .toThrow('Invalid ALLOW_CAMPAIGN_UPLOADS configuration. Expected "true" or "false".');
  });
});
