import Link from "next/link";
import { CHANGELOG_PATH, currentChangelog } from "@/lib/changelog";

export function VersionLink() {
  const previewId = "current-release-preview";

  return (
    <div className="group fixed right-3 top-3 z-50">
      <Link
        aria-describedby={previewId}
        aria-label={`Campaign Wiki version ${currentChangelog.version}. View changelog.`}
        className="block rounded-full border border-[var(--line)] bg-white/90 px-3 py-1 font-mono text-xs font-semibold text-[var(--muted)] shadow-sm backdrop-blur transition hover:border-[var(--accent)] hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
        href={CHANGELOG_PATH}
      >
        v{currentChangelog.version}
      </Link>
      <div
        className="pointer-events-none absolute right-0 top-full mt-2 w-72 translate-y-1 rounded-xl border border-[var(--line)] bg-white p-4 text-left text-sm text-[var(--ink)] opacity-0 shadow-lg transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100 invisible"
        id={previewId}
        role="tooltip"
      >
        <p className="font-mono text-xs font-semibold text-[var(--accent)]">v{currentChangelog.version}</p>
        <p className="mt-1 font-semibold">{currentChangelog.title}</p>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-[var(--muted)]">
          {currentChangelog.changes.map((change) => <li key={change}>• {change}</li>)}
        </ul>
        <p className="mt-3 text-xs font-semibold text-[var(--accent)]">View full changelog →</p>
      </div>
    </div>
  );
}
