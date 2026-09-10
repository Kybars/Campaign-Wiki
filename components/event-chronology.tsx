import Link from "next/link";
import { buildEventChronology, chronologyLabel, type ChronologyEvent } from "@/lib/events/chronology";
import { campaignHref, type CampaignViewMode } from "@/lib/campaign-view";

export function EventChronology({ campaignId, events, viewMode }: { campaignId: string; events: readonly ChronologyEvent[]; viewMode: CampaignViewMode }) {
  return <div className="space-y-7">{buildEventChronology(events).map((group) => <section key={group.title} aria-labelledby={`chronology-${group.title}`}><h2 className="font-serif text-2xl font-semibold" id={`chronology-${group.title}`}>{group.title}</h2><ul className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]">{group.entries.map((event) => <li className="py-3" key={event.id}>{chronologyLabel(event) ? <p className="text-sm font-semibold text-[var(--accent)]">{chronologyLabel(event)}</p> : null}<Link className="font-semibold hover:text-[var(--accent)] hover:underline" href={campaignHref(`/campaigns/${campaignId}/entities/${event.id}`, viewMode)}>{event.name}</Link>{event.summary ? <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{event.summary}</p> : null}</li>)}</ul></section>)}</div>;
}
