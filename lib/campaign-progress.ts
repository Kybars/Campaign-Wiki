export type CampaignProgress = {
  label: string;
  value: number;
};

const progressByStatus: Record<string, CampaignProgress> = {
  uploaded: { label: "Preparing campaign", value: 8 },
  extracting_pages: { label: "Reading campaign", value: 16 },
  extracting_candidates: { label: "Finding campaign information", value: 45 },
  reconciling: { label: "Connecting campaign", value: 78 },
  persisting: { label: "Building wiki", value: 94 },
  complete: { label: "Campaign wiki ready", value: 100 },
  failed: { label: "Import paused", value: 0 },
};

export const processingMessages = [
  "Finding the people, places, and factions in your campaign…",
  "Checking for important details we may have missed…",
  "Connecting characters, locations, factions, and events…",
  "Following the threads between the pieces of your campaign…",
  "Large campaign guides can take a few minutes. Still working…",
  "Preparing the campaign wiki for browsing…",
] as const;

export function campaignProgress(status: string, stage: string | null): CampaignProgress {
  if (status === "failed") return progressByStatus.failed;
  if (status === "complete") return progressByStatus.complete;
  const stageText = stage?.toLocaleLowerCase("en-US") ?? "";
  if (stageText.includes("relationship") || stageText.includes("connecting")) return progressByStatus.reconciling;
  if (stageText.includes("building wiki")) return progressByStatus.persisting;
  return progressByStatus[status] ?? progressByStatus.uploaded;
}

export function keepProgressMonotonic(current: number, next: number, status: string) {
  if (status === "complete") return 100;
  if (status === "failed") return current;
  return Math.max(current, next);
}

export function isCampaignProcessingActive(status: string) {
  return status !== "complete" && status !== "failed";
}
