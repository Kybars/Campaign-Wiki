import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { areCampaignUploadsAllowed } from "@/lib/campaign-upload-access";
import { createAdminClient } from "@/lib/db/client";
import { extractPdfPages, PdfExtractionError } from "@/lib/pdf/extract-text";

export const runtime = "nodejs";
export const maxDuration = 60;

function redirectWithError(request: Request, message: string) {
  const url = new URL("/", request.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: Request) {
  if (!areCampaignUploadsAllowed()) {
    return redirectWithError(request, "Campaign uploads are disabled on this deployment.");
  }

  let campaignId: string | undefined;
  let storagePath: string | undefined;
  try {
    const form = await request.formData();
    const name = String(form.get("name") ?? "").trim();
    const fileValue = form.get("pdf");
    if (!name || name.length > 200) return redirectWithError(request, "Enter a campaign name.");
    if (!(fileValue instanceof File) || fileValue.size === 0) return redirectWithError(request, "Please upload a PDF.");
    if (fileValue.size > 50 * 1024 * 1024) return redirectWithError(request, "The PDF must be smaller than 50 MB.");
    if (fileValue.type !== "application/pdf" && !fileValue.name.toLocaleLowerCase("en-US").endsWith(".pdf")) {
      return redirectWithError(request, "Please upload a PDF.");
    }

    const bytes = await fileValue.arrayBuffer();
    const pages = await extractPdfPages(bytes);
    campaignId = randomUUID();
    const documentId = randomUUID();
    const filename = fileValue.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 240) || "campaign.pdf";
    storagePath = `${campaignId}/${documentId}.pdf`;
    const client = createAdminClient();

    const campaignResult = await client.from("campaigns").insert({
      id: campaignId,
      name,
      status: "extracting_pages",
      processing_stage: "Uploading PDF",
    }).select("id").single();
    if (campaignResult.error) throw new Error(`Create campaign: ${campaignResult.error.message}`);

    const uploadResult = await client.storage.from("campaign-pdfs").upload(storagePath, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploadResult.error) throw new Error(`Upload PDF: ${uploadResult.error.message}`);

    const documentResult = await client.from("documents").insert({
      id: documentId,
      campaign_id: campaignId,
      filename,
      storage_path: storagePath,
      page_count: pages.length,
    });
    if (documentResult.error) throw new Error(`Create document: ${documentResult.error.message}`);

    for (let start = 0; start < pages.length; start += 200) {
      const batch = pages.slice(start, start + 200).map((page) => ({
        document_id: documentId,
        page_number: page.pageNumber,
        text: page.text,
      }));
      const pageResult = await client.from("document_pages").insert(batch);
      if (pageResult.error) throw new Error(`Save PDF pages: ${pageResult.error.message}`);
    }
    await client.from("campaigns").update({ status: "uploaded", processing_stage: `${pages.length} pages extracted` }).eq("id", campaignId);
    return NextResponse.redirect(new URL(`/campaigns/${campaignId}/processing`, request.url), 303);
  } catch (error) {
    const message = error instanceof PdfExtractionError ? error.message : "We couldn't finish uploading this campaign. Check your setup and try again.";
    if (campaignId) {
      const client = createAdminClient();
      await client.from("campaigns").update({ status: "failed", error_message: error instanceof Error ? error.message : "Upload failed" }).eq("id", campaignId);
      if (storagePath) await client.storage.from("campaign-pdfs").remove([storagePath]);
    }
    console.error("Campaign upload failed", error instanceof Error ? error.message : error);
    return redirectWithError(request, message);
  }
}
