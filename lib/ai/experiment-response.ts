import type { ModelCallUsage } from "@/lib/ai/usage";

export interface ExperimentResponseDiagnostics {
  responseId: string | "unknown";
  status: string | "unknown";
  incompleteDetails: unknown;
  outputItemStatuses: Array<string | "unknown"> | "unknown";
  finishReason: string | "unknown";
  usage: ModelCallUsage | "unknown";
  configuredMaxOutputTokens: number;
  configuredSdkMaxRetries: number;
}

export function unknownExperimentDiagnostics(maxOutputTokens: number, sdkMaxRetries: number): ExperimentResponseDiagnostics {
  return { responseId: "unknown", status: "unknown", incompleteDetails: "unknown", outputItemStatuses: "unknown", finishReason: "unknown",
    usage: "unknown", configuredMaxOutputTokens: maxOutputTokens, configuredSdkMaxRetries: sdkMaxRetries };
}

export function captureExperimentResponseDiagnostics(response: {
  id?: string | null; status?: string | null; incomplete_details?: unknown; output?: unknown[];
}, usage: ModelCallUsage, maxOutputTokens: number, sdkMaxRetries: number): ExperimentResponseDiagnostics {
  return { responseId: response.id ?? "unknown", status: response.status ?? "unknown",
    incompleteDetails: response.incomplete_details === undefined ? "unknown" : response.incomplete_details,
    outputItemStatuses: response.output?.map((item) => item && typeof item === "object" && "status" in item && typeof item.status === "string" ? item.status : "unknown") ?? "unknown",
    finishReason: "unknown", usage, configuredMaxOutputTokens: maxOutputTokens, configuredSdkMaxRetries: sdkMaxRetries };
}
