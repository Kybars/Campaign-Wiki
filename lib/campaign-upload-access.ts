type CampaignUploadEnvironment = {
  ALLOW_CAMPAIGN_UPLOADS?: string;
  VERCEL?: string;
};

export function areCampaignUploadsAllowed(
  environment: CampaignUploadEnvironment = {
    ALLOW_CAMPAIGN_UPLOADS: process.env.ALLOW_CAMPAIGN_UPLOADS,
    VERCEL: process.env.VERCEL,
  },
): boolean {
  const explicitValue = environment.ALLOW_CAMPAIGN_UPLOADS;

  if (explicitValue !== undefined) {
    const normalizedValue = explicitValue.trim().toLocaleLowerCase("en-US");
    if (normalizedValue === "true") return true;
    if (normalizedValue === "false") return false;
    throw new Error('Invalid ALLOW_CAMPAIGN_UPLOADS configuration. Expected "true" or "false".');
  }

  return environment.VERCEL !== "1";
}
