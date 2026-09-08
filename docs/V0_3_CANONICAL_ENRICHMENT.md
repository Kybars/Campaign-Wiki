# v0.3 canonical enrichment

Milestone 2 runs only after candidate reconciliation, canonical fact aggregation, normalized relationship construction, and location hierarchy selection.

The enrichment stage uses one complete canonical classification payload to assign campaign-relative `major`, `supporting`, or `minor` prominence and conservative `dm_only` or `player_visible` visibility. Entity, fact, and relationship visibility remain independent. Each normalized relationship is classified once, so both rendered directions share one value. Uncertain knowledge is classified `dm_only`; the system reports inconsistent visible references rather than silently cascading changes.

Prominence stores an internal reason plus selected existing source evidence in entity reconciliation metadata. It reuses the entity/fact/relationship evidence catalog rather than creating a second provenance system.

GM summaries receive all supported canonical facts and relationships. Player summaries and the Player campaign overview are generated in separate calls whose inputs are constructed only from Player-visible entities, facts, and relationships. Summary evidence IDs are validated against those inputs before persistence. This makes future citation rendering excerpt-granular and prevents an entire PDF page from becoming a visibility boundary.

`enrichment_cache_runs` stores the consolidated structured output, usage diagnostics, graph fingerprint, model, prompt version, and schema version. The extraction cache stays at its existing version. Replay applies a matching completed enrichment result without OpenAI; a rich graph with no matching enrichment cache is rejected before persistence so an old replay cannot wipe classified state.

Legacy campaigns remain unchanged: entity and relationship visibility stays DM-safe, prominence remains nullable/unclassified, existing summaries remain GM content, and Player summaries/overviews remain null. Existing entity UUIDs, fact stable keys, relationship IDs, URLs, evidence, and physical containment continue through the canonical persistence path.

Future manual changes fit the existing stable entity/fact/relationship IDs, independent visibility columns, and `document | manual | session` provenance origins. Milestone 2 does not add editing, reveal controls, history, accounts, read-mode filtering, or UI.
