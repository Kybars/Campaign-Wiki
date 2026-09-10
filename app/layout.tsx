import type { Metadata } from "next";
import { VersionLink } from "@/components/version-link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campaign Wiki",
  description: "Turn a campaign PDF into an interconnected wiki.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div className="border-b border-[var(--line)] bg-[color:var(--paper)]">
          <div className="mx-auto flex max-w-6xl justify-end px-4 py-2 sm:px-6">
            <VersionLink />
          </div>
        </div>
        {children}
      </body>
    </html>
  );
}
