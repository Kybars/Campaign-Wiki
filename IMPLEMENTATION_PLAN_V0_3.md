# Campaign Wiki — v0.3 Implementation Plan

## Sprint Theme

**Rich, source-backed campaign articles with progressive knowledge visibility and cleaner navigation.**

v0.3 should turn the current canonical entity graph into a more useful GM-facing campaign encyclopedia while laying the database/read-model foundation for future player-facing campaign state.

The central rule for v0.3 is:

> **Every displayed fact must be source-backed, and every knowledge unit must be capable of being hidden from or shown to players.**

The v0.3 sprint should be completed without another full Demonplague extraction until the final acceptance benchmark.

---

# Document Authority and Inherited Architecture

This is the authoritative implementation roadmap for the v0.3 sprint.

Documentation hierarchy:

1. `PRODUCT_SPEC.md` — evergreen product model and enduring constraints.
2. `IMPLEMENTATION_PLAN_V0_3.md` — authoritative v0.3 sprint scope and sequencing.
3. Current codebase — source of truth for what is actually implemented.
4. Older implementation plans — historical references only.

Older plans should not be read by default during each milestone. Consult them only when:

- this plan explicitly requires historical context,
- current code is genuinely ambiguous,
- or a regression requires understanding an older design decision.

v0.3 inherits and must preserve the implemented architecture already present in the codebase, including:

- canonical global entity reconciliation
- Deity as an entity type
- Enemy as a role rather than an entity type
- cross-type reconciliation
- one logical stored relationship with bidirectional presentation
- inverse relationship normalization/deduplication
- recursive physical location hierarchy with cycle protection
- source provenance
- replay/cache and cost-safe development support
- compact wiki entity presentation
- changelog/version infrastructure
- campaign list/revisit behavior
- Vercel read-only upload protection
- Supabase RLS/service-role security

When details of an inherited subsystem matter, inspect the current implementation first rather than treating a historical plan as current truth.

---

# 1. Goals

v0.3 should:

1. Extract richer, type-specific information from campaign source material.
2. Keep every extracted fact tied to explicit source evidence.
3. Assign every canonical entity a universal campaign-relative prominence:
   - Major
   - Supporting
   - Minor
4. Introduce DM-only vs Player-visible knowledge architecture at:
   - entity level
   - fact level
   - relationship level
5. Provide separate source-derived GM and Player summaries where appropriate.
6. Support a DM View / Player View preview toggle so visibility behavior can be tested.
7. Render richer articles without empty sections or database-like duplication.
8. Make campaign browsing more concise through prominence-aware expandable categories.
9. Improve navigation with:
   - sticky header
   - active section state
   - current campaign home link
   - clearly separated All Campaigns navigation
   - integrated always-visible campaign search
10. Make campaign cards fully clickable.
11. Render Events chronologically where evidence permits.
12. Render Quests around questgiver, objective, involved people, places, items, and factions.
13. Add source-derived Player and GM campaign overviews.
14. Preserve all inherited implemented guarantees listed in this plan, including reconciliation, normalized relationships, recursive locations, replay/cache, provenance, deployment safety, and cost controls.
15. Finish with one final paid Demonplague benchmark only after all deterministic work is complete.

---

# 2. Explicit Non-Goals for v0.3

Defer these to v0.4 or later:

- manual fact editing
- manual entity creation
- manual entity merge/split
- manual reclassification of `Other`
- per-fact Reveal/Hide controls
- reveal history / audit log
- session-by-session campaign-state editing
- changing faction standing during play
- quest-state editing during play
- user accounts and real DM/player authorization
- per-player or per-party visibility
- subtype taxonomy for all entities
- universal cross-entity timeline beyond Event chronology
- automatic manual-source authoring UI

However, v0.3 database/provenance design must not make those features difficult to add later.

---

# 3. Core Information Model

## 3.1 Knowledge-unit principle

