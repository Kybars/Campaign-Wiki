import Link from "next/link";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";
import type { CampaignStatus } from "@/lib/db/types";
import { getCampaigns } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<CampaignStatus, string> = {
  uploaded: "Ready to process",
  extracting_pages: "Extracting pages",
  extracting_candidates: "Extracting entities",
  reconciling: "Reconciling entities",
  persisting: "Building wiki",
  complete: "Complete",
  failed: "Failed",
};

export default async function UploadPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const uploadsAllowed = areCampaignUploadsAllowed();
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  let campaignLoadFailed = false;

  try {
    campaigns = await getCampaigns();
  } catch (loadError) {
    campaignLoadFailed = true;
    console.error("Could not load existing campaigns", loadError);
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-16">
      <section className="w-full rounded-2xl border border-[var(--line)] bg-white/70 p-8 shadow-sm sm:p-12">
        <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Campaign Wiki</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Your campaign, connected.</h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-[var(--muted)]">
          Upload one text-based campaign PDF and turn it into a source-backed, interconnected wiki.
        </p>
        {uploadsAllowed ? (
          <form className="mt-10 space-y-6" action="/api/campaigns" method="post" encType="multipart/form-data">
            {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Campaign name</span>
              <input className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]" name="name" required maxLength={200} />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Campaign PDF</span>
              <input className="w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-4 py-5" name="pdf" type="file" accept="application/pdf,.pdf" required />
            </label>
            <button className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-white hover:brightness-110" type="submit">Generate Wiki</button>
          </form>
        ) : (
          <p className="mt-8 max-w-xl rounded-lg border border-[var(--line)] bg-white/50 px-4 py-3 text-sm text-[var(--muted)]">
            This deployment is currently read-only. Campaign imports are performed locally.
          </p>
        )}
      </section>

      <section className="mt-12" aria-labelledby="existing-campaigns-heading">
        <div className="flex items-end justify-between border-b border-[var(--line)] pb-4">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Campaign library</p>
            <h2 id="existing-campaigns-heading" className="mt-1 font-serif text-3xl font-semibold">Existing campaigns</h2>
          </div>
          {!campaignLoadFailed ? <p className="text-sm text-[var(--muted)]">{campaigns.length} total</p> : null}
        </div>

        {campaignLoadFailed ? (
          <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            Existing campaigns could not be loaded. Check the server configuration and try again.
          </p>
        ) : campaigns.length === 0 ? (
          <p className="mt-6 text-[var(--muted)]">No campaigns yet. Upload a PDF above to create the first one.</p>
        ) : (
          <ul className="mt-6 grid gap-4">
            {campaigns.map((campaign) => {
              const completed = campaign.status === "complete";
              const failed = campaign.status === "failed";
              const href = completed
                ? `/campaigns/${campaign.id}`
                : `/campaigns/${campaign.id}/processing`;

              const card = <>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="truncate font-serif text-xl font-semibold">{campaign.name}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${failed ? "bg-red-100 text-red-800" : completed ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>
                        {STATUS_LABELS[campaign.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-[var(--muted)]">
                      Created <time dateTime={campaign.created_at}>{new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(campaign.created_at))}</time>
                      {completed ? ` · ${campaign.entityCount} ${campaign.entityCount === 1 ? "entry" : "entries"}` : ""}
                    </p>
                    {failed ? <p className="mt-2 text-sm text-red-800">{campaign.error_message ?? "Campaign processing failed."}</p> : null}
                  </div>
                  {completed ? <span className="mt-4 inline-block shrink-0 font-semibold text-[var(--accent)] sm:mt-0">Open wiki →</span> : null}
                </>;
              return completed ? <li key={campaign.id}><Link className="block rounded-xl border border-[var(--line)] bg-white/60 p-5 hover:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] sm:flex sm:items-center sm:justify-between sm:gap-6" href={href}>{card}</Link></li> : <li key={campaign.id} className="rounded-xl border border-[var(--line)] bg-white/60 p-5 sm:flex sm:items-center sm:justify-between sm:gap-6">{card}<Link className="mt-4 inline-block shrink-0 font-semibold text-[var(--accent)] hover:underline sm:mt-0" href={href}>{failed ? "View failure" : "View progress"} →</Link></li>;
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
