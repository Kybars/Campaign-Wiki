# v0/Test2 semantic graph core recovery — Phase A

## Decision

`GRAPH_SCORER_NORMALIZATION_FIXED`

The latest milestone repairs only the deterministic saved-output scorer. Earlier phase decisions and raw-run metrics below remain historical records.

This phase implements an isolated, provider-neutral relationship-only proof. It made no model calls, campaign writes, checkpoint writes, persistence calls, or fixture changes. A Phase-B proof requires separate explicit authorization for exactly one model generation.

## Historical verification

The only historical commit inspected was `6d6cb871d30256a8ce56b2950fe9cc00f7bb3d56`, using the requested prompt, schema, extraction, validation, relationship, and campaign-processing files. Later inverse normalization was inspected at `2a452:lib/relationships/normalize.ts`. The local Test2/Test3 recall audit was also read.

### What v0/Test2 did

- The prompt requested a source-backed knowledge graph: meaningful named entities plus explicit semantic relationships; it rejected outside lore and proximity-only edges.
- Its extraction response had entity and relationship arrays. Relationships used source/target temporary IDs, a natural-language label, description, confidence, and source evidence. There was no atomic fact array.
- Validation rejected unresolved/self relationship endpoints and invalid source evidence. Relationship resolution deduped normalized `(source, target, type)` edges and merged evidence.
- Test2 persisted aggregate counts of 302 validated entity candidates, 156 canonical entities, 276 relationship candidates, and 262 canonical relationships. It had no atomic fact rows.
- Test2's exact model is unknown. The code default was Terra, but a runtime override was possible and not persisted.

### Later complexity and retained safety

Test3 added rich nested entity output, typed atomic facts, independent fact evidence, and later enrichment. The recall audit attributes the principal 52-identity loss to extraction output pressure rather than reconciliation. Test3 has 112 canonical entities, 145 relationships, and 502 facts.

The proof deliberately retains later deterministic graph safety:

- inverse normalization for parent/child, owns/owned by, membership, and location containment;
- canonical semantic dedupe and bidirectional graph presentation;
- endpoint rejection, self-edge rejection, and no new identities;
- current Pass-A grounding, deterministic inventory IDs, completeness union, provider abstraction, and persistence safeguards.

It deliberately does not restore model summaries, descriptions, confidence, IDs, evidence excerpts, aliases, facts, suspected misses, enrichment, or nested Rich entity records.

## Phase-A graph proof implementation

- [graph-extraction.ts](../../lib/ai/graph-extraction.ts) defines the isolated model contract, provider-neutral dispatch function, human-readable inventory serialization, endpoint mapping, validation, inverse normalization, and semantic dedupe.
- [evaluate-wotbs-graph-proof.ts](../../scripts/evaluate-wotbs-graph-proof.ts) reconstructs the prior validated Pass-A inventory from ignored raw artifacts, supports a no-call preflight, and records one separately authorized proof result.
- [graph-extraction.test.ts](../../tests/graph-extraction.test.ts) covers strict schema, prompt shape, readable inventory input, endpoint rejection, inverse normalization, dedupe, freeform labels, no entity creation, provider abstraction, and gold isolation.

The strict response schema is:

```json
{
  "relationships": [
    {
      "source": "string",
      "relationship": "string",
      "target": "string",
      "page": 10
    }
  ]
}
```

All objects are strict. Relationship count is capped at 120. The application accepts only unique exact normalized matches to final inventory canonical names; no arbitrary fuzzy matching, model IDs, aliases, or entity creation is permitted. Page provenance is validated against the source chunk. This proof retains page-level provenance only: exact evidence-text materialization is intentionally deferred until semantic viability is established, so no production provenance contract is weakened.

Freeform relationship labels remain valid when they have no safe known inverse. Known inverse labels are canonicalized through the current normalization module, then deduped using its semantic key.

## Frozen Pass-A reuse and Phase-B input

The prior WotBS raw initial/completeness artifact was reconstructed deterministically and verified against the frozen source PDF/text hashes:

- Final authoritative inventory: 42 entities.
- Inventory fingerprint: `c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`.
- Pass-A quality: 39/43 recall (90.7%), 95.2% bounded precision, 12/12 Quests, and 2/2 Items.
- Pass-A calls in this phase: 0.

The exact graph prompt payload is 12,319 characters / 12,421 UTF-8 bytes, approximately 3,080 input tokens, and contains the three frozen source pages plus 42 human-readable `name | type` entity rows. It contains no opaque inventory IDs or evaluator data.

Gold was loaded only for post-construction evaluation. Isolation assertions passed. The actual endpoint-eligible relationship-gold count is 12.

## Phase-B boundary

The graph dispatch uses the shared structured-provider interface, so it supports both local and OpenAI configurations. No provider has been selected or called by this phase.

The recommended one-call proof, if explicitly authorized, is OpenAI `gpt-5.6-terra`. This is a practical comparison point for the OpenAI structured-output Test2 era; it is not a claim that Test2 definitely used Terra. The current local Qwen runtime remains deliberately untested here because repeated relationship-generation failures already answered that separate question.

Phase B must use one Graph Extraction call, zero retries, zero repair calls, no Pass-A rerun, no reconciliation, no enrichment, and no persistence.

## Verification and safety

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `npm test`: 321 tests pass.
- `npm run build`: pass.
- `npm run evaluate:wotbs-graph-proof -- --preflight`: pass.
- Checkpoint, replay, and lean deterministic evaluations: pass with zero model calls/writes.
- OpenAI calls: 0. Local calls: 0. Campaign/official checkpoint writes: 0.
- Gold leakage: 0. Private WotBS fixtures remain ignored and untracked.

