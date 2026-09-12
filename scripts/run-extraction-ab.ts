import { loadEnvConfig } from "@next/env";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { buildExtractionInput, EXTRACTION_SYSTEM_PROMPT } from "../lib/ai/prompts";
import { OpenAICallBudget } from "../lib/ai/openai-call-budget";
import { EXTRACTION_BEHAVIOR_VERSION, EXTRACTION_CONTRACT_VERSION } from "../lib/ai/operation-checkpoint";
import { chunkExtractionSchema } from "../lib/ai/schemas";
import { validateChunkExtraction } from "../lib/ai/source-validation";
import { modelCallUsage } from "../lib/ai/usage";
import type { DocumentPage, PageChunk } from "../lib/pdf/types";

loadEnvConfig(process.cwd());

const SOURCE_CAMPAIGN_ID = "d14f9875-5ebf-46c6-b07e-d65a3e65c5f4";
const MODELS = ["gpt-5.6-luna", "gpt-5.6-terra"] as const;
const MAXIMUM_ATTEMPTS = 6;
const artifactDirectory = new URL("../artifacts/extraction-ab/", import.meta.url);
const manifestPath = new URL("manifest.json", artifactDirectory);

interface ReferenceArtifact {
  frozen_at_commit: string;
  package_version: string;
  selected_chunk_order: number[];
  chunks: Array<{
    chunk_number: number;
    chunk_id: string;
    page_numbers: number[];
    normalized_source_text_sha256: string;
    source_characters: number;
    known_historical_misses: number;
  }>;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  if (existsSync(manifestPath)) throw new Error("Experiment manifest already exists; refusing to risk additional paid calls");
  const reference = JSON.parse(readFileSync(
    new URL("../docs/audits/extraction_ab_reference.json", import.meta.url),
    "utf8",
  )) as ReferenceArtifact;
  if (reference.frozen_at_commit !== "53aee4208b4bcc6d6f1459745c328b46b10ec774" || reference.package_version !== "0.4.8") {
    throw new Error("Frozen reference does not match the authorized v0.4.8 baseline");
  }
  if (reference.chunks.length !== 3 || MODELS.length * reference.chunks.length !== MAXIMUM_ATTEMPTS) {
    throw new Error("Experiment design does not equal exactly six planned application attempts");
  }
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is unavailable");

  const { createAdminClient } = await import("../lib/db/client");
  const database = createAdminClient();
  const documentResult = await database.from("documents").select("id").eq("campaign_id", SOURCE_CAMPAIGN_ID).single();
  if (documentResult.error) throw documentResult.error;
  const pagesResult = await database.from("document_pages").select("page_number,text").eq("document_id", documentResult.data.id).order("page_number");
  if (pagesResult.error || !pagesResult.data) throw pagesResult.error ?? new Error("Source pages unavailable");

