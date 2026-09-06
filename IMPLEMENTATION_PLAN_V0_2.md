# Campaign Wiki — Implementation Plan v0.2

## Purpose

This plan consolidates the issues discovered during the first real Demonplague import and defines the next implementation phase for Campaign Wiki.

The goal of v0.2 is to improve:

- development cost control
- entity identity and classification
- cross-type deduplication
- relationship normalization
- deity and enemy modeling
- recursive location hierarchy
- wiki readability and information density
- persistent campaign navigation
- regression coverage based on real campaign findings

This plan is intentionally milestone-based.

Codex should understand the whole roadmap, but implement **one milestone at a time**, stopping after each milestone for review.

Do not run the expensive real Demonplague PDF extraction during implementation unless explicitly instructed.

---

# Guiding Principles

## 1. Identity comes before type

The same campaign entity must not become multiple canonical entities merely because different chunks classify it differently.

Example:

```text
Xancrown — npc
Xancrown — other
```

should be reconciled as one identity with one canonical type.

Entity type is an attribute of identity, not part of identity itself.

---

## 2. Prefer false negatives over false merges

Campaign Wiki should remain conservative.

It is better to leave two uncertain candidates separate than to incorrectly merge two genuinely distinct campaign entities.

Confirmed example:

```text
Jeanas Clocker
Jesper Clocker
```

These are distinct NPCs — father and son — and must not be merged merely because their names are similar.

---

## 3. Roles are not entity types

`Enemy` is a role, not a fundamental entity type.

An enemy can be:

- an NPC
- a deity
- a faction
- another entity type

Do not create a duplicate entity merely to place something into an Enemies category.

---

## 4. Physical location containment is recursive

Locations should not be represented as one flat list.

Any Location may optionally exist inside another Location.

The hierarchy must support arbitrary depth:

```text
World
└── Country
    └── Village
        └── Tavern
            └── Basement
                └── Shrine
                    └── Altar
```

Do not hardcode levels such as country, city, building, room.

---

## 5. Source provenance remains first-class

All extracted claims should remain traceable to source evidence.

This includes:

- entity existence
- aliases
- relationships
- entity roles
- location containment
- reconciliation decisions where practical

Compact UI must not remove provenance.

---

## 6. No AI calls at render time

Wiki pages must render exclusively from persisted data.

Do not use OpenAI to rewrite prose dynamically when a page is viewed.

---

# Confirmed Findings From the First Real Import

These facts should become regression cases.

## Cross-type duplicates

The following are duplicate identities that survived because type was treated too rigidly:

```text
Cay Naja
npc + other
→ should become one canonical entity
```

```text
Xancrown
npc + other
→ should become one canonical entity
```

```text
Demonplague
The Demonplague
event + other
→ same campaign concept
```

```text
Gardong Marhold
npc + location
→ canonical type must be location
```

## Confirmed non-duplicate

```text
Jeanas Clocker
Jesper Clocker
```

These are father and son.

They must remain separate.

## Relationship duplication

The Colinus Birthwitch page revealed duplicated inverse facts, for example:

```text
uncle of Kylar Birthwitch
connected via nephew of Kylar Birthwitch
```

These are the same semantic relationship viewed from opposite directions.

The wiki should render one logical fact from the current entity's perspective.

## Location structure

Current extracted locations mix settlements, buildings, rooms, altars, laboratories, camps, etc. into a flat peer list.

Examples include:

- Tomar's Crossing
- Jorney's Tavern
- Ralekai's Laboratory
- Duladarin Star Elf Barrows
- Star Elf Barrows Altar
- Safeharbor
- Safeharbor Refugee Camp

The v0.2 model should support physical containment between them where source evidence supports it.

## Wiki density

Entity pages currently use too much vertical space because each relationship is rendered as:

- relationship label
- target
- description
- separate source expander

Sources are also rendered as large repeated cards.

The UI should become more compact and prose-oriented while preserving all data and traceability.