## Product conclusion

The historical graph core is reproducible as a much smaller semantic contract while preserving modern Pass-A and graph-safety mechanics. The next action is not another design revision: it is one explicitly authorized semantic proof call and manual relationship audit.

## Phase B — one local Qwen proof

### Call result

One generation was made using the frozen source/input/schema, local Ollama `qwen3.5:9b`, digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, context target 32,768, temperature 0, reasoning none, concurrency 1, and a 300-second hard deadline.

| Metric | Result |
| --- | ---: |
| Provider / model | local / `qwen3.5:9b` |
| Latency | 31.199s |
| Input characters / bytes | 12,319 / 12,421 |
| Input / output / total tokens | 3,459 / 1,371 / 4,830 |
| Output characters | 2,782 |
| Structured output | valid |
| Relationships proposed | 29 |

The final inventory fingerprint remained `c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`. Pass A was reused; no Pass-A call occurred. Gold was loaded only after the graph output returned. The isolation assertion passed.

### Deterministic validation and gold score

- Proposed: 29.
- Accepted after exact normalized endpoint and page checks: 26.
- Unknown-endpoint rejections: 3; ambiguous endpoints: 0.
- Self-edges: 0; duplicate semantic edges: 0.
- Unknown endpoints admitted: 0; entity creation: 0.
- Endpoint-eligible gold relationships recomputed from the inventory: 12.
- Strict repository evaluator recovered 6/12. Manual semantic-equivalence review also counts `Torch of the Burning Sky — used by → Drakus Coaltongue` as the inverse of the gold Coaltongue-wields/acquires-Torch relationship. Final recovery is 7/12 = 58.3%.
- Remaining eligible misses: Leska advises Coaltongue; Longinus/Pilus brotherhood; Coaltongue slain at Castle Korstull; Aquiline Heart at Heart of History; Madness is a trillith.

### Page-by-page source audit

Every retained relationship was checked against the exact cited page. All 26 were supported; unsupported retained relationships: 0; manual precision: 100%.

| Retained relationship (source → label → target) | Page | Audit |
| --- | ---: | --- |
| Supreme Inquisitor Leska → commands → Inquisitors | 10 | Directly stated command relationship. |
| Shaaladel → ruler of → Shahalesti | 10 | Directly identified as ruler. |
| Pilus → located in → Monastery of Two Winds | 10 | The source introduces Pilus in the remote monastery as its wizard. |
| Lyceum → located in → Seaquen | 10 | Academy and town are directly connected. |
| Gate Pass → lies in → Otdar Mountains | 10 | Direct location statement. |
| Gate Pass → border of → Ragesia | 10 | The city is placed on Ragesia's eastern border. |
| Shahalesti → allied with → Ragesia | 10 | The source describes the nations' alliance and its strain. |
| Dassen → located on borders of → Ragesia | 10 | Dassen is included among nations bordering Ragesia. |
| Dassen → located on borders of → Shahalesti | 10 | Dassen is included among nations bordering Shahalesti. |
| Ostalin → located on borders of → Ragesia | 10 | Ostalin is included among nations bordering Ragesia. |
| Ostalin → located on borders of → Shahalesti | 10 | Ostalin is included among nations bordering Shahalesti. |
| Drakus Coaltongue → ruled → Ragesia | 10 | The source identifies Coaltongue as emperor/ruler. |
| Torch of the Burning Sky → used by → Drakus Coaltongue | 10 | His acquisition and use of the Torch are described; inverse direction is semantically clear. |
| The Scouring of Gate Pass → located in → Gate Pass | 11 | The synopsis centers on the siege and escape from Gate Pass. |
| The Indomitable Fire Forest of Innenotdar → located in → Innenotdar | 11 | The adventure route passes through the named forest. |
| Shelter from the Storm → located in → Seaquen | 11 | Its events occur after the heroes reach Lyceum in Seaquen. |
| The Mad King's Banquet → located in → Dassen | 11 | The mission and events are set in Dassen. |
| Mission to the Monastery of Two Winds → located in → Monastery of Two Winds | 11 | The mission travels to the named monastery. |
| Tears of the Burning Sky → located in → Castle Korstull | 11 | The heroes fight their way inside the castle in this synopsis. |
| Castle Korstull → located in → Sindaire | 11 | The castle is explicitly placed in Sindaire. |
| The Trial of Echoed Souls → located in → Ycengled | 11 | The synopsis places the action in the haunted forest of Ycengled. |
| The Festival of Dreams → located in → Gate Pass | 11 | The heroes return to Gate Pass for this adventure. |
| Under the Eye of the Tempest → located in → Seaquen | 12 | The synopsis repeatedly places the action in Seaquen. |
| The Beating of the Aquiline Heart → located at → Heart of History | 12 | The final assault is directed into the rift where the Heart lies. |
| Supreme Inquisitor Leska → contains blood of → Avilona | 12 | The source identifies Avilona's immortal blood in Leska's veins. |
| Torch of the Burning Sky → created by → Mother of Dreams | 12 | The Torch is attributed to the power of the Mother of Dreams. |

### Product-level usefulness

The graph has 12 distinct normalized relationship labels and 26 retained edges touching 32 of the 42 inventory entities. The edges cover rulers/commands, political alliance and border links, locations, artifact use/creation, and adventure placement. It includes clear ruler/command edges, faction/political connections, location edges, and artifact associations. It has no family edge; it has quest/event-to-location links but no direct hero participation edges. The graph is meaningfully interconnected and gives useful page navigation for several entity classes. Its 58.3% eligible-gold recall remains materially below the 75% target, despite 100% audited precision.

