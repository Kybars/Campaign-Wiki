import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24 text-center">
      <h1 className="font-serif text-4xl font-semibold">Page not found</h1>
      <p className="mt-4 text-[var(--muted)]">This campaign or entity could not be found.</p>
      <Link className="mt-8 inline-block font-semibold text-[var(--accent)] underline" href="/">Upload a campaign</Link>
    </main>
  );
}