---

# Milestone 0 — Cost-Safe Development and Replay Foundation

## Goal

Make future development and debugging possible without repeatedly paying for full AI extraction.

This milestone must be completed first.

## Requirements

Investigate whether raw extraction outputs or candidate entities are currently persisted.

If raw candidate extraction data is already stored, build a replay path that can rerun later pipeline stages without repeating PDF extraction or AI extraction.

Desired replay pipeline:

```text
saved candidate extraction
→ aggregation
→ reconciliation
→ canonical entity construction
→ relationship resolution
→ location hierarchy
→ persistence
→ wiki
```

If raw candidate extraction is **not** currently persisted:

1. add persistence/cache support for future imports
2. do not rerun the Demonplague PDF simply to populate the cache
3. clearly document that the existing campaign cannot be replayed from raw candidates if the data was never stored

## Separate model configuration

Introduce:

```env
OPENAI_EXTRACTION_MODEL=
OPENAI_RECONCILIATION_MODEL=
```

The current `OPENAI_MODEL` may remain as a fallback for backward compatibility.

Do not break existing local configuration unnecessarily.

## Usage and cost diagnostics

Record, per processing run where available:

- model used
- number of API calls
- input tokens
- cached input tokens
- output tokens
- estimated cost
- stage using the model

Keep this in development/admin diagnostics, not normal end-user wiki UI.

## Acceptance Criteria

- UI changes do not require another AI extraction.
- Database changes do not require another AI extraction.
- Relationship logic changes do not require another AI extraction.
- Hierarchy changes do not require another AI extraction.
- The project has a documented replay workflow where technically possible.
- No real Demonplague extraction is run during this milestone.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 1 — Entity Ontology: Deities and Roles

## Goal

Improve the entity model before changing reconciliation logic.

## Add Deity as a true entity type

Supported entity types become:

```text
npc
deity
location
faction
item
event
quest
other
```

A deity should not be forced into NPC merely because it has:

- a name
- personality
- goals
- speech
- agency
- worshippers
- relationships

However, do not classify every supernatural entity as a deity.

Examples such as demons, monsters, undead, spirits, etc. remain NPC or Other unless source evidence clearly presents them as a god/deity.

## Update all affected layers

Update:

- PostgreSQL enum/schema
- Supabase migrations
- service-role grants as needed
- TypeScript types
- Zod schemas
- OpenAI structured output schemas
- extraction prompts
- reconciliation prompts
- category handling
- navigation
- search
- wiki UI
- tests

## Add entity roles

Do **not** add `enemy` as an entity type.

Introduce an extensible role mechanism.

Minimum required role:

```text
enemy
```

A reasonable shape is:

```ts
type EntityRole = "enemy";
```

and:

```ts
roles: EntityRole[];
```

Equivalent relational storage is acceptable if cleaner.

The implementation should allow more roles later without another fundamental schema redesign.

Possible future roles may include:

- ally
- rival
- patron
- quest_giver

Do not implement those yet unless needed structurally.

## Enemy inference

Do not label an entity as `enemy` merely because it participates in one fight.

Use `enemy` when the source clearly presents the entity as:

- hostile antagonist
- recurring adversary
- villain
- hostile faction
- major enemy
- hostile creature/person with clear adversarial role

Preserve source grounding where practical.

## UI

Add:

- Deities category
- Enemies view

Enemies is a filtered view across entity types.

Examples:

```text
Xancrown        deity / enemy
Merriath        npc / enemy
Cult of Chaos   faction / enemy
```

Each remains one canonical entity.

Entity pages should show an `Enemy` badge when applicable.

## Acceptance Criteria

- `deity` is a valid entity type everywhere.
- Enemy is represented as a role, not duplicate identity.
- Enemies view can include multiple underlying entity types.
- Existing entity types remain functional.
- No real Demonplague extraction is run.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 2 — Cross-Type Entity Reconciliation

## Goal