Do not treat rich article content as untraceable generated prose.

Every stored knowledge unit must have the equivalent of:

- stable identity
- field/type
- value/content
- source evidence
- visibility
- canonical entity association where applicable

Implementation does **not** have to use a fully generic EAV schema if a cleaner typed representation fits the existing architecture.

The acceptance requirement is that every fact can independently carry provenance and visibility.

Examples:

- `occupation = Hunter`
- `personality = Proud and controlling`
- `appearance = Tall man with...`
- `status = Dead`
- `goal = Recover the Soul Stone`

Each must be traceable to source evidence.

## 3.2 Provenance

Current document/page/excerpt provenance remains first-class.

Design provenance so a future source can also be:

- document extraction
- manual GM entry
- later session-derived information

v0.3 only needs document-backed extraction in normal operation, but the schema must not assume that PDF pages are the only possible source forever.

Suggested conceptual source types:

- `document`
- `manual` (reserved for future use)

Do not build the manual editing UI yet.

## 3.3 Visibility

Initial visibility states:

- `dm_only`
- `player_visible`

Visibility must be supported independently for:

### Entity
If an entity is DM-only, it must not appear in Player View through:

- homepage
- category pages
- search
- hover/focus previews
- connections
- timelines
- location trees
- breadcrumbs
- counts
- source indexes

### Fact
A visible entity may contain both visible and hidden facts.

Example:

**Colinus Birthwitch**
- Entity: Player-visible
- Hunter: Player-visible
- Village Councilmember: Player-visible
- Owns Brutus: Player-visible
- Murdered Reson Fergone: DM-only
- Blackmailed by Bjalien: DM-only

### Relationship
Visibility belongs to the normalized logical relationship, not to each rendered inverse.

If `Colinus murdered Reson` is hidden, the inverse/reference must also be hidden on Reson's Player View.

### Evidence
Player View must only expose evidence attached to visible knowledge.

A visible citation on page 45 must not open an excerpt containing unrelated hidden spoilers from the same page.

## 3.4 Player/DM summaries

Persist separate summaries where required:

- GM summary: may use all supported knowledge.
- Player summary: may use only player-safe supported knowledge.

Do not derive Player summaries from GM summaries by string deletion.

Do not generate summaries at page-render time.

The same principle applies to the campaign overview.

## 3.5 Initial visibility assignment

Be conservative.

Default questionable extracted knowledge to `dm_only`.

Strong evidence for `player_visible` can include:

- explicit player introduction
- player handout
- clearly labeled common knowledge
- explicitly public setting information

Do not guess that a secret is safe because it "sounds obvious."

Actual campaign-progress reveal controls belong to v0.4.

---

# 4. Universal Entity Prominence

Every canonical entity type gets:

- `major`
- `supporting`
- `minor`

Applies to:

- NPC
- Deity
- Location
- Faction
- Item
- Event
- Quest
- Other

## Rules

Prominence must be assigned **after reconciliation**, once all known evidence for the canonical entity is available.

Do not classify per chunk and then blindly keep one chunk's prominence.

Prominence is campaign-relative, not power-relative.

Signals can include:

- main plot relevance
- quest involvement
- recurring presence
- consequential actions
- relationship to major antagonists/allies
- depth and amount of material
- explicit narrative emphasis
- expected meaningful interaction with the party

Store an internal source-grounded `prominenceReason` or equivalent diagnostic evidence.

Do not require the normal article UI to display the reason.

Search does not need to use prominence.

Prominence primarily controls browsing/navigation emphasis.

---

# 5. Rich Article Schemas

Empty sections are omitted.

Structured relationships should power article facts where possible rather than duplicating the same information again in Connections.

## 5.1 NPC

Primary questions:

- Who are they?
- What do players perceive?
- What do they do?
- What are they like?
- What do they want?
- Why do they matter?

Fields:

