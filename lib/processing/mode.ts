export const PROCESSING_MODES = ["lean", "full"] as const;

export type ProcessingMode = (typeof PROCESSING_MODES)[number];

export function resolveProcessingMode(value: unknown = process.env.CAMPAIGN_PROCESSING_MODE): ProcessingMode {
  if (value === undefined || value === "") return "lean";
  if (value === "lean" || value === "full") return value;
  throw new Error(`Unsupported campaign processing mode: ${String(value)}`);
}
