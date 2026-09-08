import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanonicalGraph } from "@/lib/graph/build";
import { canonicalGraphPersistencePayload } from "@/lib/graph/persistence";
import type { CandidateAggregate } from "@/lib/graph/types";
import {
  ENTITY_PROMINENCES,
  KNOWLEDGE_VISIBILITIES,
  PROVENANCE_ORIGINS,
  isEntityProminence,
  isKnowledgeVisibility,
  type EntityFact,
  type EntityProminence,
} from "@/lib/knowledge/types";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260908120000_v03_data_provenance_foundation.sql"),
  "utf8",
);

function fixtureGraph() {
  const aggregate: CandidateAggregate = {
    entities: [
      {
        id: "chunk-1:colinus",
        chunkId: "chunk-1",
        temporaryId: "colinus",
        name: "Colinus Birthwitch",
        type: "npc",
        roles: [],
        aliases: [],
        summary: "A hunter and councilmember.",
        sources: [{ page_number: 27, supporting_text: "Colinus Birthwitch is a village hunter." }],
      },
      {
        id: "chunk-1:kylar",
        chunkId: "chunk-1",
        temporaryId: "kylar",
        name: "Kylar Birthwitch",
        type: "npc",
        roles: [],
        aliases: [],
        summary: "Colinus's nephew.",
        sources: [{ page_number: 35, supporting_text: "Kylar is Colinus's nephew." }],
      },
    ],
    relationships: [
      {
        id: "chunk-1:r1",
        chunkId: "chunk-1",
        sourceCandidateId: "chunk-1:colinus",
        targetCandidateId: "chunk-1:kylar",
        relationship_type: "uncle_of",
        description: "Colinus is Kylar's uncle.",
        confidence: 0.95,
        sources: [{ page_number: 35, supporting_text: "Kylar is Colinus's nephew." }],
      },
      {
        id: "chunk-1:r2",
        chunkId: "chunk-1",
        sourceCandidateId: "chunk-1:kylar",
        targetCandidateId: "chunk-1:colinus",
        relationship_type: "nephew_of",
        description: "Kylar is Colinus's nephew.",
        confidence: 0.9,
        sources: [{ page_number: 45, supporting_text: "Colinus names his nephew Kylar." }],
      },
    ],
  };
  return buildCanonicalGraph(aggregate);
}

