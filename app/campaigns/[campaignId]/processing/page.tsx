import Link from "next/link";
import { notFound } from "next/navigation";
import { ProcessingStatus } from "@/components/processing-status";
import { getCampaign } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function ProcessingPage({ params }: { params: Promise<{ campaignId: string }> }) {
  const { campaignId } = await params;
  let campaign;
  try { campaign = await getCampaign(campaignId); } catch { notFound(); }
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl items-center px-6 py-16">
      <section className="w-full rounded-2xl border border-[var(--line)] bg-white/70 p-8 shadow-sm sm:p-12">
        <Link className="mb-8 inline-block text-sm font-semibold text-[var(--accent)]" href="/">← Campaigns</Link>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">{campaign.name}</p>
        <h1 className="mt-3 font-serif text-4xl font-semibold">Creating your campaign wiki…</h1>
        <ProcessingStatus
          campaignId={campaignId}
          initialStatus={campaign.status}
          initialStage={campaign.processing_stage}
          initialError={campaign.status === "failed" ? "We couldn't finish processing this campaign. Please try again." : null}
        />
      </section>
    </main>
  );
}
