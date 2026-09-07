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
        <VersionLink />
        {children}
      </body>
    </html>
  );
}
