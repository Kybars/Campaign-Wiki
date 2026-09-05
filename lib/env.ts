import { z } from "zod";

const openAIEnvSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1).default("gpt-5.6-terra"),
  AI_EXTRACTION_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(3),
});

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