Fix the systematic duplicate-identity problem discovered in the real import.

## Current problem

Current reconciliation behavior effectively treats:

```text
npc:xancrown
other:xancrown
```

as different identities.

Cross-type reconciliation proposals are also rejected.

This makes some duplicate identities impossible to merge even when source context is clear.

## New principle

Entity identity is independent from type.

Type is selected during canonical reconciliation.

## Deterministic behavior

### Same normalized identity + same type

Continue deterministic merge behavior.

### Same normalized identity or explicit alias + different types

Create a cross-type reconciliation candidate.

Do not automatically merge.

Allow reconciliation to inspect:

- names
- aliases
- summaries
- source passages
- page numbers
- candidate types

and decide whether they represent the same entity.

### Similar but non-identical names

Do not merge based only on fuzzy string similarity.

Require strong contextual evidence.

Confirmed regression example:

```text
Jeanas Clocker
Jesper Clocker
```

must remain separate.

## Canonical type selection

Reconciliation must explicitly choose the canonical type.

Valid types:

```text
npc
deity
location
faction
item
event
quest
other
```

`other` should generally behave as a weak/fallback classification when stronger evidence supports a more specific type.

Do not implement a simplistic blind priority that overrides source context.

## Confirmed regression cases

Add tests for:

### Xancrown

```text
Xancrown / npc
Xancrown / other
→ one canonical entity
```

### Cay Naja

```text
Cay Naja / npc
Cay Naja / other
→ one canonical entity
```

### Demonplague

```text
Demonplague / event
The Demonplague / other
→ one canonical entity when evidence supports identity
```

### Gardong Marhold

```text
Gardong Marhold / npc
Gardong Marhold / location
→ one canonical entity
→ canonical type: location
```

### Jeanas and Jesper

```text
Jeanas Clocker
Jesper Clocker
→ remain separate
```

## Relationship remapping

When multiple candidates reconcile into one canonical entity:

- every relationship endpoint must remap to the canonical entity
- source evidence must survive
- aliases must survive
- duplicate relationships caused by the merge should be handled safely

## Database review

Review uniqueness constraints.

Do not make unnecessary schema changes if the current canonical persistence model can support the desired result.

If a migration is required, create it normally.

Do not patch only the remote database.

## Acceptance Criteria

- Cross-type duplicates can reconcile.
- Canonical type is chosen during reconciliation.
- Similar names are not automatically merged.
- Relationships remap correctly after merge.
- No duplicate canonical entity survives from a successful cross-type merge.
- No real Demonplague extraction is run.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 3 — Relationship Normalization and Inverse Deduplication

## Goal

Represent one logical campaign fact once while rendering it naturally from either entity's page.

## Problem

Current pages can display semantic duplicates such as:

```text
Colinus — uncle_of → Kylar
Kylar — nephew_of → Colinus
```

as two separate relationship entries on the same page.

This creates noise and wastes space.

## Desired model

Store or resolve one logical canonical fact where practical.

Example:

```text
Colinus --uncle_of--> Kylar
```

Render from Colinus:

```text
Uncle of Kylar Birthwitch.
```

Render from Kylar:

```text
Nephew of Colinus Birthwitch.
```

## Canonical inverse relationships

Support known inverse pairs where useful.

Examples:

```text
parent_of / child_of
uncle_of / nephew_of
uncle_of / niece_of
owns / owned_by
member_of / has_member
located_in / contains
serves_on / has_member
```

Do not attempt to create a giant ontology for every possible relationship verb.

Freeform relationships must remain supported.

## Semantic deduplication

Where multiple extracted relationships encode the same logical fact in different language, consolidate them conservatively.

Preserve:

- source evidence from all supported forms
- relationship descriptions where useful
- direction
- confidence/metadata

Prefer leaving uncertain duplicates separate over collapsing unrelated facts.

## Rendering rule

The same semantic fact should normally appear once on an entity page.

