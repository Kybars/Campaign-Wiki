# Campaign Wiki — Product Specification

## 1. Product Summary

Campaign Wiki converts tabletop RPG campaign source material into an automatically generated, interconnected campaign wiki.

The user provides campaign material such as adventure PDFs, campaign notes, setting information, session summaries, NPC descriptions, quests, and similar sources.

The system:

1. Extracts source text while preserving source boundaries.
2. Identifies meaningful campaign entities.
3. Extracts source-backed facts about those entities.
4. Identifies meaningful relationships between entities.
5. Reconciles duplicate references into canonical entities.
6. Stores the resulting campaign knowledge in a structured form.
7. Generates readable wiki-style pages.
8. Cross-links related entities.
9. Preserves source evidence for every extracted claim.
10. Supports different knowledge visibility for Game Masters and players.

The core value proposition is:

> **Upload your campaign. Get an interconnected campaign wiki automatically.**

The product should feel like a useful campaign encyclopedia, not a database viewer or raw AI extraction report.

---

## 2. Product Goal

The central product hypothesis is:

> Can AI reliably transform messy RPG campaign material into a source-grounded wiki that is useful during preparation and play?

Success means a Game Master can provide existing campaign material and quickly browse a coherent knowledge base without manually organizing every NPC, location, item, faction, event, and quest first.

The system should optimize for:

- correctness over exhaustiveness
- source traceability
- fast navigation during play
- useful campaign structure
- progressive discovery of player-safe information
- maintainability as the campaign evolves

---

## 3. Enduring Product Principles

### Source material is authoritative

The uploaded campaign material is the campaign's canon.

Do not add outside setting lore unless it exists in the supplied source material.

### Do not invent campaign lore

Unknown information remains unknown.

Do not invent appearance, personality, chronology, motivation, ownership, relationships, or other details merely to complete an article.

### Prefer false negatives over false positives

Missing a minor fact is less damaging than adding a convincing but unsupported one.

### Preserve uncertainty

If the source is ambiguous, the data model and presentation should not pretend certainty.

### Every displayed extracted fact is source-backed

A user must be able to inspect the evidence supporting a generated fact.

### Prefer meaningful entities

Do not turn every noun, generic guard, ordinary object, or incidental concept into a canonical entity.

### One canonical identity

Repeated references to the same real campaign entity should reconcile globally.

When uncertain whether two entities are identical, prefer keeping them separate over an incorrect merge.

### One logical relationship

Inverse presentation does not create duplicate stored relationships.

A relationship such as `parent_of / child_of` or `located_in / contains` is one logical fact rendered from the relevant perspective.

### The wiki should read like a wiki

Structured data powers the product, but users should see readable articles, concise facts, natural relationships, and links rather than database terminology.

### AI automates organization; the GM owns campaign decisions

AI should automate transcription, extraction, linking, and tedious organization. The GM should own authorial campaign decisions such as what matters, what players know, and what changes during play. AI may suggest those decisions, but expensive full enrichment should not be mandatory for every import.

A useful GM wiki should be able to exist from canonical extracted and reconciled knowledge without requiring every optional enrichment operation.

---

## 4. Core User Flow

### 4.1 Create campaign

The user provides:

- campaign name
- supported source material

Initial versions may support only text-based PDFs. Broader source ingestion can be added later.

### 4.2 Process campaign

Conceptual pipeline:

```text
Source upload
    ↓
Page/source-preserving text extraction
    ↓
Chunking
    ↓
Candidate entity extraction
    ↓
Candidate fact extraction
    ↓
Candidate relationship extraction
    ↓
Global entity reconciliation
    ↓
Canonical entity construction
    ↓
Fact aggregation and evidence preservation
    ↓
Relationship normalization
    ↓
Location hierarchy construction
    ↓
Campaign-level enrichment
    ↓
Persistence
    ↓
Wiki
```

The pipeline should be replayable from saved intermediate data wherever practical so improvements do not require repeatedly paying for full extraction.

### 4.3 Browse campaign wiki

The campaign wiki provides:

- campaign overview
- category browsing
- integrated search
- entity pages
- recursive location navigation
- event chronology
- source inspection
- DM and Player views

### 4.4 Revisit campaigns

Existing campaigns remain directly reopenable from the campaign list.

The user should not need to know a campaign UUID or upload the source again.

---

## 5. Canonical Entity Ontology

Primary entity types:

### NPC

Named non-player characters and individually significant creatures.

### Deity

Gods, divine beings, and comparable campaign entities that function as deities.

Deities are not NPCs merely because they can speak or act like characters.

### Location

Physical places at any scale.

Examples:

- world
- country
- province
- city
- village
- building
- dungeon
- room
- altar