- name / aliases / titles
- occupation / profession
- social role / position
- faction memberships
- main location / residence / workplace
- appearance
- first impression
- mannerisms
- voice/accent if stated
- personality / temperament
- values / beliefs
- flaws / fears if stated
- goals
- motivations
- wants from party if stated
- background / history
- knowledge
- capabilities
- status
- hooks
- important relationships

Do not infer personality from actions unless the source actually supports the characterization.

## 5.2 Location

Primary questions:

- What kind of place is this?
- What do characters notice when they arrive?
- What is the overall vibe?
- What is it used for?
- Who/what matters here?

Fields:

- place type
- first impression
- appearance
- scale / layout if stated
- notable sensory details
- atmosphere / vibe
- purpose / function
- common occupants / activity
- important features
- parent location
- immediate sublocations
- notable occupants / owners
- status/condition
- hooks
- important relationships

Physical containment continues to use the v0.2 recursive location hierarchy.

## 5.3 Deity

Fields:

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
- relationships with other deities
- status if meaningful
- hooks
- important relationships

Appearance and iconography should remain distinguishable in stored data even if the UI later groups them.

## 5.4 Faction

Fields:

- faction type
- purpose / mission
- ideology / beliefs
- goals
- leadership
- important members
- membership
- recruitment / requirements if stated
- organization / structure
- headquarters
- territory / operating area
- resources / capabilities
- symbols / colors / uniforms
- reputation
- methods
- allies
- enemies / rivals
- controlled/associated locations
- notable assets
- history
- current situation
- status
- hooks

### Party relationship fields

Include source-derived fields now:

- Party Awareness
- Party Standing
- Reason for Standing
- Privileges / Restrictions / Obligations

These are read-only in v0.3.

Future campaign-state editing belongs to v0.4.

## 5.5 Item

Fields:

- item type
- appearance
- materials / inscriptions / distinctive traits
- history / origin
- creator if known
- previous owners / bearers
- current owner / holder
- current location
- explicit rules stats
- special powers / benefits
- costs / drawbacks / curses
- activation / usage requirements
- lore / known information
- status / condition
- connected quests / hooks
- important relationships

Keep:

- **Stats** = explicit mechanical rules
- **Special Benefits / Powers** = what the item enables

Ownership should use canonical relationships where possible rather than duplicated strings.

## 5.6 Quest

Keep Quest articles focused and linked.

Fields:

- summary / objective
- questgiver
- important NPCs
- important locations
- important items
- involved factions
- stakes / why it matters
- reward if explicit
- status if source establishes it
- likely outcome / consequences if specified by source
- hook / how it begins
- important relationships
- sources

The compact top of a Quest page should make questgiver, objective, involved people, places, and items immediately visible.

## 5.7 Event

Events should primarily support chronology.

Fields:

- what happened
- exact date/time if known
- relative chronological position if known
- uncertainty where relevant
- location
- participants
- causes
- consequences
- connected quests/entities
- status where meaningful
- sources

Never invent dates to make sorting easier.

Support:

- exact chronology
- relative chronology
- unknown-date events

The Events category page should display a timeline/chronological ordering rather than an alphabetical directory where sufficient evidence exists.

Possible groups:

- Ancient History
- Before the Campaign
- Campaign Events
- Unknown Date

Do not build a universal timeline system for all facts in v0.3.

## 5.8 Other

Keep `Other` as a simple fallback.

Do not attempt a broad new subtype taxonomy in v0.3.

Manual reclassification/merge tooling belongs to v0.4.

---

# 6. Campaign-Level Summaries

Generate two source-derived campaign overviews:

## Player Overview

- spoiler-safe
- premise
- setting
- starting situation
- information explicitly suitable for players/common knowledge

Prefer player intros/handouts when present.

## GM Overview

- complete campaign premise
- major conflicts
- major antagonists
- important hidden situation
- major stakes

Both must be source-backed.

If player-safe evidence is unclear, omit questionable information rather than risk spoilers.

