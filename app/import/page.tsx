import Link from "next/link";
import { ImportForm } from "@/components/import-form";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <p className="eyebrow">Campaign Wiki</p>
      <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight">Import campaign</h1>
      <p className="mt-3 mb-8 max-w-2xl leading-7 text-[var(--muted)]">Turn a campaign PDF into an interconnected, source-backed wiki.</p>
      <ImportForm error={Array.isArray(error) ? error[0] : error} uploadsAllowed={areCampaignUploadsAllowed()} />
      <Link className="mt-6 inline-flex text-sm font-semibold text-[var(--accent)] underline-offset-4 hover:underline" href="/">Back to campaign library</Link>
    </main>
  );
}
