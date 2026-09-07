import Link from "next/link";
import { changelog } from "@/lib/changelog";

export const metadata = {
  title: "Changelog | Campaign Wiki",
  description: "Release history for Campaign Wiki.",
};

export default function ChangelogPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-16 sm:py-20">
      <Link className="text-sm font-semibold text-[var(--accent)] hover:underline" href="/">← Campaign Wiki</Link>
      <header className="mt-8 border-b border-[var(--line)] pb-8">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Release notes</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Changelog</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--muted)]">A concise record of confirmed Campaign Wiki releases.</p>
      </header>

      <ol className="divide-y divide-[var(--line)]">
        {changelog.map((release) => (
          <li className="py-8" key={release.version}>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-serif text-2xl font-semibold">v{release.version}</h2>
              <time className="text-sm text-[var(--muted)]" dateTime={release.date}>{release.date}</time>
            </div>
            <p className="mt-2 font-semibold">{release.title}</p>
            <ul className="mt-3 space-y-2 leading-7 text-[var(--muted)]">
              {release.changes.map((change) => <li key={change}>• {change}</li>)}
            </ul>
          </li>
        ))}
      </ol>
    </main>
  );
}