Locations can form an arbitrarily deep physical containment hierarchy.

### Faction

Organizations, governments, cults, guilds, armies, noble houses, criminal groups, churches, societies, and similar organized groups.

### Item

Narratively meaningful named objects, including magical and non-magical items.

### Event

Narratively significant past, current, or expected happenings.

### Quest

Explicit missions, investigations, goals, or unresolved objectives significant enough to deserve their own reference entry.

### Other

Fallback for meaningful named campaign concepts that do not fit another category.

Use `Other` sparingly.

Manual reclassification is a later product capability.

---

## 6. Roles

Some classifications describe how an entity functions rather than what it is.

### Enemy

`Enemy` is a role, not an entity type.

An entity can therefore be:

- NPC + Enemy
- Deity + Enemy
- Faction + Enemy

without creating duplicate entities.

Additional roles may be introduced later when justified by the product.

---

## 7. Universal Entity Prominence

Every canonical entity can have campaign-relative prominence:

- `major`
- `supporting`
- `minor`

Prominence applies to every entity type.

Prominence is assigned after reconciliation, once the system has the full available evidence for the canonical entity.

Prominence reflects narrative relevance within this campaign, not raw power or social rank.

Examples:

- a dog may be Minor even though it is named
- a village hunter may be Major if central to the plot
- an artifact may be Major even if mentioned only in a pivotal late section

Prominence affects browsing emphasis, not whether an entity exists or is searchable.

---

## 8. Source-Backed Knowledge Model

Entities contain source-backed knowledge rather than only a name and one generic summary.

Conceptually, each knowledge unit must be able to carry:

```text
id
entity_id
field/type
value/content
visibility
source evidence
ordering/context where useful
```

The implementation does not have to use a generic EAV schema if a cleaner typed representation fits the codebase.

The important requirements are:

- facts have stable identity where needed
- facts can carry independent provenance
- facts can carry independent visibility
- one field can contain multiple supported values
- one fact can have multiple pieces of evidence
- structured relationships remain first-class rather than duplicated as text facts

---

## 9. Provenance

Every extracted fact and relationship must be traceable to supporting source evidence.

For document-derived evidence, preserve at minimum:

```text
document
page/source location
supporting excerpt
```

Evidence must be granular enough to support the specific fact.

A page number alone is not sufficient when a page contains both player-safe information and GM-only secrets.

### Future source origins

The provenance model should be extensible to future sources such as:

- document extraction
- manual GM entry
- session-derived information

Manual authoring does not need to exist in the current implementation, but the data model should not assume every fact will forever come from a PDF page.

---

## 10. Knowledge Visibility

Campaign Wiki uses one canonical knowledge base rather than separate duplicated DM and player wikis.

Knowledge can initially have two visibility states:

- `dm_only`
- `player_visible`

Visibility can exist independently at:

- entity level
- fact level
- relationship level

### Entity visibility

If an entity is DM-only, Player View must not expose it through:

- campaign overview
- category pages
- search
- hover/focus previews
- relationships
- event chronology
- location trees
- breadcrumbs
- counts
- source indexes

### Fact visibility

A Player-visible entity can still contain DM-only facts.

Example:

```text
Colinus Birthwitch — Player visible
Hunter — Player visible
Village Councilmember — Player visible
Owns Brutus — Player visible
Murdered Reson — DM only
Blackmailed by Bjalien — DM only
```

### Relationship visibility

Visibility belongs to the normalized logical relationship.

Hiding one relationship must hide it from both endpoint perspectives.

### Evidence visibility

Player View must not expose hidden facts through source excerpts.

---

## 11. DM View and Player View

### DM View

Displays the full campaign knowledge available to the Game Master.

### Player View

Displays only Player-visible:

- entities
- facts
- relationships
- summaries
- source evidence
- navigation results

The same filtering rules must apply consistently across the application.

A Game Master should be able to preview Player View.

Actual authenticated DM/player permissions and reveal controls are later campaign-state functionality.

---

## 12. Summaries

Where summaries are generated, keep separate:

### GM Summary

May use all supported knowledge.

### Player Summary

May use only information determined to be player-safe.

Do not create a Player Summary by deleting phrases from a GM Summary.

Both summaries must be source-grounded and persisted rather than generated during page rendering.

The same principle applies to the campaign-level overview.

---

## 13. Rich Entity Articles

Entity types have different useful information.

Unsupported sections are omitted rather than displayed as `Unknown`.

### 13.1 NPC

Useful information can include:

- aliases / titles
- occupation / profession
- social role / position
- faction membership
- main location / residence / workplace
- appearance / first impression
- mannerisms
- voice/accent when stated
- personality / temperament
- values / beliefs
- flaws / fears when stated
- goals
- motivations
- wants from party when stated
- background / history
- knowledge
- capabilities
- status
- hooks
- important relationships

