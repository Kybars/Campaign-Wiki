export interface ChronologyFact {
  fieldKey: string;
  content: string;
  structuredValue?: unknown;
}

export interface ChronologyEvent {
  id: string;
  name: string;
  summary: string;
  prominence?: "major" | "supporting" | "minor" | null;
  facts: readonly ChronologyFact[];
}

export interface EventChronologyGroup<T extends ChronologyEvent = ChronologyEvent> {
  title: string;
  entries: T[];
}

function firstFact(event: ChronologyEvent, fieldKey: string) {
  return event.facts.find((fact) => fact.fieldKey === fieldKey);
}

function isoDate(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.+-]+Z?)?$/.test(value)) return undefined;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function neutralOrder(left: ChronologyEvent, right: ChronologyEvent) {
  return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

/**
 * Builds a display-only, partial chronology from an already visibility-filtered
 * event set. Only ISO-like exact dates and numeric sequence facts are ordered;
 * fictional calendars and free-form relative timing retain their source text.
 */
export function buildEventChronology<T extends ChronologyEvent>(events: readonly T[]): EventChronologyGroup<T>[] {
  const groups = new Map<string, T[]>();
  const add = (title: string, event: T) => groups.set(title, [...(groups.get(title) ?? []), event]);

  for (const event of events) {
    const era = firstFact(event, "chronology_context");
    const exact = firstFact(event, "exact_date");
    const relative = firstFact(event, "relative_chronology");
    const sequence = firstFact(event, "chronology_sequence");
    if (era) add(era.content, event);
    else if (exact && isoDate(exact.content) !== undefined) add("Dated events", event);
    else if (sequence && /^\d+$/.test(sequence.content.trim())) add("Sequenced events", event);
    else if (exact || relative) add("Recorded timing", event);
    else add("Unknown date", event);
  }

  const groupOrder = ["Dated events", "Sequenced events", "Recorded timing", "Unknown date"];
  return [...groups.entries()].map(([title, entries]) => ({
    title,
    entries: [...entries].sort((left, right) => {
      if (title === "Dated events") return (isoDate(firstFact(left, "exact_date")?.content ?? "") ?? 0) - (isoDate(firstFact(right, "exact_date")?.content ?? "") ?? 0) || neutralOrder(left, right);
      if (title === "Sequenced events") return Number(firstFact(left, "chronology_sequence")?.content) - Number(firstFact(right, "chronology_sequence")?.content) || neutralOrder(left, right);
      return neutralOrder(left, right);
    }),
  })).sort((left, right) => (groupOrder.indexOf(left.title) === -1 ? 0 : groupOrder.indexOf(left.title) + 1) - (groupOrder.indexOf(right.title) === -1 ? 0 : groupOrder.indexOf(right.title) + 1) || left.title.localeCompare(right.title));
}

export function chronologyLabel(event: ChronologyEvent) {
  return firstFact(event, "exact_date")?.content
    ?? firstFact(event, "relative_chronology")?.content
    ?? firstFact(event, "chronology_sequence")?.content
    ?? firstFact(event, "chronology_uncertainty")?.content;
}
