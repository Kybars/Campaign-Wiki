# Campaign Wiki — Product Specification v0

## 1. Product Summary

Campaign Wiki converts an existing tabletop RPG campaign PDF into an automatically generated, interconnected wiki.

The user uploads a PDF containing campaign notes, session summaries, setting information, NPC descriptions, adventure material, or similar campaign content.

The system:

1. Extracts the text from the PDF.
2. Identifies important campaign entities.
3. Identifies relationships between those entities.
4. Deduplicates repeated references to the same entity.
5. Stores the entities and relationships in a structured form.
6. Generates wiki-style pages for every entity.
7. Automatically cross-links related entities.
8. Shows the original PDF page(s) supporting extracted information.

The core value proposition is:

> **Upload your campaign. Get an interconnected campaign wiki automatically.**

---

# 2. Goal of v0

The purpose of v0 is to test one central hypothesis:

> Can AI reliably transform a messy campaign PDF into an interconnected wiki that is useful to a Game Master?

v0 is a proof of concept, not a complete campaign-management platform.

Success means a user can upload a real campaign PDF and browse the resulting entities and relationships without manually organizing the campaign first.

---

# 3. Core User Flow

## Step 1 — Upload PDF

The landing page contains:

- Campaign name field
- PDF upload field
- `Generate Wiki` button

Only one PDF is required for v0.

Example:

```text
Campaign Name
[Demonplague]

Campaign PDF
[demonplague_notes.pdf]

[ Generate Wiki ]
```

---

## Step 2 — Process PDF

After upload, the application shows a processing screen.

Example:

```text
Building your campaign wiki...

✓ PDF uploaded
✓ Text extracted
✓ 163 pages processed
✓ Entities identified
✓ Relationships identified
✓ Duplicate entities merged
✓ Wiki generated
```

Exact progress percentages are not required for v0.

A simple loading state is acceptable.

---

## Step 3 — Campaign Wiki Home

Once processing finishes, the user lands on the campaign home page.

Example:

```text
DEMONPLAGUE

143 entities discovered

NPCs            51
Locations       32
Factions        11
Items           18
Events          22
Quests           6
Other            3

[ Search campaign... ]
```

Below this, display all entities grouped by type.

Each entity name links to its wiki page.

---

## Step 4 — Entity Page

Every extracted entity receives its own wiki-style page.

Example:

# Ralekai

**Type:** NPC

Ralekai is an undead scientist researching a cure for the Demonplague.

## Relationships

**Soul Stone**  
Needs an empty Soul Stone to continue his research.

**Xancrown**  
Researching a cure for the plague caused by Xancrown.

**Tomar's Crossing**  
Has worked with the party in Tomar's Crossing.

## Sources

- Campaign Notes — page 73
- Campaign Notes — page 91
- Campaign Notes — page 124

All related entity names must be clickable.

Clicking `Soul Stone` opens the Soul Stone wiki page.

---

# 4. Entity Types

v0 should recognize the following entity types:

### NPC

Named non-player characters.

Examples:

- Lord Harren
- Ralekai
- Meriath the Quick

---

### Location

Physical places at any scale.

Examples:

- Tomar's Crossing
- Safeharbor
- Old Mine
- Kingdom of Eldoria

---

### Faction

Organizations, groups, governments, cults, guilds, armies, etc.

Examples:

- Red Hand
- King's Guard
- Cult of Ash

---

### Item

Important named objects.

Includes magical and non-magical objects when narratively significant.

Examples:

- Soul Stone
- Crown of the Fire Giants
- Sword of Dawn

---

### Event

Important past or current events.

Examples:

- Battle of Safeharbor
- Fall of Blackstone
- Edric's Disappearance

Events should only become standalone entities when they appear to be narratively significant.

---

### Quest

Explicit missions, goals, investigations, or unresolved objectives.

Examples:

- Find the Soul Stone
- Rescue the Frost Giant Princess

Do not create a Quest entity for every casual character intention.

---

### Other

Used when an important named campaign concept does not fit another category.

Examples could include:

- Demonplague
- Ancient ritual
- Prophecy
- Unique magical phenomenon

Use `Other` sparingly.

---

# 5. Entity Data Model

Each entity should contain at minimum:

```text
id
campaign_id
name
type
aliases
summary
created_at
```