This output is structurally and behaviorally much closer to Test2's relationship graph than either failed Rich run: it completed in 31.199 seconds with 2,782 output characters, versus malformed outputs over 90,423 characters/509.401 seconds for monolithic Rich and over 50,152 characters/554.198 seconds for compact relationships. It remains a one-fixture, one-model result, and it does not validate full-scale behavior.

### Safety and decision

- Local generations: exactly 1. OpenAI: 0. Retries: 0. Repair calls: 0.
- Pass-A, reconciliation, enrichment, and persistence calls/writes: 0.
- Campaign and official checkpoint writes: 0. Gold leakage: 0.
- Private fixture/gold files remain ignored and untracked.

Decision: `LOCAL_V0_STYLE_GRAPH_QUALITY_LOW`. The model contract is bounded and produces a useful, fully source-supported graph, but eligible relationship recall is below target. The next proof should use exactly one OpenAI Terra graph call with the identical frozen prompt, schema, and input before further architecture changes.

## Phase C — one OpenAI Terra proof

### Frozen comparison and call result

The Phase-A harness reconstructed the same source chunk, inventory, graph prompt, and strict schema as the local Qwen proof. The 42-entity final inventory fingerprint remained `c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`; graph input remained 12,319 characters / 12,421 bytes. Gold, evaluator data, the prior Qwen output, and its misses were not included in the request. Pass A was reused without generation.

One OpenAI `gpt-5.6-terra` structured-output call completed in 59.662s. SDK retries were disabled and the request timeout was bounded at 300 seconds.

| Metric | Local Qwen | OpenAI Terra |
| --- | ---: | ---: |
| Latency | 31.199s | 59.662s |
| Input tokens | 3,459 | 3,398 |
| Output tokens | 1,371 | 3,467 |
| Total tokens | 4,830 | 6,865 |
| Output characters | 2,782 | 3,456 |
| Proposed edges | 29 | 37 |
| Deterministically accepted | 26 | 37 |
| Eligible gold recall | 7/12 (58.3%, after Torch inverse-equivalence review; raw evaluator was 6/12) | 8/12 (66.7%, after two scorer-equivalence corrections; raw evaluator was 6/12) |
| Manual precision | 26/26 (100%) | 36/37 (97.3%, after forensic correction) |
| Inventory entities touched | 32/42 | 38/42 |
| Relationship-label variety | 12 | 17 supported normalized labels |

Terra produced more edges and touched six more inventory entities. Correcting the two scorer-equivalence misses raises its comparison score above Qwen's, though still below the 75% per-model target. Output tokens were about 2.5× Qwen's; the total remained bounded and structurally valid.

### Deterministic validation and conditional gold score

- Structured output: valid; 37 proposed and 37 accepted.
- Unknown endpoints: 0; ambiguous endpoints: 0; self-edges: 0; duplicate semantic edges: 0. No entities were created.
- Endpoint-eligible gold relationships: 12, recomputed from the frozen final inventory.
- The raw repository evaluator recovered 6/12. Forensic inspection adds `Aquiline Heart located in Heart of History` and the broad Pilus/Monastery association, yielding 8/12 (66.7%). The raw Aquiline edge is `Heart of History contains Aquiline Heart`, which existing inverse normalization correctly canonicalizes; the proof harness then scored the original surface label `contains` instead of normalized `relationshipType: located in`, while gold uses `located_at`. The scorer also fails to credit Terra's source-backed `Pilus leads Monastery of Two Winds` for the gold's broad `associated_with` relation because its term list omits `lead`.
- Misses: Leska advises Coaltongue; Pilus is associated with the Monastery of Two Winds; Longinus and Pilus are brothers; Coaltongue wielded/acquired the Torch; the Aquiline Heart is located at the Heart of History; Madness is a trillith.
- No additional inverse-equivalence match was identified in the manual audit.

### Page-by-page audit of retained edges

Forensic correction: all 37 retained edges were checked against their cited page and normalized direction. Thirty-six are supported; one is unsupported, yielding 97.3% manual precision. The earlier Phase-C note below incorrectly treated the inverse-containment edge as unsupported; its saved raw output says `Heart of History contains Aquiline Heart`, and deterministic normalization yields the correct `Aquiline Heart located in Heart of History` edge.