---

# 7. Article Presentation Rules

## 7.1 No empty sections

If no source-supported Appearance exists, do not show:

`Appearance: Unknown`

Simply omit the section.

## 7.2 Avoid database feel

Do not expose machine-like labels such as:

- `Connected Via Blackmails`
- `Member Of`

when natural article presentation already communicates the fact.

Keep the graph semantics underneath.

## 7.3 Avoid duplicate facts

If a structured relationship is already displayed naturally as:

`Current owner: Ralekai`

do not repeat:

`Connected via owned_by Ralekai`

in Connections.

Connections should emphasize useful remaining narrative relationships.

## 7.4 Quick-fact previews

Entity links on:

- homepage
- category pages
- Connections
- article links
- search results

should support compact hover/focus previews.

Example NPC preview:

**Colinus Birthwitch**  
NPC  
Hunter · Village Councilmember  
Tomar's Crossing  
Alive

Example Location preview:

**Jorney's Tavern**  
Location  
Tavern in Tomar's Crossing  
Busy local gathering place

Requirements:

- hover
- keyboard focus
- accessible behavior
- sensible touch/mobile behavior
- visibility filtering respected
- no extra per-hover API/OpenAI request

Do not force a permanent large quick-facts card onto every article.

---

# 8. Navigation and Campaign UX

## 8.1 Sticky header

Header remains visible while scrolling.

Requirements:

- no layout jump
- usable desktop and mobile behavior
- clear background over content
- active section indicator

## 8.2 Campaign-local vs global navigation

Current campaign name links to current campaign home.

Current-campaign sections remain grouped:

- NPCs
- Deities
- Locations
- Factions
- Items
- Events
- Quests
- Enemies
- Other

Global campaign navigation should be clearly separated and labeled:

- `All Campaigns`

Do not make `Campaigns` look like another current-campaign category.

Remove redundant `Campaign home` back-links where the persistent campaign-name navigation makes them unnecessary.

## 8.3 Integrated search

Search becomes part of the sticky header.

Within a campaign:

- scoped to current campaign
- always accessible
- results dropdown as user types
- entity name + type
- keyboard navigation
- Enter opens result
- Escape closes
- touch-friendly mobile interaction
- respects Player/DM visibility

Do not use prominence to filter search.

Remove the large redundant standalone campaign-home search box.

The old dedicated search route may remain as a fallback if useful, but it should not be the primary interaction.

## 8.4 Clickable campaign cards

On the global campaign list:

- entire campaign card/body opens the wiki
- campaign title is clickable
- keyboard accessible
- clear hover/focus state
- `Open Wiki` may remain as a redundant visible affordance
- future secondary controls must not accidentally trigger card navigation

---

# 9. Campaign Homepage

The homepage should become a campaign overview, not an extraction dashboard.

Replace or reduce:

- large standalone search
- flat alphabetical NPC/Faction dumps
- overly prominent technical extraction language
- duplicated stat-card navigation

Prefer:

- Player or GM campaign overview depending on view mode
- total entry count in wiki language, not extractor language
- prominence-aware category accordions

Conceptual pattern:

```text
Test 2
156 wiki entries

Campaign Overview
...

▾ NPCs · 67
   Major NPCs
   Colinus Birthwitch
   Feriae the Wise
   Ralekai
   ...
   Supporting & Minor · 53 ▸
   View all →

▸ Locations · 29
▸ Factions · 15
▸ Items · 18
▸ Events · 14
▸ Quests · 7
▸ Deities · 0
▸ Other · 6
```

Do not require every category to be simultaneously expanded.

Counts must respect Player View visibility.

---

# 10. Category Pages

All entity category pages remain concise.

Use the same universal prominence concept:

```text
NPCs · 67

MAJOR
...

SUPPORTING ▸

MINOR ▸
```

Requirements:

