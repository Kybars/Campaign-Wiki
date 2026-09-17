import type { CampaignViewMode } from "@/lib/campaign-view";
import type { SourceEvidence } from "@/lib/wiki/source-presentation";

export function relationshipEvidenceForView(viewMode: CampaignViewMode, sources: SourceEvidence[]): SourceEvidence[] {
  return viewMode === "dm" ? sources : [];
}