### 13.2 Location

Useful information can include:

- kind of place
- first impression
- appearance
- scale / layout
- sensory details
- atmosphere / vibe
- purpose / function
- common occupants / activity
- important features
- parent location
- sublocations
- notable occupants / owners
- status / condition
- hooks
- important relationships

### 13.3 Deity

Useful information can include:

- domains / portfolio
- appearance / manifestations
- iconography
- personality / temperament
- values / teachings
- saints
- avatars
- chosen / heralds / champions
- worshippers
- clergy
- holy places
- symbols
- relics
- rituals / festivals
- divine relationships
- status
- hooks

### 13.4 Faction

Useful information can include:

- faction type
- purpose / mission
- ideology / beliefs
- goals
- leadership
- important members
- membership
- recruitment / requirements
- structure
- headquarters
- territory
- resources / capabilities
- symbols / colors / uniforms
- reputation
- methods
- allies
- enemies / rivals
- associated locations
- notable assets
- history
- current situation
- status
- hooks
- Party Awareness
- Party Standing
- Reason for Standing
- Privileges / Restrictions / Obligations

Party-standing information remains source-derived until later campaign-state editing exists.

### 13.5 Item

Useful information can include:

- item type
- appearance
- materials / inscriptions
- history / origin
- creator
- previous owners / bearers
- current owner / holder
- current location
- explicit rules stats
- special powers / benefits
- drawbacks / curses
- activation / usage requirements
- lore
- status / condition
- connected quests / hooks

Mechanical stats and narrative powers should remain distinguishable where possible.

### 13.6 Quest

Quest pages should emphasize:

- objective
- questgiver
- important NPCs
- important locations
- important items
- involved factions
- stakes
- rewards
- source-backed status
- likely outcome / consequences when explicitly given
- hook / how it begins

### 13.7 Event

Event pages should support chronology through:

- what happened
- exact date/time if known
- relative timing if known
- uncertainty
- location
- participants
- causes
- consequences
- connected quests/entities

Do not invent dates merely to force events into a timeline.

### 13.8 Other

`Other` remains a simple fallback.

---

## 14. Relationships

Relationships remain one of the central product features.

They connect canonical entities and should:

- be stored once
- render bidirectionally
- use natural wording
- preserve evidence
- preserve visibility
- survive entity reconciliation
- avoid semantic inverse duplication

Examples:

```text
NPC → member_of → Faction
NPC → owns → Item
NPC → murdered → NPC
Location → located_in → Location
NPC → questgiver_for → Quest
```

Relationship vocabulary can include both normalized known relationship families and meaningful free-form relationships.

The UI should not expose internal labels when natural prose already communicates the relationship.

---

## 15. Recursive Location Hierarchy

Location containment is physical containment only.

Examples:

```text
Country
└── Village
    └── Tavern
        └── Basement
            └── Altar
```

Requirements:

- unlimited practical depth
- one canonical containment model
- cycle protection
- ambiguous parentage should prefer no parent over a wrong parent
- source-backed containment
- breadcrumbs
- parent/child navigation
- nested locations remain directly searchable

Do not confuse containment with:

- near
- owned_by
- controlled_by
- visited
- allied_with

---

## 16. Events and Chronology

The Events view should favor chronological presentation rather than alphabetical listing.

The system may use:

- exact dates
- relative dates
- era/grouping
- explicit sequence
- unknown date

Possible presentation groups include:

- Ancient History
- Before the Campaign
- Campaign Events
- Unknown Date

Chronology must preserve uncertainty and must not invent dates.

A broader universal timeline may be added later.

---

## 17. Campaign Overview

The campaign homepage should provide useful campaign context, not an extraction dashboard.

It should support:

### GM Overview

A source-backed overview containing the full premise, major conflicts, major antagonists, hidden situation, and stakes.

### Player Overview

A spoiler-safe, source-backed overview based on player introductions, handouts, explicitly public knowledge, or similarly strong evidence.

When player safety is unclear, omit questionable information.

The homepage should surface important campaign entities using prominence rather than treating every entry as equally important.

---

## 18. Navigation and Search

The wiki should optimize for fast reference during play.

Core navigation includes:

- current campaign home
- entity categories
- Enemies role view
- campaign-scoped search
- global All Campaigns navigation
- source inspection

The primary campaign header should remain available while scrolling.

Category pages should remain concise and prominence-aware.

Search should find entities regardless of prominence.

Semantic/AI search is not required unless separately introduced.

---

## 19. Quick Entity Previews

Entity links may provide compact hover/focus previews showing useful source-backed facts.

Examples:

```text
Colinus Birthwitch
NPC
Hunter · Village Councilmember
Tomar's Crossing
Alive
```

or:

```text
Jorney's Tavern
Location
Tavern in Tomar's Crossing
Busy local gathering place
```

Previews must:

- respect DM/Player visibility
- be keyboard accessible
- have sensible touch behavior
- avoid render-time AI calls
- avoid one API/database request per hover when practical

---

## 20. Source Inspection

Source references should be compact in the article and easy to inspect.

Example:

```text
Murdered Reson Fergone while hunting. [p.45]
```

Opening evidence should expose:

- source document
- page/source location
- supporting excerpt

Repeated page numbers can be grouped for presentation, but distinct excerpts must not be discarded.

---

## 21. Campaign List

Users should be able to revisit processed campaigns easily.

Campaign cards should behave as primary navigation targets rather than requiring a small explicit `Open Wiki` link.

Campaign processing/failed states remain visible where relevant.

---

## 22. Extraction and Reconciliation Rules

The system should:

1. Extract structured candidate data.
2. Preserve source evidence.
3. Reconcile candidates globally.
4. Prefer incorrect non-merge over incorrect merge.
5. Preserve aliases.
6. Remap relationships to canonical entities.
7. Normalize inverse relationships.
8. Construct location hierarchy.
9. Assign campaign-level judgments such as prominence only after reconciliation.
10. Generate richer summaries only from available evidence.

Costly stages should be cacheable/replayable where practical.

Paid AI work must be measurable. Optional expensive enrichment must not become silently mandatory, and validated AI work should be reusable or resumable where practical. Provider failures must fail closed rather than silently switching to a paid provider. Cost controls never justify weakening provenance or player-safety rules.

---

## 23. Technical Direction

The product should favor a maintainable single-application architecture.

Current direction:

```text
Application:
Next.js / TypeScript

Database:
PostgreSQL / Supabase

File storage:
Supabase Storage

AI extraction:
OpenAI structured outputs

Deployment:
Vercel

Repository:
GitHub
```

Avoid unnecessary infrastructure.

A dedicated graph database is not required.

Do not introduce vector databases, microservices, or other infrastructure without a concrete product need.

---

## 24. Security and Deployment Principles

Secrets such as:

- OpenAI API keys
- Supabase service-role credentials

must remain server-side.

Public/read-only deployments must not accidentally expose campaign upload or paid AI operations when uploads are disabled.

Database permissions, RLS, and service-role grants should be explicit and migration-backed.

Provider credentials and endpoints are server-only. Development providers must be identifiable in diagnostics and must not replace canonical campaign output without an explicit acknowledgement.

---

## 25. Current Product Boundaries

The following are not assumed to exist merely because the data model may support them later:

- manual campaign editing
- manual fact creation
- manual merge/split
- per-player visibility
- party-specific ACLs
- full campaign-state history
- authenticated player accounts
- rich text editor
- universal timeline
- maps
- family-tree visualization
- relationship graph visualization
- character sheets
- dice/initiative/encounter tools
- VTT integrations
- external canon research

These can be introduced through future implementation plans when justified.

---

## 26. Future Campaign-State Direction

The product should leave room for a later living-campaign workflow where a GM can:

- reveal an entity to players
- reveal/hide individual facts
- add manual facts
- edit extracted facts
- provide manual-source provenance
- merge/split entities manually
- reclassify entities
- change faction Party Standing
- change quest status
- record evolving campaign state
- maintain an audit/history trail

These future features should build on the same canonical entities, facts, relationships, provenance, and visibility model rather than requiring duplicated player and DM databases.

## 27. Product Roadmap Direction

The roadmap is intentionally broad here. Version-specific scope and acceptance criteria belong in the current implementation plan.

- v0.4 focuses on lean, cost-efficient, reliable processing infrastructure.
- v0.5 focuses on editing, correction, visibility, and campaign-state maintenance.
- v0.6 focuses on a major UI and design overhaul.
- Later work includes authenticated player sharing, multi-document and incremental sources, backup/export/restore, and broader production hardening.

Current Player View is a preview/read mode, not secure authenticated authorization.

---

## 28. Product Documentation Hierarchy

`PRODUCT_SPEC.md` is the evergreen product specification.

It defines:

- product purpose
- enduring product principles
- conceptual information model
- current product behavior and boundaries

Version-specific implementation work belongs in the current implementation plan, for example:

```text
IMPLEMENTATION_PLAN_V0_3.md
```

The current implementation plan is authoritative for that sprint/version.

Older implementation plans are historical references only and should be consulted only when:

- the current plan explicitly requires historical context
- current code is ambiguous
- a regression requires understanding an older design decision

The current codebase is the source of truth for what is actually implemented.