| Retained edge | Page | Audit |
| --- | ---: | --- |
| Drakus Coaltongue → rules → Ragesia | 10 | Supported: identified as ruler. |
| Drakus Coaltongue → is emperor of → Ragesian Empire | 10 | Supported: identified as emperor of the Empire. |
| Supreme Inquisitor Leska → commands → Inquisitors | 10 | Supported: direct command statement. |
| Supreme Inquisitor Leska → initiates → The Scourge | 10 | Supported: she orders the Scourge to begin. |
| Shaaladel → rules → Shahalesti | 10 | Supported: directly named ruler. |
| Shaaladel → seeks → Torch of the Burning Sky | 10 | Supported: he attempts to retrieve the Torch. |
| Pilus → allied with → Ragesia | 10 | Supported: the text calls them his Ragesian allies before his betrayal. |
| Lyceum → located in → Seaquen | 10 | Supported: academy and town are directly connected. |
| Lyceum → opposes → Ragesian Empire | 10 | Supported: those opposing the Empire rally under Lyceum's banner. |
| Gate Pass → located in → Otdar Mountains | 10 | Supported: direct location statement. |
| Gate Pass → connects → Ragesia | 10 | Supported: described as a conduit between Ragesia and Shahalesti. |
| Gate Pass → connects → Shahalesti | 10 | Supported: same conduit statement. |
| Shahalesti → allied with → Ragesia | 10 | Supported: their alliance is stated. |
| Inquisitors → serve → Supreme Inquisitor Leska | 10 | Supported: Inquisitors do her bidding. |
| The Scouring of Gate Pass → takes place in → Gate Pass | 11 | Supported: synopsis centers on the besieged city. |
| Ragesia → attacks → Gate Pass | 11 | Supported: Ragesian army marches upon the city. |
| The Indomitable Fire Forest of Innenotdar → takes place in → Innenotdar | 11 | Supported: the titled forest is the journey's setting. |
| Shelter from the Storm → takes place in → Seaquen | 11 | Supported: action follows arrival at Lyceum in Seaquen. |
| Ragesia → seeks to destroy → Lyceum | 11 | Supported: an army is dispatched to destroy the school. |
| The Mad King's Banquet → takes place in → Dassen | 11 | Supported: the mission is to the neighboring nation of Dassen. |
| Mission to the Monastery of Two Winds → takes place in → Monastery of Two Winds | 11 | Supported: the heroes travel to the monastery. |
| Monastery of Two Winds → located in → Ostalin | 11 | Supported: its location in Ostalin is explicit. |
| Longinus → leads → Monastery of Two Winds | 11 | Supported: Longinus and Pilus are identified as its heads. |
| Pilus → leads → Monastery of Two Winds | 11 | Supported: Longinus and Pilus are identified as its heads. |
| Tears of the Burning Sky → takes place in → Castle Korstull | 11 | Supported: the heroes fight inside the castle in this synopsis. |
| Castle Korstull → located in → Sindaire | 11 | Supported: the castle is placed in Sindaire. |
| Drakus Coaltongue → was slain in → Castle Korstull | 11 | Supported: the synopsis says he was slain there. |
| The Trial of Echoed Souls → takes place in → Ycengled | 11 | Supported: action is placed in the forest of Ycengled. |
| O Wintry Song of Agony → takes place in → Ragesia | 11 | Supported: its facility is in northern Ragesia. |
| The Festival of Dreams → takes place in → Gate Pass | 11 | Supported: the heroes return to the city for this adventure. |
| Mother of Dreams → is source of → trillith | 12 | Supported: Mother is identified as their source. |
| trillith → created → Torch of the Burning Sky | 12 | Unsupported: the cited sentence does not support the generic trillith entity as creator. |
| Under the Eye of the Tempest → takes place in → Seaquen | 12 | Supported: the tempest and action are placed in Seaquen. |
| Pilus → seeks to destroy → Lyceum | 12 | Supported: his stated objective is to destroy the academy. |
| Heart of History → contains → Aquiline Heart | 12 | Supported: deterministic inverse normalization yields Aquiline Heart located in Heart of History. |
| Supreme Inquisitor Leska → has blood of → Avilona | 12 | Supported: Avilona's immortal blood is said to run in Leska's veins. |
| The Beating of the Aquiline Heart → takes place in → Heart of History | 12 | Supported: the final assault is directed into the rift where the Heart lies. |

### Product-level comparison and decision

Terra's graph is visibly interconnected: 38 of 42 inventory entities are touched by supported edges, with 17 distinct supported normalized labels. It contains ruler/command, political/faction, location, artifact-seeking, and many quest/event-to-location links. It does not supply a family edge or direct hero-participation relationships. One unsupported edge remains, but manual precision is 97.3%, above the 90% target.

The call is bounded and useful for navigation, but Terra's corrected 66.7% remains below the per-model recall target. The original Phase-C quality-low decision remains appropriate, with corrected comparative metrics recorded in the forensic section.

Safety: OpenAI generations exactly 1; local generations 0; retries 0; repairs 0; Pass-A generations 0; reconciliation/enrichment 0; persistence and official checkpoint writes 0; gold leakage 0. Private source and evaluator files remain ignored and untracked.

Next: inspect the exact missed/unsupported edges side-by-side against Qwen before proposing one focused next move. Do not redesign the graph architecture yet.

## Forensic comparison — Qwen and Terra saved outputs

### Frozen-run verification

The exact saved `raw-output.json` and `manifest.json` files were used; neither output was reconstructed from prose. Both manifests agree on PDF SHA-256 `509f81457b95b03a5871ee1ff4faa0e0216da3790c4d57e3a2d7fcf653a8b990`, normalized-text SHA-256 `b55c21c75accc6a3c0fba563d5eba4f0396ddc23cf3dce14c59150f283273281`, pages 10–12, 42 entities, inventory fingerprint `c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`, input size 12,319 characters / 12,421 bytes, graph behavior `v0-test2-graph-proof-1`, contract version 1, and strict `source/relationship/target/page` schema. The same `GRAPH_EXTRACTION_SYSTEM_PROMPT`, `buildGraphExtractionInput`, endpoint mapper, inverse normalizer, and `scoreWotbsRelationships` helper were used; provider/model was the intended only semantic-call difference. The scorer did not persist its own version/hash in either manifest; source inspection confirms both runs went through the same scorer implementation.

### Gold relationship crosswalk

The full machine-readable 12-row crosswalk, including page support and exact matching edges, is in [wotbs_graph_qwen_terra_crosswalk.json](wotbs_graph_qwen_terra_crosswalk.json). Summary: six eligible gold relationships were semantically recovered by both; Qwen alone recovered the Torch association; Terra alone recovered Coaltongue slain at Castle Korstull; two additional Terra matches were missed by the scorer's relation-label equivalence logic; three were missed by both. No source/target endpoint mapping defect was found.

