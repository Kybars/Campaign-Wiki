# v0.3 rich fact extraction

Milestone 1 extracts conservative, source-backed facts inside each chunk candidate and uses the Milestone 0 `entity_facts` / `fact_evidence` model. It does not generate prominence, visibility classifications, GM/player summaries, or campaign overviews.

## Pipeline boundary

1. Chunk extraction emits type-bounded candidate facts with a temporary ID, field key, concise content, and one or more page/excerpt sources.
2. Source validation checks each fact's evidence independently from entity-existence and relationship evidence. Facts with no valid excerpt are discarded.
3. Entity reconciliation remains responsible only for canonical identity.
4. After reconciliation, candidate facts are remapped through `candidateToCanonical`, then conservatively deduplicated by canonical entity, field, and normalized content.
5. Equivalent facts merge their evidence; distinct or conflicting values remain separate facts.
6. The existing transactional graph replacement RPC persists canonical facts and their evidence.

## Facts versus relationships

Fact field enums contain descriptive and state knowledge. Linkable connections—ownership, membership, leadership, quest involvement, event participation, and physical location containment—remain canonical relationships. Location containment therefore continues to use the normalized, recursive, cycle-safe hierarchy.

## Evidence and safety

Every candidate fact has its own page/excerpt list. Aggregation never substitutes an entity's combined sources for a fact's evidence. This leaves later citation rendering able to show only the excerpt that supports the visible claim.

All Milestone 1 facts use the Milestone 0 safe default `dm_only`. Prominence stays unclassified, and GM/player summaries stay unset until Milestone 2.

## Cache and replay

Rich extraction uses cache schema version 4. Versions 1–3 remain replayable as legacy, factless extraction data. A version 4 cache missing the required `facts` arrays is rejected rather than silently masquerading as rich output. Raw and validated fact output lives in the existing chunk cache, so replay makes no extraction call.

The deterministic rich fixture covers all entity types, multiple evidence records, distinct values in one field, conflicting statements, sparse entities, structured relationships, and exact/relative event chronology.
