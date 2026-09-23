import { createHash } from "node:crypto";
import type { GraphInventory } from "@/lib/ai/entity-reconciliation";
import { pageTextForModel } from "@/lib/pdf/model-text";
import type { DocumentPage } from "@/lib/pdf/types";

export interface ExtractionContextEntity {
  canonicalId: string;
  name: string;
  type: string;
  aliases: string[];
}

export interface RawSourceMapping {
  page: number;
  start: number;
  end: number;
  text: string;
}

export interface SourceSegment {
  segmentId: string;
  page: number;
  semanticText: string;
  rawSource: RawSourceMapping;
}

export interface ExtractionContext {
  entities: ExtractionContextEntity[];
  sourceSegments: SourceSegment[];
}

const TARGET_SEGMENT_CHARACTERS = 900;
const MAXIMUM_SEGMENT_CHARACTERS = 1_200;

function alphabeticIndex(index: number): string {
  let value = index;
  let result = "";
  do {
    result = String.fromCharCode(97 + (value % 26)) + result;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return result;
}

function normalizedRawWithMap(raw: string) {
  let text = "";
  const indexes: number[] = [];
  let pendingSpace: number | null = null;
  for (let index = 0; index < raw.length; index += 1) {
    if (raw[index] === "-") {
      const wrap = raw.slice(index + 1).match(/^(?:\r?\n|[ \t]+\r?\n)[ \t]*(\p{Ll})/u);
      if (wrap) {
        index += wrap[0].length;
        text += wrap[1];
        indexes.push(index);
        continue;
      }
    }
    if (/\s/u.test(raw[index])) {
      if (text) pendingSpace = index;
      continue;
    }
    if (pendingSpace !== null) {
      text += " ";
      indexes.push(pendingSpace);
      pendingSpace = null;
    }
    text += raw[index];
    indexes.push(index);
  }
  return { text, indexes };
}

function splitLongText(value: string): string[] {
  if (value.length <= MAXIMUM_SEGMENT_CHARACTERS) return [value];
  const sentences = value.match(/[^.!?]+(?:[.!?]+|$)/gu)?.map((part) => part.trim()).filter(Boolean) ?? [value];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > MAXIMUM_SEGMENT_CHARACTERS) {
      if (current) pieces.push(current);
      current = "";
      for (let offset = 0; offset < sentence.length;) {
        const tentative = Math.min(sentence.length, offset + MAXIMUM_SEGMENT_CHARACTERS);
        const boundary = tentative < sentence.length ? sentence.lastIndexOf(" ", tentative) : tentative;
        const end = boundary > offset + 200 ? boundary : tentative;
        pieces.push(sentence.slice(offset, end).trim());
        offset = end;
      }
    } else if (!current || current.length + 1 + sentence.length <= TARGET_SEGMENT_CHARACTERS) current = current ? `${current} ${sentence}` : sentence;
    else { pieces.push(current); current = sentence; }
  }
  if (current) pieces.push(current);
  return pieces;
}

function semanticPieces(page: DocumentPage): string[] {
  const paragraphs = pageTextForModel(page).split(/\n\s*\n/gu).map((part) => part.replace(/\s+/gu, " ").trim()).filter(Boolean);
  const atomic = paragraphs.flatMap(splitLongText);
  const packed: string[] = [];
  let current = "";
  for (const part of atomic) {
    if (!current || current.length + 1 + part.length <= TARGET_SEGMENT_CHARACTERS) current = current ? `${current} ${part}` : part;
    else { packed.push(current); current = part; }
  }
  if (current) packed.push(current);
  return packed;
}

function sourceSegmentsForPage(page: DocumentPage): SourceSegment[] {
  const mapped = normalizedRawWithMap(page.text);
  let searchFrom = 0;
  return semanticPieces(page).map((semanticText, index) => {
    const needle = semanticText.replace(/\s+/gu, " ").trim();
    const start = mapped.text.indexOf(needle, searchFrom);
    if (start < 0) throw new Error(`Source segment on page ${page.pageNumber} could not be mapped to raw source`);
    const rawStart = mapped.indexes[start];
    const rawEnd = mapped.indexes[start + needle.length - 1];
    if (rawStart === undefined || rawEnd === undefined) throw new Error(`Source segment on page ${page.pageNumber} lost raw-source offsets`);
    searchFrom = start + needle.length;
    return {
      segmentId: `${page.pageNumber}${alphabeticIndex(index)}`,
      page: page.pageNumber,
      semanticText,
      rawSource: { page: page.pageNumber, start: rawStart, end: rawEnd + 1, text: page.text.slice(rawStart, rawEnd + 1) },
    };
  });
}

export function buildExtractionContext(pages: DocumentPage[], inventory: GraphInventory): ExtractionContext {
  return {
    entities: inventory.entities.map((entity) => ({ canonicalId: entity.temporary_id, name: entity.name, type: entity.type, aliases: [...new Set(entity.aliases ?? [])] })),
    sourceSegments: [...pages].sort((left, right) => left.pageNumber - right.pageNumber).flatMap(sourceSegmentsForPage),
  };
}

export function extractionContextFingerprint(context: ExtractionContext) {
  return createHash("sha256").update(JSON.stringify(context)).digest("hex");
}