The scorer has two deterministic equivalence gaps. First, graph-proof candidate construction passes the original surface `relationship` label instead of validated canonical `relationshipType`; consequently inverse-normalized containment is rescored using `contains` instead of `located in`. Second, its `associated_with` term list does not recognize `leads`, even though Terra's leadership edge supports the gold's broad association. The crosswalk marks both as evaluator misses while recording semantic recovery; the existing scorer credits only Qwen for the Pilus relation and neither model for the Aquiline location.

### Missed-by-both relationships

| Gold edge | Source support and explicitness | Diagnosis |
| --- | --- | --- |
| Leska → advisor to → Coaltongue | PDF p. 10 names both in the “Famous Names” section and directly describes Leska as one of Coaltongue's closest advisors in the same sentence. | `EXPLICIT_SIMPLE`; clear NPC–NPC edge, directly within prompt scope. Likely a model omission, not a long-distance or evaluator issue. |
| Longinus → brother of → Pilus | PDF p. 11 names both as a pair of brothers in the monastery synopsis, in one sentence. | `FAMILY_RELATION`; maximally explicit and prompt-relevant. Both models omit the same simple family edge. |
| Madness → is a → trillith | PDF p. 11 identifies Madness as a trillith in its adventure synopsis. | `EXPLICIT_SIMPLE`; both endpoints are explicit in the same sentence. This is a straightforward type/class edge, not merely co-occurrence. |

For all three, both endpoints are explicitly named in the supporting passage and the relation is in one sentence or immediately adjacent wording—not across distant sections. A careful reader would call each a relationship, and the frozen prompt reasonably asks for them. The two character links fit the v0/Test2 source-backed knowledge-graph semantics; the exact Test2 extraction output is unavailable, so this is a contract-level expectation, not a claim Test2 actually emitted these edges. None is an unsupported-gold case or merely an implied relationship. The pattern remains a real shared completeness gap after scorer corrections.

### Model-specific recoveries and unsupported Terra output

- Qwen-only: `Torch of the Burning Sky used by Drakus Coaltongue` on PDF p. 10 is the inverse wording of the gold artifact association. Terra instead emits Shaaladel seeking the Torch, which is supported but does not express the gold relation.
- Terra-only: `Drakus Coaltongue was slain in Castle Korstull` on PDF p. 11 directly matches gold `slain_at`.
- Terra-only after deterministic normalization: `Heart of History contains Aquiline Heart` on PDF p. 12 maps through the existing inverse rule to Aquiline Heart located in Heart of History. This is an evaluator mismatch, not a model direction error.
- The one unsupported Terra edge is `trillith created Torch of the Burning Sky` (PDF p. 12, Sleep, Ye Cursed Child synopsis). The passage attributes the Torch's creation to the power of a trillith, while the emitted edge makes the generic trillith class itself the creator. This is an ambiguous noun/reference-scope overgeneralization, not a reversed edge or mere proximity. A deterministic page/endpoint validator cannot distinguish that class-level overreach from a valid causal edge without discourse-semantic analysis; no safe generic rejection rule is apparent.
- The previously reported `Aquiline Heart contains Heart of History` false positive was based on the normalized manifest's endpoint ordering and was a forensic misread. The exact raw output is `Heart of History contains Aquiline Heart` (PDF p. 12); the current inverse normalizer correctly turns it into Aquiline Heart located in Heart of History. It is supported, and its failure to score is the canonical-label adapter mismatch described above. No deterministic rejection rule is appropriate.

### Supported-graph topology and usefulness

Metrics exclude the one unsupported Terra edge and deduplicate the cross-model union by current semantic keys. Degrees include all 42 inventory entities, so isolated entities contribute zero.

| Supported graph | Edges | Touched / isolated entities | Mean / median degree | Normalized label variety |
| --- | ---: | ---: | ---: | ---: |
| Qwen | 26 | 32/42 touched; 10 isolated | 1.24 / 1 | 12 |
| Terra | 36 | 38/42 touched; 4 isolated | 1.71 / 1 | 17 |
| Diagnostic union | 58 | 38/42 touched; 4 isolated | 2.76 / 2 | 26 |

Cross-type edge counts (categories can overlap only by separate edges) are: Qwen — NPC↔Faction 3, NPC↔Location 1, NPC↔Item 1, Quest/Event↔Location 9, Quest/Event↔NPC 0, Faction↔Location 2, Location↔Location 2; Terra — 6, 4, 1, 9, 1, 7, 2; supported union — 8, 5, 2, 18, 1, 8, 3. Both individual graphs provide major-page navigation; Terra touches more entities, while Qwen's supported edges are cleaner. The union is a diagnostic only, not a recommendation to run both models in production. There are four exact semantic-key duplicates across runs; additional same-meaning label variants are not merged by the present conservative normalizer.

The union recovers 9/12 eligible gold relationships (75%) after the inverse and broad-association equivalences documented above. This shows complementary model omissions, but neither single model reaches the target. The arbitrary numeric threshold is not the whole product judgment: both graphs are meaningfully navigable, yet their shared misses are three clearly source-backed canonical links.

### Forensic decision and next experiment

Decision: `GRAPH_EVALUATOR_NORMALIZATION_GAP`. Two of the 12 eligible relationships were semantically recovered by Terra but not credited by the scorer, materially changing Terra's measured recall from 50.0% to 66.7% and the model comparison. The earlier wrong-direction diagnosis for Aquiline Heart was incorrect: its raw `contains` direction is correct and existing inverse normalization already handles it. Three explicit, simple, in-scope relationships remain missed by both; first correct and rerun saved-output scoring with no model calls, then reassess those shared omissions.

