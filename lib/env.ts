import { z } from "zod";

export function resolveOpenAIModels<T extends { OPENAI_MODEL: string; OPENAI_EXTRACTION_MODEL?: string; OPENAI_RECONCILIATION_MODEL?: string; OPENAI_ENRICHMENT_MODEL?: string }>(env: T) {
  return {
    ...env,
    OPENAI_EXTRACTION_MODEL: env.OPENAI_EXTRACTION_MODEL ?? env.OPENAI_MODEL,
    OPENAI_RECONCILIATION_MODEL: env.OPENAI_RECONCILIATION_MODEL ?? env.OPENAI_MODEL,
    OPENAI_ENRICHMENT_MODEL: env.OPENAI_ENRICHMENT_MODEL ?? env.OPENAI_MODEL,
  };
}

const openAIEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-terra"),
  OPENAI_EXTRACTION_MODEL: z.string().min(1).optional(),
  OPENAI_RECONCILIATION_MODEL: z.string().min(1).optional(),
  OPENAI_ENRICHMENT_MODEL: z.string().min(1).optional(),
  AI_EXTRACTION_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),
}).transform(resolveOpenAIModels);

const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

const processingEnvSchema = z.object({
  PDF_CHUNK_TARGET_CHARACTERS: z.coerce.number().int().min(5000).max(100000).default(45000),
});

export type OpenAIEnv = z.infer<typeof openAIEnvSchema>;
export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>;
export type ProcessingEnv = z.infer<typeof processingEnvSchema>;
export type AIStage = "extraction" | "reconciliation" | "enrichment";
export type ResolvedAIProviderConfig =
  | { providerId: "openai"; modelId: string }
  | { providerId: "local"; modelId: string; baseUrl: string; apiKey?: string; allowPersistence: boolean };

export function resolveAIProviderConfig(env: Record<string, string | undefined>, stage: AIStage): ResolvedAIProviderConfig {
  const provider = env.AI_PROVIDER ?? "openai";
  if (provider === "openai") {
    const models = resolveOpenAIModels({ OPENAI_MODEL: env.OPENAI_MODEL || "gpt-5.6-terra", OPENAI_EXTRACTION_MODEL: env.OPENAI_EXTRACTION_MODEL, OPENAI_RECONCILIATION_MODEL: env.OPENAI_RECONCILIATION_MODEL, OPENAI_ENRICHMENT_MODEL: env.OPENAI_ENRICHMENT_MODEL });
    if (!env.OPENAI_API_KEY) throw new Error("Invalid OpenAI configuration. Check: OPENAI_API_KEY");
    const modelId = stage === "extraction" ? models.OPENAI_EXTRACTION_MODEL : stage === "reconciliation" ? models.OPENAI_RECONCILIATION_MODEL : models.OPENAI_ENRICHMENT_MODEL;
    return { providerId: "openai", modelId };
  }
  if (provider !== "local") throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  if (env.VERCEL === "1") throw new Error("AI_PROVIDER=local is not allowed on Vercel");
  const parsed = z.object({ LOCAL_AI_BASE_URL: z.string().url(), LOCAL_AI_MODEL: z.string().min(1), LOCAL_AI_API_KEY: z.string().min(1).optional(), LOCAL_AI_ALLOW_PERSISTENCE: z.enum(["true", "false"]).optional().default("false") }).safeParse({ ...env, LOCAL_AI_API_KEY: env.LOCAL_AI_API_KEY || undefined });
  if (!parsed.success) throw new Error(`Invalid local AI configuration. Check: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  return { providerId: "local", modelId: parsed.data.LOCAL_AI_MODEL, baseUrl: parsed.data.LOCAL_AI_BASE_URL.replace(/\/$/, ""), apiKey: parsed.data.LOCAL_AI_API_KEY, allowPersistence: parsed.data.LOCAL_AI_ALLOW_PERSISTENCE === "true" };
}

export function assertAIProviderPersistenceAllowed(config: ResolvedAIProviderConfig) {
  if (config.providerId === "local" && !config.allowPersistence) {
    throw new Error("AI_PROVIDER=local cannot persist canonical campaign data without LOCAL_AI_ALLOW_PERSISTENCE=true");
  }
}

function parseEnv<T>(schema: z.ZodType<T>, label: string): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid ${label} configuration. Check: ${missing}`);
  }
  return result.data;
}

let cachedOpenAIEnv: OpenAIEnv | undefined;
let cachedSupabaseEnv: SupabaseEnv | undefined;
let cachedProcessingEnv: ProcessingEnv | undefined;

export function getOpenAIEnv(): OpenAIEnv {
  return cachedOpenAIEnv ??= parseEnv(openAIEnvSchema, "OpenAI");
}

export function getSupabaseEnv(): SupabaseEnv {
  return cachedSupabaseEnv ??= parseEnv(supabaseEnvSchema, "Supabase");
}

export function getProcessingEnv(): ProcessingEnv {
  return cachedProcessingEnv ??= parseEnv(processingEnvSchema, "processing");
}

export function getAIProviderConfig(stage: AIStage): ResolvedAIProviderConfig {
  return resolveAIProviderConfig(process.env, stage);
}
