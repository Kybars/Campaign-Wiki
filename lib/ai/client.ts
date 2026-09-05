import OpenAI from "openai";
import { getOpenAIEnv } from "@/lib/env";

let client: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: getOpenAIEnv().OPENAI_API_KEY });
  return client;
}