Next milestone: correct only the deterministic gold-scoring adapter to consume canonical relationship types and account for the identified `located_at`/`located in` and `associated_with`/`leads` equivalences; rescore saved outputs with zero model calls. Then reassess the three remaining shared omissions before authorizing any extraction experiment.

## Deterministic scorer-normalization repair

The scorer bug existed in two adjacent places. `evaluate-wotbs-graph-proof.ts` converted already-validated graph edges back into candidate relationships with the raw surface `relationship` field even though endpoint direction had already been canonicalized; `scoreWotbsRelationships` then compared raw endpoint direction and label/description substrings rather than canonical semantic edges. This split representation hid inverse matches and made the result depend on surface wording.

The graph-proof adapter now passes validated `relationshipType` with the already-canonical source and target IDs. The scorer routes both candidate and gold edges through the production `normalizeRelationshipFact` representation before comparing endpoints and a small exact evaluator family. Production normalization remains unchanged. The evaluator-only additions are deliberately generic and conservative: exact coarse reference families, exact `leads` support for a broad organizational association, and the exact inverse surface `used by` for the existing wield/use gold family. There is no fuzzy matching, entity-name logic, WotBS mapping, prompt/schema change, or extraction change. Unrelated labels remain distinct and direction remains significant after known inverse normalization.

The exact saved raw Qwen and Terra outputs were revalidated and rescored with `npm run evaluate:wotbs-graph-proof -- --rescore-saved`. The command made zero model calls, retries, repair calls, persistence writes, or artifact writes.

| Metric | Before repair | After repair |
| --- | ---: | ---: |
| Qwen | raw scorer 6/12 (50.0%); 7/12 (58.3%) after manual inverse review | 7/12 (58.3%) deterministic |
| Terra | raw scorer 6/12 (50.0%); 8/12 (66.7%) after forensic equivalence review | 8/12 (66.7%) deterministic |
| Supported union | raw scorer 7/12 (58.3%); 9/12 (75.0%) after forensic review | 9/12 (75.0%) deterministic |

Corrected overlap is six recovered by both, one Qwen-only, two Terra-only, and three missed by both. The remaining shared misses are Leska advises Coaltongue, Longinus is Pilus's brother, and Madness is a trillith. They remain true omissions; no existing output canonically maps to them.

The semantic support audit was not changed. Qwen remains 26/26 supported accepted edges (100%). Terra remains 36/37 (97.3%); `Heart of History contains Aquiline Heart` is supported after inverse normalization, and the sole unsupported edge remains `trillith created Torch of the Burning Sky`.

Decision: `GRAPH_SCORER_NORMALIZATION_FIXED`.

Next milestone: one bounded relationship-completeness experiment using source + known entities + already-found relationships to return only clearly missing explicit relationships.

## Relationship completeness sweep — local Qwen

This isolated experiment used the frozen WotBS pages 10–12, the same 42-entity final inventory (`c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`), and the exact validated 26-edge saved Qwen first-pass graph. It did not use the Terra graph, evaluator gold, crosswalk, score, or misses in the model input. Pass A and first-pass graph extraction were reused, not rerun.

The compact prompt identity is `v0-test2-graph-completeness-1`; it uses the unchanged flat `source` / `relationship` / `target` / `page` graph schema. The input serialized source pages, human-readable `Name | Type` known entities, and 26 canonical `source | relationship | target | p. page` first-pass lines—never internal IDs. It explicitly requested only clearly supported relationships absent from the first-pass graph, including inverse/equivalent duplicates. Input size was 13,792 characters / 13,894 bytes (estimated 3,448 tokens). Gold was loaded only after the model output was structurally validated and the diagnostic union was built.

### Call and deterministic sweep validation

One local Ollama `qwen3.5:9b` call used digest `6488c96fa5faab64bb65cbd30d4289e20e6130ef535a93ef9a49f42eda893ea7`, target context 32,768, temperature 0, reasoning none, concurrency 1, and a 300-second hard deadline. It completed with valid bounded structured output in 33.270s.

| Metric | Result |
| --- | ---: |
| Input / output / total tokens | 4,010 / 843 / 4,853 |
| Output characters | 1,714 |
| Proposed sweep edges | 18 |
| Structurally accepted | 14 |
| Novel accepted | 3 |
| Duplicate of first pass | 11 |
| Duplicate within sweep | 1 |
| Unknown endpoint rejects | 3 |
| Ambiguous endpoint / self-edge / invalid-page rejects | 0 / 0 / 0 |

All 18 proposed edges were run through the existing graph validator. The 26 first-pass canonical semantic keys were preserved and used to classify accepted sweep edges. No entity could be created or admitted through an unknown endpoint.

### Manual source audit

The three structurally novel edges were reviewed against their cited frozen page without adding any post-hoc filter:

| Novel sweep edge | Audit | Reason |
| --- | --- | --- |
| Leska → commands → Scourge (p. 10) | AMBIGUOUS | The source says Leska commands the Inquisitors to begin the Scourge; it does not directly state a command relationship from Leska to the event itself. |
| Seaquen → located in → Ragesian Empire (p. 10) | UNSUPPORTED | The source calls Seaquen a coastal town and says people across the Empire travel there; it does not place Seaquen inside the Empire. |
| Gate Pass → border of → Shahalesti (p. 10) | UNSUPPORTED | Gate Pass is a conduit between Ragesia and Shahalesti, while the stated geographic border is the Otdar Mountains / Ragesia. |

Novel supported / unsupported / ambiguous is `0 / 2 / 1`; novel precision is `0.0%` (ambiguous is not supported). The union intentionally retains all three structurally novel edges for diagnostic accounting; no audit-driven suppression was applied.