Do not show both direct and inverse wording on the same page.

## Acceptance Criteria

- Known inverse relationships render once.
- Source evidence from both directions survives.
- The relationship remains navigable from both entity pages.
- Freeform unsupported relationships still work.
- No real Demonplague extraction is run.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 4 — Recursive Location Hierarchy

## Goal

Turn the flat location list into a source-backed recursive containment hierarchy.

## Core model

Any Location may optionally have one parent Location.

Conceptually:

```ts
Location {
  id
  parentLocationId?: string
}
```

The implementation may use the relationship graph as the authoritative source instead if that produces a cleaner design.

Avoid two competing sources of truth that can drift silently.

## Unlimited recursion

Support:

```text
continent
→ kingdom
→ province
→ city
→ district
→ building
→ tower
→ room
→ secret chamber
```

No schema changes should be required for deeper levels.

## Containment semantics

Use containment only for actual physical nesting.

Examples that qualify:

```text
Tavern located_in Village
Basement located_in Tavern
Altar located_in Basement
```

Do not convert these into hierarchy:

```text
near
owned_by
controlled_by
visited
attacked
originated_from
travelled_to
```

## Extraction/reconciliation

Detect explicit or strongly supported physical containment.

Example:

```text
"The Weary Traveler is an inn in Tomar's Crossing."
```

supports:

```text
The Weary Traveler
located_in
Tomar's Crossing
```

Do not infer containment just because locations are mentioned near each other.

## Parent ambiguity

A location should normally have one canonical physical parent.

If evidence is unclear:

```text
parent = none
```

Prefer missing hierarchy over wrong hierarchy.

## Cycle prevention

Reject cycles such as:

```text
A → B → C → A
```

Protect against cycles in:

- graph construction
- persistence
- recursive traversal
- UI rendering

## Hierarchy versus identity

Containment does not imply identity.

Examples:

```text
Safeharbor
Safeharbor Refugee Camp
```

must remain separate even if one is physically inside or adjacent to the other.

Likewise, proximity is not a merge signal by itself.

## Source provenance

Containment must retain supporting source evidence and page number.

## Acceptance Criteria

Test at least:

```text
Kingdom
└── Village
    └── Tavern
        └── Basement
            └── Altar
```

Verify:

- correct parent lookup
- child lookup
- recursive descendants
- top-level location detection
- breadcrumb construction
- arbitrary depth
- cycle rejection
- orphan locations remain valid
- search finds any depth
- ordinary relationships survive hierarchy construction

No real Demonplague extraction is run.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 5 — Compact Wiki Entity UX

## Goal

Make entity pages feel like a finished campaign wiki rather than a knowledge-graph debugging interface.

This is primarily a presentation refactor.

Do not change data semantics unnecessarily.

## Current issue

A relationship currently consumes excessive vertical space:

```text
relationship label + target
description
source expander
```

This repeats the same fact in multiple forms.

## Desired direction

Use compact prose-oriented connections.

Example:

```text
Colinus Birthwitch
NPC

Councilmember and hunter who murdered his political rival Reson Fergone.

Connections

Serves on the Village Council. [p.27]
Bjalien Viadas blackmails him over Reson's murder. [p.45]
Murdered Reson Fergone while hunting. [p.45]
Brutus is his loyal mastiff. [p.35]
Uncle of Kylar Birthwitch. [p.69]
Makes his arrows using Black Arrowheads. [p.72]
```

Entity names remain clickable.

The page indicator should expose the source evidence.

Do not use AI to generate these lines at render time.

Use existing stored relationship descriptions and metadata.

## Source indicators

Compact source controls such as:

```text
[p.45]
```

or equivalent are preferred.

Clicking or expanding should reveal:

- document
- page
- supporting excerpt

## Sources section

Replace repeated large source cards with grouped document/page summaries.

Example:

```text
Sources

The Demonplague Part I 2018-1014.pdf
Pages 27 · 35 · 45 · 69 · 72
```