- Major visible first
- Supporting/Minor collapsible where useful
- no giant cards
- hover/focus quick previews
- direct navigation remains easy
- Player View hides inaccessible entities
- Location pages preserve recursive hierarchy
- Events use chronology rather than prominence-only alphabetical ordering
- Enemies remains a role-filtered view, not an entity type

Prominence can still influence event emphasis, but chronology is the primary Event ordering.

---

# 11. Player View / DM View

v0.3 needs a read-mode toggle for development/testing and DM preview.

## DM View

Displays all permitted campaign knowledge.

## Player View

Displays only:

- Player-visible entities
- Player-visible facts
- Player-visible relationships
- safe evidence
- Player campaign summary

The switch must affect the whole application consistently:

- campaign homepage
- category counts
- category lists
- search
- entity pages
- hover previews
- Connections
- Sources
- Events
- location trees
- breadcrumbs
- Quests

No hidden data should be discoverable through side channels.

This is a preview/read-mode mechanism only.

Real accounts/permissions and per-fact reveal controls are v0.4.

---

# 12. Milestone Plan

## Milestone 0 — v0.3 Data & Provenance Foundation

### Goal
Introduce the storage/read-model foundation before changing extraction prompts.

### Work
- review current entity/source/relationship schema
- design stable source-backed fact representation
- add universal prominence field
- add entity visibility
- add fact visibility
- add normalized relationship visibility
- make provenance extensible beyond document-only sources
- design safe evidence attachment
- support GM/Player summaries
- migrations preserve existing campaigns
- default legacy data safely to DM-visible behavior without breaking current DM UI
- no paid extraction

### Acceptance
- old Test 2 still loads
- existing relationships/hierarchy remain intact
- every future rich fact can carry source + visibility
- schema can later support manual-source provenance without redesign
- tests cover migration/default behavior

## Milestone 1 — Rich Fact Extraction & Canonical Enrichment

### Goal
Teach the pipeline to collect the richer type-specific knowledge defined above.

### Work
- extend structured extraction schemas
- preserve page/excerpt evidence per fact
- aggregate facts across chunks
- deduplicate equivalent facts
- retain conflicting evidence rather than silently invent resolution
- perform canonical article synthesis only after entity reconciliation
- summaries use only collected evidence
- no render-time AI
- cache/replay all new AI outputs
- record model/token/cost diagnostics

### Important rule
Concrete source facts may be extracted per chunk, but canonical summaries/prominence/visibility decisions must happen after all evidence for the reconciled entity is available.

### Acceptance
Deterministic fixtures prove:
- NPC fields
- Location fields
- Deity fields
- Faction fields
- Item fields
- Quest fields
- Event chronology fields
- Other fallback
- source fidelity
- omitted unsupported fields
- no hallucinated completion of sparse entities

No Demonplague rerun yet.

## Milestone 2 — Prominence, Summaries & Initial Knowledge Classification

### Goal
Perform campaign-level/canonical judgments only after reconciliation.

### Work
- assign Major / Supporting / Minor
- retain diagnostic prominence reason/evidence
- generate GM entity summaries
- generate Player-safe entity summaries where supported
- generate GM campaign overview
- generate Player campaign overview
- assign conservative initial entity/fact/relationship visibility
- validate hidden/visible reference consistency
- flag visible facts pointing to hidden entities for later GM handling rather than silently cascading visibility

### Acceptance
- prominence is canonical, not chunk-specific
- sparse incidental entity can remain Minor
- important late-appearing entity can still become Major
- Player summaries contain no DM-only facts in deterministic fixtures
- campaign Player overview does not leak fixture secrets
- no real extraction

## Milestone 3 — Centralized Player/DM Read Model

### Goal
Make visibility systemic before adding more UI.

### Work
Create a centralized visibility/read layer used by:

- campaign queries
- counts
- categories
- search
- entities
- relationships
- source evidence
- location hierarchy
- event chronology
- hover previews

Add DM View / Player View preview switching.