### Union, gold, and economics

The canonical diagnostic union is 29 edges: all 26 Qwen first-pass edges plus the three structurally novel sweep edges, with no duplicate semantic key. It touches 34/42 entities, leaving 8 isolated, and retains 12 distinct normalized relationship labels. The sweep added no safely supported family, class-membership, command/advisory, or quest/event relationship category.

Corrected private-gold scoring remains unchanged: 12 eligible relationships, first pass 7/12 (58.3%), final union 7/12 (58.3%), and zero new gold relationships recovered. Thus it does not meet the 75% final-recall threshold.

| Local graph work | Calls | Total tokens | Latency | Output characters |
| --- | ---: | ---: | ---: | ---: |
| Qwen first pass | 1 | 4,830 | 31.199s | 2,782 |
| Completeness sweep | 1 | 4,853 | 33.270s | 1,714 |
| Combined | 2 | 9,683 | 64.469s | 4,496 |

No local inference cost is monetized because no measured cost model exists.

### Decision

Decision: `LOCAL_GRAPH_COMPLETENESS_LOW_VALUE`. The output was valid, bounded, and structurally safe, but it was mostly repeated first-pass relationships, added no supported novel edge, and did not improve gold recall or label variety. Do not redesign the contract in this milestone. The one reasonable final comparison, if separately authorized, is one Terra completeness call using the identical frozen contract.

Safety: local generations exactly 1; OpenAI 0; retries 0; repairs 0; Pass-A calls 0; first-pass graph reruns 0; reconciliation/enrichment 0; persistence and checkpoint writes 0; gold leakage 0. Private fixture and generated output remain ignored and untracked.

## Relationship completeness sweep — Terra comparison

This final frozen A/B uses the exact `v0-test2-graph-completeness-1` contract from the local Qwen sweep: the same pages 10–12, 42-entity final inventory (`c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`), same saved Qwen 26-edge first-pass graph, same 13,792-character / 13,894-byte input, prompt, flat schema, mapper, canonical normalizer, duplicate handling, and scorer. Terra’s first-pass graph, the Qwen completeness result, evaluator gold, crosswalk, and benchmark findings were absent from the model input. Only provider/model changed to OpenAI `gpt-5.6-terra`.

### Call and validation

One OpenAI Terra call completed in 40.747s with valid bounded structured output: 3,915 input tokens, 2,736 output tokens, 6,651 total tokens, and 2,110 output characters. SDK retries were disabled; no local generation, Pass-A call, first-pass rerun, reconciliation, enrichment, or persistence occurred.

All 23 proposed edges were structurally accepted. There were zero unknown/ambiguous endpoint, self-edge, invalid-page, first-pass-duplicate, or within-sweep-duplicate rejections. All 23 were therefore novel under the frozen canonical semantic-key comparison.

### Manual source audit

Every novel Terra edge is explicitly supported by its cited frozen page: `23 supported / 0 unsupported / 0 ambiguous`, for 100% novel precision. The additions include direct source-backed advisor, artifact acquisition, political/faction, location/border, event, family, command, class-membership, and conflict relationships. No post-hoc filter or heuristic was added.

Notable direct recoveries include Leska as Coaltongue’s advisor, Longinus as Pilus’s brother, Coaltongue’s acquisition of the Torch, Coaltongue slain at Castle Korstull, and the Aquiline Heart located in the Heart of History. Terra also returns `Madness member of trillith`, which is source-supported class membership; the frozen corrected scorer does not equate `member of` with gold `is_a`, so that shared omission remains unrecovered by scorer semantics rather than being silently credited.

### Union and gold

The diagnostic canonical union is 49 edges: the full 26-edge Qwen first pass plus 23 novel Terra edges, with no duplicate semantic key. It touches 37/42 entities, leaves 5 isolated, and has 29 normalized relationship labels.

Corrected private-gold results improve from 7/12 (58.3%) to 10/12 (83.3%). The Terra sweep newly recovers three scored gold edges: Leska advises Coaltongue, Longinus is Pilus’s brother, and Aquiline Heart is located at Heart of History. Of the three previously shared genuine omissions, two are recovered; Madness is expressed as supported membership but remains a scorer `is_a` miss under the frozen semantics.

### Qwen vs Terra completeness comparison

| Metric | Local Qwen completeness | OpenAI Terra completeness |
| --- | ---: | ---: |
| Latency | 33.270s | 40.747s |
| Input / output / total tokens | 4,010 / 843 / 4,853 | 3,915 / 2,736 / 6,651 |
| Output characters | 1,714 | 2,110 |
| Proposed / accepted | 18 / 14 | 23 / 23 |
| Novel accepted | 3 | 23 |
| First-pass / within-sweep duplicates | 11 / 1 | 0 / 0 |
| Novel precision | 0.0% | 100.0% |
| Final corrected gold recall | 7/12 (58.3%) | 10/12 (83.3%) |

For the requested Qwen-first-pass plus Terra-completeness pairing, the combined local/OpenAI graph work is 2 calls, 11,481 total tokens, and 71.946s latency: Qwen first pass is 4,830 tokens / 31.199s; Terra completeness is 6,651 tokens / 40.747s. This fixture does not establish a full-campaign pricing extrapolation.

### Decision

Decision: `TERRA_GRAPH_COMPLETENESS_VALIDATED`. The sweep is valid, bounded, structurally safe, visibly broadens graph connectivity, adds well over two supported novel edges at 100% audited precision, and raises corrected eligible-gold recall above 75%. This completes the planned completeness-model comparison. Integrate the Qwen first pass plus one completeness sweep behind the existing checkpoint/provider abstractions; do not add Rich facts/enrichment, then return to wiki rendering, dogfooding, and manual correction.