Deduplicate repeated page numbers in the summary.

Retain all individual evidence excerpts internally.

## Desktop layout

Use available horizontal space.

Recommended direction:

```text
┌──────────────────────────────────┬────────────────────┐
│ Main article                     │ Related            │
│                                  │                    │
│ Name / type / roles              │ Key entities       │
│ Summary                          │                    │
│ Connections                      │ Sources            │
│                                  │ Page links         │
└──────────────────────────────────┴────────────────────┘
```

On mobile, stack sections vertically.

## Preserve

The redesign must preserve:

- entity type
- roles
- name
- aliases
- summary
- all relationships
- relationship direction
- clickable related entities
- source provenance
- supporting excerpts

## Acceptance Criteria

- Entity page height is materially reduced.
- Relationships normally occupy one concise line/row each.
- Inverse duplicates are not rendered twice.
- Source evidence remains accessible.
- Sources are grouped compactly.
- No OpenAI call occurs during rendering.
- No real Demonplague extraction is run.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 6 — Location-Specific Wiki UX and Campaign Navigation

## Goal

Expose recursive location structure directly in the wiki.

## Campaign home

Do not dump all buildings, rooms, and settlements into one flat preview.

Show top-level locations first.

Example:

```text
Locations

Tomar's Crossing
7 sublocations

Safeharbor
4 sublocations

Ice Tongue Glacier

Maragath's Prize
3 sublocations
```

Do not fully expand large trees on the campaign homepage.

## Locations category page

Render an expandable/nested tree.

Example:

```text
Tomar's Crossing
├── Jorney's Tavern
├── Temple of Long Life
├── Stronghammer's
└── Councilmember Kadra Tourmaline's Home

Duladarin Star Elf Barrows
└── Ritual Chamber
    └── Star Elf Barrows Altar
```

Support arbitrary recursion.

Deep branches may collapse by default if needed for usability.

## Individual location page

Display containment context prominently.

Example:

```text
Star Elf Barrows Altar

Location

World > Lunar Valley > Duladarin Star Elf Barrows > Star Elf Barrows Altar
```

Each breadcrumb is clickable.

Show immediate children:

```text
Sublocations
- Ritual Chamber
- Crypt
```

Do not render the entire world tree on every page.

## Category/navigation set

Campaign overview should support:

```text
NPCs
Deities
Locations
Factions
Items
Events
Quests
Enemies
Other
```

Enemies is a filtered role view, not an entity type.

## Existing campaign navigation

Preserve and improve:

- Campaigns/home link
- existing campaign list
- search
- direct wiki revisiting
- read-only Vercel mode

## Deployment safety

Local development:

```env
ALLOW_CAMPAIGN_UPLOADS=true
```

Vercel production/preview:

```env
ALLOW_CAMPAIGN_UPLOADS=false
```

Browsing existing campaigns must not require an OpenAI key.

## Acceptance Criteria

- Top-level location preview works.
- Recursive Locations page works.
- Breadcrumbs work.
- Sublocations work.
- Search finds nested locations.
- Deities and Enemies appear in navigation.
- Existing campaign browsing remains intact.
- Read-only Vercel remains safe.
- No real Demonplague extraction is run.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 7 — Regression and Replay Evaluation

## Goal

Validate v0.2 using deterministic fixtures and replayable data before paying for another real extraction.

## Permanent regression truths

Encode these:

```text
Cay Naja duplicate → merge
Xancrown duplicate → merge
Demonplague / The Demonplague → merge when evidence supports it
Gardong Marhold → location
Jeanas Clocker != Jesper Clocker
```

## Relationship cases

Include inverse rendering/deduplication.

Example:

```text
Colinus uncle_of Kylar
```

should render once on Colinus and once from the inverse perspective on Kylar.

## Location hierarchy fixture

Use:

```text
Kingdom
→ Village
→ Tavern
→ Basement
→ Altar
```

Test:

- parent
- child
- descendants
- breadcrumbs
- top-level
- search
- cycle rejection
- arbitrary depth

## Role cases

Verify:

```text
NPC + enemy
→ one NPC entity with enemy role
```

```text
Faction + enemy
→ one Faction entity with enemy role
```

```text
Deity + enemy
→ one Deity entity with enemy role
```

## Replay

If saved real candidate data is available, replay the Demonplague post-extraction pipeline without repeating paid extraction.

If it is not available, state this clearly and do not trigger a new extraction.

## Acceptance Criteria

- Regression suite is deterministic.
- No live API credentials are required for the majority of tests.
- Replay uses no extraction API calls.
- The known real-world mistakes are explicitly covered.

## Verification

Run:

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Commit separately.

---

# Milestone 8 — Final Real-World Benchmark

## Goal

Run exactly one new real Demonplague import after v0.2 is stable.

Do not do this until all earlier milestones are complete and reviewed.

## Preserve the current baseline

Do not overwrite the existing imported campaign.

Treat:

```text
Test 2
```

as the v0.1 baseline.

Create a new campaign for v0.2, for example:

```text
Test 3
```

## Model/cost experiment

If model configuration now supports separate models, test the chosen cheaper extraction strategy deliberately.

Do not casually run multiple full imports.

Record:

- model(s)
- API usage
- total cost
- runtime

## Manual evaluation

Compare v0.2 against the baseline on:

### Entity quality

- major entities present
- unnecessary entities
- missing entities
- duplicate entities
- wrong merges
- wrong type assignments
- deity classification
- enemy role classification

### Relationships

- correct relationships
- missing relationships
- duplicated inverse relationships
- bad endpoints
- source support

### Locations

- correct parent hierarchy
- missing parent relationships
- incorrect containment
- useful breadcrumbs

### Source fidelity

- cited page supports the claim
- excerpt supports the claim
- no hallucinated relationship/source

### Wiki usability

- page density
- navigation
- source inspection
- relationship readability
- location browsing

## Acceptance

The v0.2 benchmark should be judged against the v0.1 baseline, not merely in isolation.

---

# Milestone Execution Rules for Codex

Codex should always read:

1. `PRODUCT_SPEC.md`
2. `IMPLEMENTATION_PLAN.md`
3. `IMPLEMENTATION_PLAN_V0_2.md`

Interpret them as:

- `PRODUCT_SPEC.md` = product purpose and v0 foundation
- `IMPLEMENTATION_PLAN.md` = original implementation architecture
- `IMPLEMENTATION_PLAN_V0_2.md` = current improvement roadmap and priority

If any conflict exists, v0.2 should govern the improvements unless it contradicts a hard product constraint.

## Implement one milestone per task

For each task:

1. implement the requested milestone only
2. do not begin later milestones
3. avoid unrelated refactors
4. create migrations normally where needed
5. preserve source provenance
6. do not run real Demonplague extraction
7. run all required verification
8. summarize changes and risks
9. stop for review

## Required verification after every milestone

```text
npm run lint
npm run typecheck
npm test
npm run build
```

Fix regressions before declaring the milestone complete.

## Git discipline

Prefer one reviewable commit per milestone.

Do not bundle several milestones into one large commit unless explicitly instructed.

---

# Definition of v0.2 Complete

v0.2 is complete when:

- cost-safe replay/development exists where technically possible
- Deity is a supported entity type
- Enemy is an entity role, not an entity type
- cross-type duplicates can reconcile safely
- confirmed non-duplicates remain separate
- relationships do not render redundant inverse facts
- physical location hierarchy supports arbitrary recursion
- hierarchy is source-backed and cycle-safe
- entity pages are compact and prose-oriented
- sources remain easy to inspect
- campaign navigation supports Deities and Enemies
- location pages expose breadcrumbs and sublocations
- all deterministic regression tests pass
- one final real-world benchmark has been completed and compared to the v0.1 baseline