Recommended conceptual structure:

```json
{
  "name": "Ralekai",
  "type": "npc",
  "aliases": [],
  "summary": "An undead scientist researching a cure for the Demonplague."
}
```

The AI must not invent information merely to populate fields.

If information is unknown, omit it.

---

# 6. Relationships

Relationships are the most important feature in v0.

The system should identify meaningful connections between entities.

Examples:

```text
Ralekai
    needs
Soul Stone
```

```text
Ralekai
    researching cure for
Demonplague
```

```text
Lord Harren
    member of
Red Hand
```

```text
Old Mine
    located near
Greymoor
```

```text
Meriath
    killed
Dragon Sorcerer
```

---

# 7. Relationship Data Model

Each relationship should contain:

```text
id
campaign_id
source_entity_id
target_entity_id
relationship_type
description
source_reference
confidence
```

Example:

```json
{
  "source": "Ralekai",
  "target": "Soul Stone",
  "relationship_type": "needs",
  "description": "Ralekai needs an empty Soul Stone to continue his research.",
  "source_page": 73,
  "confidence": 0.94
}
```

Relationship types do not need to come from a fixed global list in v0.

Natural-language labels such as these are acceptable:

```text
member of
enemy of
sibling of
located in
created by
needs
killed
serves
investigating
allied with
rules
visited
owns
```

---

# 8. Bidirectional Wiki Relationships

A relationship must appear on the pages of both connected entities.

For:

```text
Ralekai → needs → Soul Stone
```

Ralekai's page should show:

```text
Soul Stone
Needs an empty Soul Stone.
```

The Soul Stone page should also show:

```text
Ralekai
Needed by Ralekai for his research.
```

The application should not store these as two independent relationships.

Store one relationship and render it from both directions.

Whenever possible, generate a readable description appropriate to each side.

---

# 9. Source Traceability

Every extracted entity and relationship must retain references to the original PDF.

At minimum store:

```text
document
page_number
supporting_text
```

Example:

```text
Source:
Campaign Notes.pdf
Page 73

"Ralekai tells the party that an empty Soul Stone
may allow him to complete the cure."
```

The full supporting quote does not have to appear prominently on the wiki page.

It should be accessible through the Sources section or a source-details control.

This serves two purposes:

1. The user can verify AI-generated information.
2. Extraction errors can later be diagnosed.

The application must never create unsupported campaign facts intentionally.

---

# 10. PDF Processing

v0 supports:

- text-based PDFs
- PDFs containing selectable/extractable text

v0 does NOT need to support:

- scanned handwritten notes
- image-only PDFs
- OCR
- photographs of notes

If usable text cannot be extracted, display an error explaining that v0 currently supports text-based PDFs only.

Page boundaries must be preserved so extracted information can refer back to its original page number.

---

# 11. Extraction Pipeline

The expected conceptual pipeline is:

```text
PDF upload
      ↓
Extract text per page
      ↓
Split into manageable chunks
      ↓
Extract candidate entities
      ↓
Extract candidate relationships
      ↓
Global entity reconciliation
      ↓
Merge duplicates / aliases
      ↓
Reconnect relationships to canonical entities
      ↓
Store entities
      ↓
Store relationships
      ↓
Generate wiki
```

---

# 12. Entity Extraction

AI extraction should return structured data rather than free-form prose.

For each detected entity return:

```json
{
  "temporary_id": "npc_14",
  "name": "Ralekai",
  "type": "npc",
  "aliases": [],
  "summary": "An undead scientist researching a cure.",
  "source_pages": [73, 91]
}
```

The system should favor precision over extracting every possible noun.

Do not create entities for:

- unnamed villagers
- generic guards
- every sword
- every tavern unless narratively relevant
- common monsters without individual significance
- ordinary objects
- generic concepts

A useful wiki with 100 meaningful entities is preferable to one containing 1,000 irrelevant entities.

---

# 13. Duplicate Resolution

The same entity may appear many times throughout the PDF.

These references must be reconciled.

Example:

```text
Ralekai
Ralekai the Scientist
the undead scientist
```

may all refer to the same NPC.

The system should attempt to merge obvious duplicates.

Aliases should be retained where useful.

Example:

```json
{
  "name": "Ralekai",
  "aliases": [
    "Ralekai the Scientist"
  ]
}
```

When uncertain whether two entities are the same, prefer keeping them separate rather than incorrectly merging them.

---

# 14. Cross-Chunk Reconciliation

Because large PDFs will require multiple AI extraction calls, entity identity cannot depend only on individual chunks.

After the complete document has been processed, perform a reconciliation step across all discovered entities.

The reconciliation step should:

1. Find likely duplicates.
2. Select a canonical name.
3. Merge aliases.
4. Merge source references.
5. Update relationships to reference the canonical entity.

This is required for v0.

Without global reconciliation, the resulting wiki will become fragmented.

---

# 15. Wiki Navigation

The wiki requires three basic navigation mechanisms.

## Campaign home

Shows:

- campaign name
- entity counts
- entities grouped by category
- search

---

## Category pages

Example:

```text
NPCs

Ralekai
Meriath the Quick
Feriae the Wise
Lord Harren
...
```

Each item links to its entity page.

---

## Entity links

Whenever one entity appears in another entity's Relationships section, it must be clickable.

---

# 16. Search

v0 should provide simple text search.

Search against at least:

- entity name
- aliases

Searching:

```text
ralek
```

should return:

```text
Ralekai — NPC
```

Semantic/AI search is explicitly NOT required for v0.

---

# 17. Screens Required

Only four primary screens are required.

## Screen 1 — Upload

```text
Campaign Wiki

Turn your campaign PDF into an interconnected wiki.

Campaign name
[________________]

Campaign PDF
[ Choose file ]

[ Generate Wiki ]
```

---

## Screen 2 — Processing

```text
Creating your campaign wiki...

Processing Campaign Notes.pdf

[ loading indicator ]
```

---

## Screen 3 — Campaign Home

```text
DEMONPLAGUE

143 entities

Search...

NPCs
51

Locations
32

Items
18

...

Recently discovered / entity list
```

---

## Screen 4 — Entity Page

```text
RALEKAI

NPC

An undead scientist researching a cure for
the Demonplague.

RELATIONSHIPS

Soul Stone →
Needs an empty Soul Stone.

Demonplague →
Researching a cure.

Tomar's Crossing →
Worked with the party here.

SOURCES

Campaign Notes.pdf — p.73
Campaign Notes.pdf — p.91
```

Design should prioritize readability over visual complexity.

---

# 18. Data Model

A relational database is sufficient.

A dedicated graph database is not required.

Minimum tables:

```text
campaigns
documents
entities
entity_sources
relationships
relationship_sources
```

Conceptually:

```text
CAMPAIGN
   │
   ├── DOCUMENT
   │
   ├── ENTITY
   │      │
   │      └── ENTITY_SOURCE
   │
   └── RELATIONSHIP
          │
          └── RELATIONSHIP_SOURCE
```

---

# 19. Suggested Technical Stack

The prototype should optimize for development speed and maintainability.

Suggested stack:

```text
Application:
Next.js
TypeScript

Database:
PostgreSQL / Supabase

File storage:
Supabase Storage or equivalent

AI extraction:
OpenAI API using structured outputs

Deployment:
Vercel

Repository:
GitHub
```

These are recommendations rather than hard product requirements.

Avoid unnecessary infrastructure.

In particular:

- no Neo4j
- no vector database
- no microservices
- no separate frontend/backend repositories

A single application is preferable for v0.

---

# 20. Error Handling

The application should gracefully handle at least:

### Invalid file

```text
Please upload a PDF.
```

### PDF has no extractable text

```text
We couldn't extract readable text from this PDF.

Campaign Wiki v0 currently supports text-based PDFs only.
```

### AI processing failure

```text
We couldn't finish processing this campaign.

Please try again.
```

Detailed developer errors may be logged separately.

---

# 21. Out of Scope for v0

Do NOT implement the following yet:

- user accounts
- multiple users
- DM/player roles
- secret information
- progressive information reveals
- manual entity creation
- manual relationship creation
- rich text editor
- AI campaign chat
- question answering
- campaign timeline
- maps
- family trees
- relationship graph visualization
- image generation
- character sheets
- stat blocks
- dice rolling
- initiative tracking
- encounter building
- VTT integration
- Discord integration
- Google Docs integration
- Notion integration
- Obsidian integration
- multiple uploaded campaign documents
- OCR
- handwritten-note recognition
- automatic web research

