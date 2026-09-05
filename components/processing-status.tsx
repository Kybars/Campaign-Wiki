"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

export function ProcessingStatus({ campaignId, initialStatus, initialStage, initialError }: {
  campaignId: string;
  initialStatus: string;
  initialStage: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const started = useRef(false);
  const [stage, setStage] = useState(initialStage ?? "Preparing campaign");
  const [error, setError] = useState(initialError);
  const [running, setRunning] = useState(false);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/process`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? "Processing failed");
      }
      router.replace(`/campaigns/${campaignId}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Processing failed");
      setRunning(false);
    }
  }, [campaignId, router, running]);

  useEffect(() => {
    if (initialStatus === "complete") {
      router.replace(`/campaigns/${campaignId}`);
    } else if (initialStatus === "uploaded" && !started.current) {
      started.current = true;
      void run();
    }
  }, [campaignId, initialStatus, router, run]);

  useEffect(() => {
    if (initialStatus === "complete") return;
    const poll = window.setInterval(() => {
      void fetch(`/api/campaigns/${campaignId}/status`, { cache: "no-store" })
        .then(async (response) => response.ok ? response.json() as Promise<{ status: string; stage?: string; error?: string }> : undefined)
        .then((status) => {
          if (!status) return;
          if (status.stage) setStage(status.stage);
          if (status.status === "complete") {
            router.replace(`/campaigns/${campaignId}`);
            router.refresh();
          } else if (status.status === "failed") {
            setError(status.error ?? "We couldn't finish processing this campaign. Please try again.");
            setRunning(false);
          }
        })
        .catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(poll);
  }, [campaignId, initialStatus, router]);

  return (
    <div className="mt-8">
      <div className="h-2 overflow-hidden rounded-full bg-[var(--line)]">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--accent)]" />
      </div>
      <p className="mt-4 text-[var(--muted)]">{stage}</p>
      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <p>{error}</p>
          <button className="mt-3 font-semibold underline" type="button" onClick={() => void run()}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}