### Leakage tests
Prove a hidden entity cannot leak through:
- search autocomplete
- count totals
- Related/Connections
- location child lists
- breadcrumbs
- event participation
- quest links
- source page grouping
- hover/focus previews

Prove a hidden relationship remains hidden from both endpoint perspectives.

### Acceptance
Player View is safe by construction rather than by scattered component conditionals.

No editing controls yet.

## Milestone 4 — Rich Type-Specific Entity Articles

### Goal
Render the new knowledge as useful wiki articles.

### Work
- type-specific section composition
- omit empty sections
- compact source citations
- source-safe evidence popovers/disclosures
- remove machine-like relationship wording
- avoid duplication between quick facts/article sections/Connections
- add link hover/focus previews
- preserve compact v0.2 visual language
- keep source provenance easy to inspect

### Type-specific behavior
Implement the article schemas for:
- NPC
- Location
- Deity
- Faction
- Item
- Quest
- Event
- Other fallback

### Acceptance
Articles feel like reference pages rather than graph/database output.

## Milestone 5 — Navigation, Search, Homepage & Category Polish

### Goal
Make the wiki fast to navigate during play.

### Work
- sticky header
- active category state
- current campaign name → campaign home
- `All Campaigns` separated from campaign-local categories
- integrated sticky-header search dropdown
- remove redundant large homepage search
- remove redundant campaign-home back link where appropriate
- entire campaign cards clickable
- homepage prominence-aware category accordions
- concise category pages using universal prominence
- compact citation styling
- replace extraction-oriented wording such as `entities discovered` with wiki-oriented language where appropriate

### Acceptance
A GM can move around the wiki without scrolling back to the top and can reach any known entity quickly.

## Milestone 6 — Campaign Overview, Quests & Event Chronology

### Goal
Finish the specialized campaign-level/reference experiences.

### Work

### Campaign overview
- GM overview in DM View
- Player overview in Player View
- source-backed only

### Quests
Emphasize:
- objective
- questgiver
- important NPCs
- locations
- items
- factions
- stakes
- rewards
- source-backed status where known

### Events
- chronological ordering when evidence exists
- exact dates
- relative timing
- uncertainty
- unknown-date grouping
- no invented dates

### Acceptance
- Quest pages answer "who, what, where, why" quickly
- Events page reads as a timeline rather than alphabetical entity dump
- Player View filters both correctly

## Milestone 7 — v0.3 Regression, Replay & Cost Evaluation

### Goal
Lock everything before the paid benchmark.

### Work
Expand deterministic fixtures to cover:

- rich facts for every entity type
- missing fields omitted
- source evidence per fact
- prominence post-reconciliation
- visibility leaks
- player vs GM summaries
- inverse relationship visibility
- hidden location hierarchy nodes
- hidden search results
- hidden source excerpts
- category counts
- homepage accordions
- hover/focus preview filtering
- Quest links
- Event chronology
- campaign summaries
- legacy Test 2 compatibility
- replay without re-extraction
- cost diagnostics

Update evaluation output with useful v0.3 metrics, including:

- candidate count
- canonical count
- merge count
- type counts
- prominence counts
- fact counts by type
- visible/hidden fact counts
- relationship counts
- hierarchy edges
- chronology coverage
- source evidence count
- unsupported/empty field rate
- model usage
- token usage
- estimated cost
- replay/live mode

### Acceptance
Normal test suite requires no:
- OpenAI credentials
- live Supabase
- internet
- paid extraction

Run:
- lint
- typecheck
- tests
- build
- deterministic replay/evaluation

## Milestone 8 — Test 3: One Final Real Demonplague Benchmark

Only after Milestones 0–7 pass.

### Preserve baseline
Do not delete or overwrite Test 2.

Create a new Test 3 campaign.

### Measure

#### Extraction quality
- major entities present
- missing entities
- false entities
- wrong types
- cross-type duplicates
- false merges
- Deities
- Enemy roles

