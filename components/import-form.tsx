export function ImportForm({ error, uploadsAllowed }: { error?: string; uploadsAllowed: boolean }) {
  return (
    <section aria-labelledby="import-heading" className="scroll-mt-6 rounded-2xl border border-[var(--line)] bg-white/70 p-7 shadow-sm sm:p-10" id="import">
      <p className="eyebrow">Start a campaign</p>
      <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight sm:text-4xl" id="import-heading">Import campaign material</h2>
      <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">Choose a text-based campaign PDF. Campaign Wiki will organize its source-backed entries and connections into a wiki you can open when it is ready.</p>
      {uploadsAllowed ? (
        <form action="/api/campaigns" className="mt-6 grid max-w-3xl gap-5" encType="multipart/form-data" method="post">
          {error ? <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</p> : null}
          <label><span className="mb-2 block text-sm font-semibold">Campaign name</span><input className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20" maxLength={200} name="name" required /></label>
          <label><span className="mb-2 block text-sm font-semibold">Campaign PDF</span><input accept="application/pdf,.pdf" className="w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-4 py-5 file:mr-4 file:rounded file:border-0 file:bg-[var(--paper)] file:px-3 file:py-1.5 file:font-semibold file:text-[var(--ink)]" name="pdf" required type="file" /></label>
          <button className="button-primary w-fit" type="submit">Create campaign wiki</button>
        </form>
      ) : <p className="mt-7 max-w-2xl rounded-lg border border-[var(--line)] bg-[var(--paper)]/70 px-4 py-3 text-sm leading-6 text-[var(--muted)]">This deployment is read-only. Campaign imports are performed locally.</p>}
    </section>
  );
}
