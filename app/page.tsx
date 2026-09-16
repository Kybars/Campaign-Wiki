import { CampaignLibrary } from "@/components/campaign-library";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";
import { getCampaigns } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const uploadsAllowed = areCampaignUploadsAllowed();
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  let campaignLoadFailed = false;
  try { campaigns = await getCampaigns(); } catch (loadError) { campaignLoadFailed = true; console.error("Could not load existing campaigns", loadError); }

  return <main>
    <section className="border-b border-[var(--line)] bg-[radial-gradient(circle_at_top_right,_#e8d5ad,_transparent_36%),linear-gradient(115deg,_#f8f5ed,_#eee7d8)]"><div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.3fr_.7fr] lg:items-end"><div><p className="eyebrow">A campaign home, built from your material</p><h1 className="mt-5 max-w-3xl font-serif text-5xl font-semibold tracking-tight sm:text-6xl">Keep the world at the table.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">Turn campaign material into an interconnected, source-backed wiki your group can actually navigate.</p></div><div className="rounded-xl border border-[var(--line)] bg-white/65 p-6 shadow-sm"><p className="font-serif text-2xl font-semibold">One place for the living campaign.</p><p className="mt-3 leading-7 text-[var(--muted)]">Import your material, then follow its characters, locations, factions, and relationships without losing the source behind them.</p><a className="button-primary mt-6 inline-flex" href="#import">Import campaign</a></div></div></section>
    <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-18">
      {campaigns.length > 0 || campaignLoadFailed ? <CampaignLibrary campaigns={campaigns} loadFailed={campaignLoadFailed} /> : null}
      <section id="import" className={`${campaigns.length > 0 || campaignLoadFailed ? "mt-16" : ""} scroll-mt-6 rounded-2xl border border-[var(--line)] bg-white/70 p-7 shadow-sm sm:p-10`} aria-labelledby="import-heading"><p className="eyebrow">Start a campaign</p><h2 id="import-heading" className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Import campaign material</h2><p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">Choose a text-based campaign PDF. Campaign Wiki will organize its source-backed entries and connections into a wiki you can open when it is ready.</p>{uploadsAllowed ? <form className="mt-8 grid max-w-3xl gap-5" action="/api/campaigns" method="post" encType="multipart/form-data">{error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}<label><span className="mb-2 block text-sm font-semibold">Campaign name</span><input className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20" name="name" required maxLength={200} /></label><label><span className="mb-2 block text-sm font-semibold">Campaign PDF</span><input className="w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-4 py-5 file:mr-4 file:rounded file:border-0 file:bg-[var(--paper)] file:px-3 file:py-1.5 file:font-semibold file:text-[var(--ink)]" name="pdf" type="file" accept="application/pdf,.pdf" required /></label><button className="button-primary w-fit" type="submit">Create campaign wiki</button></form> : <p className="mt-7 max-w-2xl rounded-lg border border-[var(--line)] bg-[var(--paper)]/70 px-4 py-3 text-sm leading-6 text-[var(--muted)]">This deployment is read-only. Campaign imports are performed locally.</p>}</section>
      {campaigns.length === 0 && !campaignLoadFailed ? <div className="mt-16"><CampaignLibrary campaigns={campaigns} loadFailed={false} heading="No campaigns yet" description="Your campaign library will appear here after your first import." /></div> : null}
    </div>
  </main>;
}
