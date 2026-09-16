"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { campaignProgress, isCampaignProcessingActive, keepProgressMonotonic, processingMessages } from "@/lib/campaign-progress";

export function ProcessingStatus({ campaignId, initialStatus, initialStage, initialError }: {
  campaignId: string;
  initialStatus: string;
  initialStage: string | null;
  initialError: string | null;
}) {
  const router = useRouter();
  const started = useRef(false);
  const stageRef = useRef(initialStage ?? "Preparing campaign");
  const [status, setStatus] = useState(initialStatus);
  const [stage, setStage] = useState(initialStage ?? "Preparing campaign");
  const [error, setError] = useState(initialError);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(() => campaignProgress(initialStatus, initialStage).value);
  const [messageIndex, setMessageIndex] = useState(0);
  const currentProgress = campaignProgress(status, stage);
  const active = isCampaignProcessingActive(status) && !error;

  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => setMessageIndex((index) => (index + 1) % processingMessages.length), 8000);
    return () => window.clearInterval(interval);
  }, [active]);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setStatus("uploaded");
    setStage("Preparing campaign");
    stageRef.current = "Preparing campaign";
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
          const nextProgress = campaignProgress(status.status, status.stage ?? stageRef.current);
          setStatus(status.status);
          if (status.stage) {
            stageRef.current = status.stage;
            setStage(status.stage);
          }
          setProgress((current) => keepProgressMonotonic(current, nextProgress.value, status.status));
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
      <div className="flex items-baseline justify-between gap-4">
        <p className="font-semibold">{currentProgress.label}</p>
        <p className="text-sm font-semibold text-[var(--accent)]">{progress}%</p>
      </div>
      <div aria-label={`${currentProgress.label}: ${progress}% complete`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--line)]" role="progressbar">
        <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-700 ease-out motion-reduce:transition-none" style={{ width: `${progress}%` }} />
      </div>
      <p aria-live="polite" className="mt-4 text-sm text-[var(--muted)]">{stage}</p>
      {active ? <p className="mt-3 text-sm leading-6 text-[var(--muted)]">{processingMessages[messageIndex]}</p> : null}
      {error ? (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">
          <p>{error}</p>
          <button className="mt-3 font-semibold underline" type="button" onClick={() => void run()}>Try again</button>
        </div>
      ) : null}
    </div>
  );
}
