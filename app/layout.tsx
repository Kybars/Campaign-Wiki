import type { Metadata } from "next";
import packageMetadata from "@/package.json";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campaign Wiki",
  description: "Turn a campaign PDF into an interconnected wiki.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div
          aria-label={`Campaign Wiki version ${packageMetadata.version}`}
          className="fixed right-3 top-3 z-50 rounded-full border border-[var(--line)] bg-white/90 px-3 py-1 font-mono text-xs font-semibold text-[var(--muted)] shadow-sm backdrop-blur"
        >
          v{packageMetadata.version}
        </div>
        {children}
      </body>
    </html>
  );
}