  const chunks = reference.chunks.map((item): PageChunk => {
    const pages: DocumentPage[] = item.page_numbers.map((pageNumber) => {
      const page = pagesResult.data.find((candidate) => candidate.page_number === pageNumber);
      if (!page) throw new Error(`Missing source page ${pageNumber}`);
      return { pageNumber, text: page.text };
    });
    const inputText = buildExtractionInput({ id: item.chunk_id, pages, characterCount: pages.reduce((total, page) => total + page.text.length, 0) });
    const delimitedText = inputText.slice(inputText.indexOf("<campaign-page"));
    if (sha256(delimitedText.replace(/\s+/g, " ").trim()) !== item.normalized_source_text_sha256) {
      throw new Error(`Frozen source hash mismatch for chunk ${item.chunk_number}`);
    }
    return { id: item.chunk_id, pages, characterCount: pages.reduce((total, page) => total + page.text.length, 0) };
  });

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 });
  const budget = new OpenAICallBudget(MAXIMUM_ATTEMPTS);
  if (!budget.allowPlanned(MAXIMUM_ATTEMPTS)) throw new Error("Six-call experiment budget is not allowed");
  mkdirSync(artifactDirectory, { recursive: true });
  const manifest: {
    status: string;
    baselineCommit: string;
    packageVersion: string;
    selectedChunks: number[];
    plannedLunaCalls: number;
    plannedTerraCalls: number;
    maximumApplicationOpenAIAttempts: number;
    sdkMaxRetries: number;
    attempts: Array<Record<string, unknown>>;
  } = {
    status: "started",
    baselineCommit: reference.frozen_at_commit,
    packageVersion: reference.package_version,
    selectedChunks: reference.selected_chunk_order,
    plannedLunaCalls: 3,
    plannedTerraCalls: 3,
    maximumApplicationOpenAIAttempts: MAXIMUM_ATTEMPTS,
    sdkMaxRetries: 0,
    attempts: [],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    selectedChunks: reference.chunks.map((chunk) => ({ chunk: chunk.chunk_number, pages: [chunk.page_numbers[0], chunk.page_numbers.at(-1)], historicalMisses: chunk.known_historical_misses })),
    plannedLunaCalls: 3,
    plannedTerraCalls: 3,
    maximumApplicationOpenAIAttempts: MAXIMUM_ATTEMPTS,
    sdkMaxRetries: 0,
    guard: "ALLOW",
  }, null, 2));

  for (const [chunkIndex, chunk] of chunks.entries()) {
    const referenceChunk = reference.chunks[chunkIndex];
    for (const model of MODELS) {
      budget.reserveAttempt();
      const attemptNumber = budget.usedAttempts;
      const startedAt = new Date().toISOString();
      const started = performance.now();
      const artifactPath = new URL(`chunk-${referenceChunk.chunk_number}-${model.endsWith("luna") ? "luna" : "terra"}.json`, artifactDirectory);
      try {
        const response = await client.responses.parse({
          model,
          input: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: buildExtractionInput(chunk) },
          ],
          text: { format: zodTextFormat(chunkExtractionSchema, "campaign_chunk_extraction") },
        });
        if (!response.output_parsed) throw new Error("OpenAI returned no parsed campaign_chunk_extraction result");
        const rawOutput = chunkExtractionSchema.parse(response.output_parsed);
        const validated = validateChunkExtraction(rawOutput, chunk.pages);
        const usage = modelCallUsage(response.model, response.id, response.usage);
        const artifact = {
          attemptNumber,
          provider: "openai",
          requestedModel: model,
          responseModel: response.model,
          responseId: response.id,
          responseStatus: response.status,
          incompleteDetails: response.incomplete_details,
          startedAt,
          latencyMs: Math.round(performance.now() - started),
          behaviorVersion: EXTRACTION_BEHAVIOR_VERSION,
          schemaVersion: EXTRACTION_CONTRACT_VERSION,
          chunkNumber: referenceChunk.chunk_number,
          chunkId: chunk.id,
          pageNumbers: referenceChunk.page_numbers,
          normalizedSourceTextSha256: referenceChunk.normalized_source_text_sha256,
          valid: true,
          usage,
          validationDiagnostics: validated.diagnostics,
          rawOutput,
          validatedOutput: validated.extraction,
        };
        writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
        manifest.attempts.push({ attemptNumber, chunkNumber: referenceChunk.chunk_number, requestedModel: model, responseModel: response.model, responseId: response.id, valid: true, latencyMs: artifact.latencyMs, usage });
        console.log(JSON.stringify(manifest.attempts.at(-1)));
      } catch (error) {
        const failure = {
          attemptNumber,
          provider: "openai",
          requestedModel: model,
          startedAt,
          latencyMs: Math.round(performance.now() - started),
          behaviorVersion: EXTRACTION_BEHAVIOR_VERSION,
          schemaVersion: EXTRACTION_CONTRACT_VERSION,
          chunkNumber: referenceChunk.chunk_number,
          chunkId: chunk.id,
          pageNumbers: referenceChunk.page_numbers,
          normalizedSourceTextSha256: referenceChunk.normalized_source_text_sha256,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
        };
        writeFileSync(artifactPath, `${JSON.stringify(failure, null, 2)}\n`);
        manifest.attempts.push(failure);
        console.error(JSON.stringify(failure));
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    }
  }

  manifest.status = "complete";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ status: manifest.status, usedAttempts: budget.usedAttempts, remainingAttempts: budget.remainingAttempts, artifacts: "artifacts/extraction-ab" }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
