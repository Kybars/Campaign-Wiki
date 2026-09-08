# v0.3 data and provenance foundation

Milestone 0 extends the existing relational graph rather than replacing it with a generic EAV model.

## Knowledge units

`entities` remain the canonical identity records. `entity_facts` stores article knowledge that is neither identity nor a graph connection. A fact has a stable key within its canonical entity, a bounded field key, textual content, optional structured JSON, ordering/context metadata, its own visibility, and an origin. Multiple facts may use the same field key.

`fact_evidence` attaches evidence to one specific fact. Document evidence requires the document, page, and supporting excerpt. It can also retain structured source-location and origin metadata. Multiple evidence rows can support one fact, including distinct excerpts from the same page. This makes a future citation disclose only the excerpt supporting the visible fact instead of every statement found on that page.

Relationships remain first-class rows and location containment continues to use normalized `located in` relationships. Neither is duplicated into text facts.

## Visibility and prominence

Entity, fact, and normalized relationship visibility use exactly `dm_only` and `player_visible`. Legacy rows default to `dm_only`; the current application is a DM-facing read model and does not filter them yet. One relationship row owns one visibility value, so its forward and inverse presentations cannot diverge.

Universal prominence is nullable and otherwise limited to `major`, `supporting`, and `minor`. Existing entities remain `NULL` (unclassified) until a later post-reconciliation milestone assigns prominence. `prominence_reason` is diagnostic storage and is not part of the normal UI.

## Summaries and overviews

Entities retain the legacy `summary` compatibility column and add separate `gm_summary` and `player_summary` columns. Migration copies the legacy summary only to `gm_summary`; `player_summary` remains null. Campaigns similarly have nullable GM and Player overview columns. Summary/overview evidence tables allow future generated text to remain source-backed without treating entity-existence evidence as fact evidence.

## Provenance origins and future editing

Evidence origins are `document`, `manual`, or `session`. Only document provenance is produced in Milestone 0. Document evidence enforces a document/page/excerpt shape; non-document origins do not pretend to reference a PDF page. Existing entity and relationship source rows remain valid document evidence.

Stable entity, relationship, and fact IDs are preserved during graph replacement when their canonical identity/stable key still matches. Replacement refreshes document-derived graph data, while manual/session facts and non-document evidence are left intact. These identity and origin boundaries provide extension points for later reveal controls, manual facts, merge/split operations, and audit history without replacing this schema.
