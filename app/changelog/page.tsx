import Link from "next/link";
import { changelog } from "@/lib/changelog";

export const metadata = {
  title: "Changelog | Campaign Wiki",
  description: "Release history for Campaign Wiki.",
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <Link className="text-sm font-semibold text-[var(--accent)] hover:underline" href="/">← Campaign Wiki</Link>
      <header className="mt-5 border-b border-[var(--line)] pb-5">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Release notes</p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">Changelog</h1>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">A concise record of confirmed Campaign Wiki releases.</p>
      </header>

      <ol className="divide-y divide-[var(--line)]">
        {changelog.map((release) => (
          <li className="py-4 sm:py-5" key={release.version}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-serif text-xl font-semibold">v{release.version}</h2>
              <time className="text-sm text-[var(--muted)]" dateTime={release.date}>{release.date}</time>
            </div>
            <p className="mt-1 text-sm font-semibold">{release.title}</p>
            <ul className="mt-2 space-y-1 text-sm leading-6 text-[var(--muted)]">
              {release.changes.map((change) => <li key={change}>• {change}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}
