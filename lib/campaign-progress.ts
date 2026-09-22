export type CampaignProgressPhase = "preparing" | "reading" | "finding_information" | "extracting_connections" | "matching_entities" | "checking_connections" | "tidying_connections" | "building_wiki" | "complete";

export type CampaignProgress = {
  phase: CampaignProgressPhase;
  completedUnits: number;
  totalUnits: number | null;
  unitType: string | null;
  percentage: number;
};

export type CampaignProgressDisplay = CampaignProgress & { label: string; detail: string | null };

const phases: Record<CampaignProgressPhase, { label: string; start: number; end: number }> = {
  preparing: { label: "Preparing campaign", start: 0, end: 5 },
  reading: { label: "Reading campaign", start: 5, end: 15 },
  finding_information: { label: "Finding campaign information", start: 15, end: 35 },
  extracting_connections: { label: "Extracting connections", start: 35, end: 50 },
  matching_entities: { label: "Matching duplicate entities", start: 50, end: 68 },
  checking_connections: { label: "Checking for missing connections", start: 68, end: 82 },
  tidying_connections: { label: "Tidying connections", start: 82, end: 94 },
  building_wiki: { label: "Building wiki", start: 94, end: 99 },
  complete: { label: "Campaign wiki ready", start: 100, end: 100 },
};

export const processingMessages = [
  "Working through your campaign material…",
  "Organizing the campaign details into a wiki…",
  "Following the connections in your campaign…",
] as const;

export function campaignProgress(phase: CampaignProgressPhase, completedUnits = 0, totalUnits: number | null = null, unitType: string | null = null, minimum = 0): CampaignProgress {
  const range = phases[phase];
  const measurable = totalUnits !== null && totalUnits > 0;
  const calculated = phase === "complete" ? 100 : measurable
    ? range.start + (Math.min(Math.max(completedUnits, 0), totalUnits) / totalUnits) * (range.end - range.start)
    : range.start;
  return { phase, completedUnits: Math.max(0, completedUnits), totalUnits: measurable ? totalUnits : null, unitType, percentage: phase === "complete" ? 100 : Math.max(minimum, Math.floor(calculated)) };
}

export function parseCampaignProgress(value: unknown, status?: string): CampaignProgress {
  if (status === "complete") return campaignProgress("complete");
  if (value && typeof value === "object") {
    const candidate = value as Partial<CampaignProgress>;
    if (candidate.phase && candidate.phase in phases) return campaignProgress(candidate.phase, Number(candidate.completedUnits) || 0, typeof candidate.totalUnits === "number" ? candidate.totalUnits : null, typeof candidate.unitType === "string" ? candidate.unitType : null, Number(candidate.percentage) || 0);
  }
  return campaignProgress(status === "extracting_pages" ? "reading" : "preparing");
}

export function campaignProgressDisplay(value: unknown, status?: string): CampaignProgressDisplay {
  const progress = parseCampaignProgress(value, status);
  const detail = progress.totalUnits !== null && progress.unitType
    ? `${progress.completedUnits} / ${progress.totalUnits} ${progress.unitType}`
    : null;
  return { ...progress, label: status === "failed" ? "Import paused" : phases[progress.phase].label, detail };
}

export function keepProgressMonotonic(current: number, next: number, status: string) {
  if (status === "complete") return 100;
  return Math.max(current, next);
}

export function isCampaignProcessingActive(status: string) {
  return status !== "complete" && status !== "failed";
}