#### Rich articles
For representative Major / Supporting / Minor entities:
- appearance
- personality
- role
- motivations
- hooks
- location first impressions
- deity domains/temperament
- faction structure/party standing
- item ownership/history/powers
- quest links
- event chronology

#### Hallucination audit
Randomly sample stored facts and verify:
- each has a source
- source supports the displayed claim
- summary does not exceed evidence
- unsupported sections remain absent

#### Prominence
Check known examples:
- Colinus Birthwitch should surface prominently
- Feriae the Wise should surface prominently
- Brutus should not receive equivalent homepage prominence

Do not hard-code these outcomes into production logic; use them as benchmark cases.

#### Visibility
Audit:
- DM View completeness
- Player View spoiler safety
- hidden entity leakage
- hidden fact leakage
- hidden relationship leakage
- evidence leakage
- player campaign overview

#### Navigation/UX
- sticky header
- integrated search
- campaign card behavior
- category accordions
- concise category pages
- hover previews
- Locations
- Events timeline
- Quest usability

#### Cost
Record:
- extraction model
- enrichment/reconciliation model(s)
- calls
- tokens
- runtime
- estimated total cost
- cache/replay behavior

### Final result
Produce a v0.2 → v0.3 benchmark report.

Do not immediately rerun the full PDF to fix individual issues. Use replay/cached intermediate data first wherever possible.

---

# 13. Cross-Cutting Engineering Rules

Throughout all milestones:

1. Prefer false negatives to invented facts.
2. Never invent missing appearance/personality/history/chronology.
3. Every displayed extracted fact must have evidence.
4. No OpenAI calls at render time.
5. Relationships remain normalized.
6. Location containment remains one authoritative hierarchy.
7. Enemy remains a role, not an entity type.
8. Deity remains an entity type.
9. `Other` remains a fallback.
10. Search finds Minor entities just as reliably as Major entities.
11. Prominence affects browsing, not existence.
12. Player filtering must happen before data reaches UI components where practical.
13. Do not create one DB/API request per fact/entity link.
14. Keep Vercel read-only upload protection.
15. Preserve service-role security.
16. Use replay/cache before live AI whenever possible.
17. Do not run the full Demonplague source during Milestones 0–7.
18. Update changelog/version using the established v0.2 mechanism after each user-visible milestone.

---

# 14. v0.4 Design Space Reserved by v0.3

v0.3 should intentionally leave clean extension points for:

- DM reveals entity to players
- DM reveals/hides individual facts
- visible-fact dependency warnings
- manual fact addition
- manual source provenance
- edit extracted facts
- entity merge/split
- reclassify `Other`
- change prominence manually
- update party standing
- update quest status
- campaign-state history
- audit trail
- real authenticated DM vs Player accounts
- eventual per-player/per-party visibility

v0.3 should not implement these workflows, but its data model should not require a rewrite to add them.

---

# 15. Definition of Done for v0.3

v0.3 is complete when:

- rich article facts exist for all primary entity types
- unsupported information is omitted rather than invented
- every extracted fact is source-backed
- universal prominence works after reconciliation
- DM/Player visibility is represented at entity/fact/relationship level
- Player View cannot discover hidden knowledge through navigation/search/sources
- GM and Player campaign/entity summaries are safely separated
- rich articles avoid database-style duplication
- location pages include first impression/atmosphere where supported
- faction pages include source-derived Party Standing fields
- item pages include history/ownership/stats/powers where supported
- Quest pages clearly link questgiver/people/places/items/factions
- Events are ordered chronologically where evidence allows
- header is sticky
- search is integrated in the header
- campaign cards are fully clickable
- campaign and category pages are prominence-aware and concise
- hover/focus entity previews work
- existing v0.2 behavior remains intact
- deterministic tests/replay pass without paid services
- exactly one final Test 3 Demonplague benchmark validates the complete v0.3 system