Safety: OpenAI generations exactly 1; local generations 0; retries 0; repairs 0; Pass-A calls 0; first-pass graph reruns 0; persistence/checkpoint writes 0; gold leakage 0. Private fixture and generated output remain ignored and untracked.

## Production integration

The active `lean` production path now uses the validated graph architecture: Pass A initial inventory → Pass A completeness → final deterministic canonical inventory → per-chunk minimal graph first pass → per-chunk missing-relationship completeness sweep → canonical inverse normalization, page-derived provenance, global semantic dedupe, and persistence. The former Rich facts/relationships and reconciliation flow remains only on the explicit legacy `full` path; it is not invoked by new lean imports.

Both graph stages use independent provider/model configuration and provider-aware durable operation checkpoints. Graph extraction identities include the source chunk and final inventory fingerprint; graph completeness additionally depends on the first-pass canonical semantic keys. A changed completeness model or prompt invalidates completeness only, while changed first-pass or Pass-A semantics invalidate downstream graph work. OpenAI graph-completeness operations participate in the existing application call ceiling; local stages preserve the existing no-persistence-without-explicit-opt-in rule and never fall back to OpenAI.

The production graph adapter accepts only inventory-resolved endpoints, rejects unknown/ambiguous/self/page-invalid edges, applies the production inverse normalizer, and persists only the final canonical graph. It records no generated facts, descriptions, or summaries. Relationship provenance is an exact bounded excerpt of the cited source page, selected deterministically; no model-generated quote is created.

Saved private WotBS verification remains deterministic and model-free: validated Qwen first pass `26` plus validated Terra completeness additions `23` produces the expected `49` canonical diagnostic edges. The validation suite uses only synthetic/public fixtures; private source, gold, and raw output artifacts remain ignored and untracked.

## Relationship completeness benchmark — GPT-5.6 Luna

This one-shot A/B/C benchmark kept the frozen `v0-test2-graph-completeness-1` contract unchanged: the private pages 10–12, verified 42-entity inventory (`c4e024d51d68ab54717842e4251d8accebd8b7b5baa556ee453df2d09812c081`), exact saved 26-edge Qwen first-pass graph, source / known-entities / already-found-relationships input, flat relationship schema, endpoint mapper, canonical normalizer, duplicate handling, and corrected scorer. Gold, prior Qwen/Terra completeness output, crosswalk, and known omissions were excluded from the Luna request. The only semantic change was OpenAI `gpt-5.6-luna`; SDK retries were disabled.

One valid bounded Luna response completed in 30.083s with 3,915 input tokens, 2,704 output tokens, 6,619 total tokens, and 2,519 output characters. All 26 proposals were structurally accepted and novel under the canonical first-pass comparison: there were zero first-pass or within-sweep duplicates and zero unknown-endpoint, ambiguous-endpoint, self-edge, or invalid-page rejections. The diagnostic union contains 52 canonical edges, touches 40/42 entities, leaves two isolated, and has 24 normalized relationship labels.

Manual page-by-page source audit found `26 supported / 0 unsupported / 0 ambiguous`, for 100% novel precision. In particular, p. 10 explicitly says that Shaaladel attempts to retrieve the Torch of the Burning Sky; that initially tentative edge is supported. No post-hoc validation heuristic was added. All 26 edges are explicitly source-backed, including the notable advisor and sibling relations and containment expressed through the production inverse normalizer.

Corrected private-gold scoring improves from the Qwen first-pass 7/12 (58.3%) to 10/12 (83.3%), adding Leska advises Coaltongue, Longinus is Pilus's brother, and Aquiline Heart located at Heart of History. Luna does not recover Madness as a trillith / equivalent class relationship: it returns the Mad King's Banquet involving Madness, which is not the frozen scorer's class edge. The request therefore recovers two of the three notable prior omissions.

| Metric | Qwen completeness | Luna completeness | Terra completeness |
| --- | ---: | ---: | ---: |
| Latency | 33.270s | 30.083s | 40.747s |
| Input / output / total tokens | 4,010 / 843 / 4,853 | 3,915 / 2,704 / 6,619 | 3,915 / 2,736 / 6,651 |
| Output characters | 1,714 | 2,519 | 2,110 |
| Novel accepted | 3 | 26 | 23 |
| Novel precision | 0.0% | 100.0% | 100.0% |
| Final corrected gold recall | 7/12 (58.3%) | 10/12 (83.3%) | 10/12 (83.3%) |
| Entities touched | 34/42 | 40/42 | 37/42 |

Using the current public OpenAI list rates for uncached text tokens, Luna's measured call is approximately `$0.00403` (`3,915 × $0.20/M` input plus `2,704 × $1.20/M` output). Under the same rate basis, Terra's recorded call is approximately `$0.04066` (`3,915 × $2/M` input plus `2,736 × $12/M` output). This is a three-page fixture only, not a campaign-cost extrapolation.

Decision: `LUNA_COMPLETENESS_TERRA_LIKE`. It meets the product floor with valid bounded output, 26 supported novel relationships, 100% precision, and 83.3% corrected recall. Production recommendation: `USE_LUNA`. Its quality matches Terra on scored recall and audited precision while being faster and approximately ten times cheaper on this benchmark. Do not form a two-model ensemble or tune the frozen contract further.

Safety: Luna generations exactly 1; Terra generations 0; local generations 0; retries 0; repairs 0; Pass-A calls 0; first-pass graph reruns 0; production persistence writes 0; gold leakage 0. Private fixture, raw output, and gold remain ignored and untracked.
