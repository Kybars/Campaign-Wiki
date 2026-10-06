import type { replayAcceptanceBundle } from "../lib/ai/claims-offline-replay";

/** Source-backed checks live in the replay CLI, never require private bytes in CI. */
export function assertTalesReplay(replay: ReturnType<typeof replayAcceptanceBundle>) {
  const checks: Array<{ name: string; passed: boolean; count?: number }> = [];
  const check = (name: string, passed: boolean, count?: number) => { checks.push({ name, passed, count }); };
  const { structure, normalized, result, summary } = replay;
  check("frozen_1891_proposals", result.rawProposals.claims.length === 1891 && summary.rawProposalHashEquivalent);
  check("frozen_prompt", summary.hashes.prompt === "d631d2234fbaf5517a7543f46d053b9f837a6c2589a4471fd3fbfeb05eca5b58");
  check("frozen_schema", summary.hashes.schema === "16b4e1a54d39a6c76b06af42369602de49b3da4b2c3b12bb08d8d4e49f182ebb");
  const rumors = new Set(structure.units.filter(u => /(?:^| > )rumors(?:$| > )/u.test(u.context)).map(u => u.unitId));
  const rumorClaims = result.claims.filter(c => c.directEvidence.some(e => rumors.has(e.unitId)));
  check("rumor_sections_and_claims", rumors.size > 0 && rumorClaims.length > 0 && rumorClaims.every(c => ["rumor", "plan", "gm_instruction"].includes(c.sourceStatus)), rumorClaims.length);
  const rumorRanges = [[19, "Roving Dead"], [28, "Major Characters"], [45, "More Murders"]] as const;
  const fullRumorClaims = result.claims.filter(c => c.directEvidence.some(e => rumorRanges.some(([page, endTitle]) => {
    const start = structure.hierarchy.find(h => h.page === page && h.text === "Rumors");
    const end = structure.hierarchy.find(h => h.page >= page && h.text === endTitle);
    return !!start && !!end && (e.page > start.page || e.page === start.page && e.start >= start.offset) &&
      (e.page < end.page || e.page === end.page && e.start < end.offset);
  })));
  check("complete_source_backed_rumor_sections", fullRumorClaims.length > 0 && fullRumorClaims.every(c => ["rumor", "plan", "gm_instruction"].includes(c.sourceStatus)), fullRumorClaims.length);
  for (const day of [1, 2, 3]) {
    const heading = structure.hierarchy.filter(h => h.text === `Day ${day}`);
    const claims = result.claims.filter(c => c.timelineAssociation?.timeLabel === `Day ${day}`);
    check(`relative_scheduled_day_${day}`, heading.some(h => h.path.join(" > ") === `events_near_verge > day_${day}`) &&
      claims.length > 0 && claims.every(c => ["published_scheduled", "plan"].includes(c.timelineAssociation!.propositionStatus)), claims.length);
  }
  check("running_title_suppressed", structure.suppressed.some(h => /tales of the demon lord/iu.test(h.text)) &&
    structure.units.every(u => !u.context.includes("tales_of_the_demon_lord")));
  const magic = structure.units.filter(u => u.context === "magic");
  check("statblock_magic_scope_bounded", magic.length > 0 && magic.every(u => /MAGIC/u.test(u.rawSource.text)), magic.length);
  for (const names of [["Pentachus Katandramus", "Katandramus"], ["Brotherhood of Shadows", "The Brotherhood of Shadows"]]) {
    const matches = normalized.inventory.entities.filter(e => names.some(n => [e.name, ...(e.aliases ?? [])].includes(n)));
    check(`normalized_${names[0]}`, matches.length === 1 && names.every(n => [matches[0].name, ...(matches[0].aliases ?? [])].includes(n)));
  }
  check("no_duplicate_normalized_candidates", summary.after.duplicateNormalizedCandidateGroups === 0);
  const nameKey = (s: string) => s.toLowerCase().trim().replace(/^the\s+/u, "");
  const groups = new Map<string, typeof normalized.inventory.entities>();
  for (const e of normalized.inventory.entities) {
    const key = nameKey(e.name); groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const ambiguous = [...groups.entries()].filter(([, e]) => e.length > 1).map(([key]) => key);
  check("distinct_same_named_inventory_preserved", ambiguous.length > 0 &&
    replay.originalInventory.entities.filter(e => ambiguous.includes(nameKey(e.name))).every(e => normalized.inventory.entities.some(n =>
      n.type === e.type && (n.temporary_id === e.temporary_id || n.memberIds?.includes(e.temporary_id)))));
  check("ambiguous_inventory_does_not_spawn_candidates", result.candidateEntities.every(e => !ambiguous.includes(nameKey(e.name))));
  const ambiguityParticipants = result.claims.filter(c => c.wikiDisposition === "present").flatMap(c => c.participants.filter(p => ambiguous.includes(nameKey(p.mention))));
  if (result.version.endsWith("2.3.1")) {
    check("inventory_collision_alone_does_not_force_unresolved", ambiguityParticipants.some(p => p.kind === "canonical_entity"));
    check("source_supported_collision_selection", ambiguityParticipants.filter(p => p.kind === "canonical_entity").every(p => p.supportingEvidence.some(e => e.direct)));
    check("indistinguishable_collisions_remain_unresolved", ambiguityParticipants.some(p => p.kind === "unresolved"));
    const participantsFor = (name: string) => result.claims.filter(c => c.wikiDisposition === "present")
      .flatMap(c => c.participants.filter(p => nameKey(p.mention) === nameKey(name)));
    const typeFor = (id: string | null) => normalized.inventory.entities.find(e => e.temporary_id === id)?.type;
    for (const [name, type] of [["The Red Light of the Woods", "deity"], ["Iron Titan", "item"]]) {
      const participants = participantsFor(name);
      check(`source_supported_${name}`, participants.length > 0 && participants.every(p => p.kind === "canonical_entity" && typeFor(p.canonicalId) === type));
    }
    for (const [name, type] of [["Gibbering Fever", "other"], ["Moon Spire", "location"], ["Academy of Engineers", "faction"], ["Academy of Engineers", "location"]])
      check(`claim_local_${name}_${type}`, participantsFor(name).some(p => p.kind === "canonical_entity" && typeFor(p.canonicalId) === type));
    check("void_source_selection_and_residual", participantsFor("Void").some(p => p.kind === "canonical_entity") && participantsFor("Void").some(p => p.kind === "unresolved"));
    check("temple_no_manufactured_associations", participantsFor("Temple of Shadows").length === 0);
  }
  const generics = result.claims.filter(c => c.wikiDisposition === "present").flatMap(c => c.participants.filter(p => /^(?:creature|cultists|children|farm|portal|fog|island|guards|small demon)$/iu.test(p.mention)));
  check("source_common_participants_are_generic", generics.length > 0 && generics.every(p => p.kind === "generic_non_entity"), generics.length);
  const randomIds = new Set(structure.units.filter(u => /random/u.test(u.context)).map(u => u.unitId));
  const randomClaims = result.claims.filter(c => c.directEvidence.some(e => randomIds.has(e.unitId)));
  check("random_remains_conditional", randomClaims.length > 0 && randomClaims.every(c => !c.timelineAssociation && ["conditional", "plan", "gm_instruction"].includes(c.sourceStatus)), randomClaims.length);
  const fullRandomClaims = result.claims.filter(c => c.directEvidence.some(e => [[30, "Places of Interest"], [31, "Key Events"]].some(([page, endTitle]) => {
    const start = structure.hierarchy.find(h => h.page === page && h.text === "Random Events");
    const end = structure.hierarchy.find(h => h.page === page && h.text === endTitle);
    return !!start && !!end && e.page === page && e.start >= start.offset && e.start < end.offset;
  })));
  check("complete_source_backed_random_sections", fullRandomClaims.length > 0 && fullRandomClaims.every(c => !c.timelineAssociation &&
    ["conditional", "plan", "gm_instruction"].includes(c.sourceStatus)), fullRandomClaims.length);
  if (checks.some(c => !c.passed)) throw new Error(`Source-backed regressions failed: ${JSON.stringify(checks.filter(c => !c.passed))}`);
  return checks;
}