describe("v0.3 Milestone 0 domain model", () => {
  it("centralizes exactly two visibility states", () => {
    expect(KNOWLEDGE_VISIBILITIES).toEqual(["dm_only", "player_visible"]);
    expect(isKnowledgeVisibility("dm_only")).toBe(true);
    expect(isKnowledgeVisibility("player_visible")).toBe(true);
    expect(isKnowledgeVisibility("party_visible")).toBe(false);
  });

  it("supports universal prominence and a nullable legacy state", () => {
    expect(ENTITY_PROMINENCES).toEqual(["major", "supporting", "minor"]);
    expect(ENTITY_PROMINENCES.every(isEntityProminence)).toBe(true);
    const legacyProminence: EntityProminence | null = null;
    expect(legacyProminence).toBeNull();
  });

  it("represents document, manual, and later session provenance without fake PDF pages", () => {
    expect(PROVENANCE_ORIGINS).toEqual(["document", "manual", "session"]);
    const fact: EntityFact = {
      id: "fact-1",
      entityId: "colinus",
      stableKey: "occupation:hunter",
      fieldKey: "occupation",
      content: "Hunter",
      structuredValue: null,
      visibility: "player_visible",
      origin: "document",
      sortOrder: 0,
      context: {},
      evidence: [
        { id: "e1", origin: "document", documentId: "document-1", pageNumber: 27, supportingText: "Colinus is a hunter." },
        { id: "e2", origin: "document", documentId: "document-1", pageNumber: 35, supportingText: "The hunter Colinus returns." },
        { id: "e3", origin: "manual", supportingText: "Confirmed by the GM.", originMetadata: { author: "gm" } },
      ],
    };
    expect(fact.evidence).toHaveLength(3);
    expect(fact.evidence[2]).not.toHaveProperty("pageNumber");
  });

  it("keeps fact, entity, and normalized relationship visibility independent", () => {
    const graph = fixtureGraph();
    const colinus = graph.entities.find((entity) => entity.name === "Colinus Birthwitch")!;
    colinus.visibility = "player_visible";
    graph.relationships[0].visibility = "dm_only";
    graph.facts = [
      {
        entityKey: colinus.key,
        stableKey: "occupation:hunter",
        fieldKey: "occupation",
        content: "Hunter",
        visibility: "player_visible",
        evidence: [
          { origin: "document", pageNumber: 27, supportingText: "Colinus is a hunter." },
          { origin: "document", pageNumber: 35, supportingText: "The hunter Colinus returns." },
        ],
      },
      {
        entityKey: colinus.key,
        stableKey: "secret:murdered-reson",
        fieldKey: "secret",
        content: "Murdered Reson",
        visibility: "dm_only",
        evidence: [{ origin: "document", pageNumber: 35, supportingText: "Colinus murdered Reson." }],
      },
    ];

    const payload = canonicalGraphPersistencePayload(graph);
    expect(payload.entities.find((entity) => entity.key === colinus.key)?.visibility).toBe("player_visible");
    expect(payload.facts.map((fact) => fact.visibility)).toEqual(["player_visible", "dm_only"]);
    expect(payload.relationships).toHaveLength(1);
    expect(payload.relationships[0].visibility).toBe("dm_only");
    expect(payload.relationships[0].sources).toHaveLength(2);
  });

  it("keeps facts from one page distinguishable and evidence attached to its fact", () => {
    const graph = fixtureGraph();
    const entityKey = graph.entities[0].key;
    graph.facts = [
      { entityKey, stableKey: "occupation:hunter", fieldKey: "occupation", content: "Hunter", evidence: [{ pageNumber: 45, supportingText: "Colinus hunts for the village." }] },
      { entityKey, stableKey: "crime:murdered-reson", fieldKey: "secret", content: "Murdered Reson", evidence: [{ pageNumber: 45, supportingText: "Colinus murdered Reson." }] },
    ];
    const facts = canonicalGraphPersistencePayload(graph).facts;
    expect(facts.map((fact) => fact.stableKey)).toEqual(["occupation:hunter", "crime:murdered-reson"]);
    expect(facts[0].evidence[0].supportingText).not.toBe(facts[1].evidence[0].supportingText);
  });
});

describe("v0.3 Milestone 0 migration safety", () => {
  it("defaults legacy entities and relationships to DM-only while leaving prominence unclassified", () => {
    expect(migration).toContain("add column visibility public.knowledge_visibility not null default 'dm_only'");
    expect(migration).toContain("add column prominence public.entity_prominence");
    expect(migration).not.toMatch(/add column prominence public\.entity_prominence[^;]*default/);
  });

  it("maps legacy summaries only to GM storage and does not fabricate player summaries", () => {
    expect(migration).toContain("update public.entities set gm_summary = summary");
    expect(migration).toContain("add column player_summary text");
    expect(migration).not.toMatch(/update public\.entities set player_summary/i);
  });

  it("retains source rows as document evidence and enforces fact-level excerpts", () => {
    expect(migration).toContain("alter table public.entity_sources");
    expect(migration).toContain("alter table public.relationship_sources");
    expect(migration).toContain("origin = 'document' and document_id is not null and page_number is not null and supporting_text is not null");
    expect(migration).toContain("fact_id uuid not null references public.entity_facts(id) on delete cascade");
  });

  it("preserves stable graph identities and removes stale document-derived structures", () => {
    expect(migration).toContain("and normalized_name = entity_record->>'normalizedName'");
    expect(migration).toContain("reconciliation_metadata->'candidateIds'");
    expect(migration).toContain("and stable_key = fact_record->>'stableKey'");
    expect(migration).toContain("delete from public.relationships");
    expect(migration).toContain("and origin = 'document'");
    expect(migration).toContain("delete from public.entity_facts");
    expect(migration).toContain("where origin = 'document'");
  });

  it("keeps the new tables server-only under RLS", () => {
    for (const table of ["entity_facts", "fact_evidence", "entity_summary_evidence", "campaign_overview_evidence"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain("to service_role");
    expect(migration).toContain("from anon, authenticated");
  });
});
