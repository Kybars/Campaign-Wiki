import { CampaignLibrary } from "@/components/campaign-library";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";
import { getCampaigns } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

function ImportForm({ error, uploadsAllowed, compact = false }: { error?: string; uploadsAllowed: boolean; compact?: boolean }) {
  return <section aria-labelledby="import-heading" className={`${compact ? "hidden target:block" : ""} scroll-mt-6 rounded-2xl border border-[var(--line)] bg-white/70 p-7 shadow-sm sm:p-10`} id="import"><p className="eyebrow">{compact ? "Add to your library" : "Start a campaign"}</p><h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl" id="import-heading">Import campaign material</h2>{compact ? null : <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">Choose a text-based campaign PDF. Campaign Wiki will organize its source-backed entries and connections into a wiki you can open when it is ready.</p>}{uploadsAllowed ? <form action="/api/campaigns" className="mt-6 grid max-w-3xl gap-5" encType="multipart/form-data" method="post">{error ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p> : null}<label><span className="mb-2 block text-sm font-semibold">Campaign name</span><input className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20" maxLength={200} name="name" required /></label><label><span className="mb-2 block text-sm font-semibold">Campaign PDF</span><input accept="application/pdf,.pdf" className="w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-4 py-5 file:mr-4 file:rounded file:border-0 file:bg-[var(--paper)] file:px-3 file:py-1.5 file:font-semibold file:text-[var(--ink)]" name="pdf" required type="file" /></label><button className="button-primary w-fit" type="submit">Create campaign wiki</button></form> : <p className="mt-7 max-w-2xl rounded-lg border border-[var(--line)] bg-[var(--paper)]/70 px-4 py-3 text-sm leading-6 text-[var(--muted)]">This deployment is read-only. Campaign imports are performed locally.</p>}</section>;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const uploadsAllowed = areCampaignUploadsAllowed();
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  let campaignLoadFailed = false;
  try { campaigns = await getCampaigns(); } catch (loadError) { campaignLoadFailed = true; console.error("Could not load existing campaigns", loadError); }
  const hasCampaigns = campaigns.length > 0 || campaignLoadFailed;

  return <main>{!hasCampaigns ? <section className="border-b border-[var(--line)] bg-[radial-gradient(circle_at_top_right,_#e8d5ad,_transparent_36%),linear-gradient(115deg,_#f8f5ed,_#eee7d8)]"><div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24"><p className="eyebrow">A campaign home, built from your material</p><h1 className="mt-5 max-w-3xl font-serif text-5xl font-semibold tracking-tight sm:text-6xl">Keep the world at the table.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">Turn campaign material into an interconnected, source-backed wiki your group can actually navigate.</p><a className="button-primary mt-7 inline-flex" href="#import">Import your first campaign</a></div></section> : null}<div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">{hasCampaigns ? <><CampaignLibrary campaigns={campaigns} loadFailed={campaignLoadFailed} /><div className="mt-10"><ImportForm compact error={error} uploadsAllowed={uploadsAllowed} /></div></> : <ImportForm error={error} uploadsAllowed={uploadsAllowed} />}</div></main>;
}
