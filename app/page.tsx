import { CampaignLibrary } from "@/components/campaign-library";
import { ImportForm } from "@/components/import-form";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";
import { getCampaigns } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const uploadsAllowed = areCampaignUploadsAllowed();
  let campaigns: Awaited<ReturnType<typeof getCampaigns>> = [];
  let campaignLoadFailed = false;
  try { campaigns = await getCampaigns(); } catch (loadError) { campaignLoadFailed = true; console.error("Could not load existing campaigns", loadError); }
  const hasCampaigns = campaigns.length > 0 || campaignLoadFailed;

  return <main>{!hasCampaigns ? <section className="border-b border-[var(--line)] bg-[radial-gradient(circle_at_top_right,_#e8d5ad,_transparent_36%),linear-gradient(115deg,_#f8f5ed,_#eee7d8)]"><div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24"><p className="eyebrow">A campaign home, built from your material</p><h1 className="mt-5 max-w-3xl font-serif text-5xl font-semibold tracking-tight sm:text-6xl">Keep the world at the table.</h1><p className="mt-6 max-w-2xl text-lg leading-8 text-[var(--muted)]">Turn campaign material into an interconnected, source-backed wiki your group can actually navigate.</p><a className="button-primary mt-7 inline-flex" href="#import">Import your first campaign</a></div></section> : null}<div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">{hasCampaigns ? <CampaignLibrary campaigns={campaigns} loadFailed={campaignLoadFailed} /> : <ImportForm uploadsAllowed={uploadsAllowed} />}</div></main>;
}
