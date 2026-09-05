export default async function UploadPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16">
      <section className="w-full rounded-2xl border border-[var(--line)] bg-white/70 p-8 shadow-sm sm:p-12">
        <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-[var(--accent)]">Campaign Wiki</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">Your campaign, connected.</h1>
        <p className="mt-4 max-w-xl text-lg leading-8 text-[var(--muted)]">
          Upload one text-based campaign PDF and turn it into a source-backed, interconnected wiki.
        </p>
        <form className="mt-10 space-y-6" action="/api/campaigns" method="post" encType="multipart/form-data">
          {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</p> : null}
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Campaign name</span>
            <input className="w-full rounded-lg border border-[var(--line)] bg-white px-4 py-3 outline-none focus:border-[var(--accent)]" name="name" required maxLength={200} />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Campaign PDF</span>
            <input className="w-full rounded-lg border border-dashed border-[var(--line)] bg-white px-4 py-5" name="pdf" type="file" accept="application/pdf,.pdf" required />
          </label>
          <button className="rounded-lg bg-[var(--accent)] px-6 py-3 font-semibold text-white hover:brightness-110" type="submit">Generate Wiki</button>
        </form>
      </section>
    </main>
  );
}