If one of these becomes necessary while implementing v0, reconsider whether it is actually required before adding it.

---

# 22. Important AI Behaviour Rules

The extraction system should follow these principles:

### Do not invent campaign lore

Only extract information supported by the uploaded document.

---

### Prefer meaningful entities

Do not convert every named noun into an entity.

---

### Preserve uncertainty

If the document is ambiguous, do not pretend certainty.

---

### Prefer false negatives over false positives

Missing a minor relationship is less damaging than inventing one.

---

### Preserve sources

Every important extracted claim should be traceable to the PDF.

---

### Do not apply outside canon

The system must treat the uploaded document as the campaign's source of truth.

For example, if the PDF mentions:

```text
Waterdeep
```

the AI should not add Forgotten Realms lore unless that information exists in the uploaded document.

---

# 23. Example Input

PDF contains:

```text
The heroes returned to Greymoor where they met Hanna Stone,
the owner of the Silver Stag Inn.

Hanna explained that her brother Edric disappeared three
weeks ago while investigating the abandoned Old Mine.

Unknown to Hanna, Edric had discovered that the Cult of Ash
was operating beneath the mine.
```

---

# 24. Expected Extraction

Entities:

```text
Greymoor
Type: Location

Hanna Stone
Type: NPC

Silver Stag Inn
Type: Location

Edric Stone
Type: NPC

Old Mine
Type: Location

Cult of Ash
Type: Faction
```

Relationships:

```text
Hanna Stone
    lives/works in
Greymoor

Hanna Stone
    owns
Silver Stag Inn

Hanna Stone
    sibling of
Edric Stone

Edric Stone
    disappeared near/in
Old Mine

Edric Stone
    investigating
Old Mine

Cult of Ash
    operating beneath
Old Mine
```

Each relationship should include the source page supporting it.

---

# 25. Acceptance Criteria

v0 is considered functionally complete when the following scenario works.

Given a text-based campaign PDF containing multiple NPCs, locations, items, factions and events:

### Upload

- User can create a campaign name.
- User can upload one PDF.
- Application stores the PDF.
- Application extracts its text while preserving page numbers.

### Extraction

- Application extracts multiple entity types.
- Application extracts relationships between entities.
- Repeated mentions of the same obvious entity are merged.
- Relationships survive the deduplication process.
- Entities and relationships retain source-page references.

### Wiki

- Campaign home displays extracted entities.
- Entities are grouped by type.
- Clicking an entity opens its page.
- Entity page shows its summary.
- Entity page shows relationships.
- Related entities are clickable.
- Relationships appear from both connected entity pages.
- Source page numbers are visible.

### Search

- User can search entities by name.
- Search result links to the corresponding wiki page.

### Quality

For a manually reviewed test campaign:

- major recurring NPCs should normally be detected
- major named locations should normally be detected
- major named items/factions should normally be detected
- obvious explicitly stated relationships should normally be detected
- the system should not routinely invent unsupported entities or relationships

Perfect extraction is NOT required for v0.

The prototype must instead demonstrate that the resulting wiki is meaningfully useful.

---

# 26. Primary Prototype Test

The first serious test should use a real campaign PDF rather than a specially prepared demo document.

After processing, evaluate:

```text
1. What important entities did it miss?

2. What irrelevant entities did it create?

3. Which duplicates did it fail to merge?

4. Which entities did it incorrectly merge?

5. Which important relationships did it miss?

6. Which relationships did it invent?

7. Are the generated summaries accurate?

8. Are the source references correct?

9. Can a GM find information faster using the wiki
   than by searching the original PDF?

10. Does browsing relationships reveal useful connections
    the GM may otherwise have forgotten?
```

These results should determine the priorities for v0.1.

---

# 27. Definition of Success

Do not judge the prototype primarily by visual polish.

The prototype succeeds if the first real campaign upload produces the reaction:

> **“This actually understands my campaign.”**

Specifically, a GM should be able to open an NPC page, see who and what that NPC is connected to, follow those links through the campaign, and trace the information back to the original source.

If that experience works, subsequent features can be built on top of the same knowledge model.

If that experience does not work, adding more campaign-management features will not fix the core product.