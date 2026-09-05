# Known issues — Campaign Wiki v0

These limitations reflect implementation and local fixture testing on 2026-09-05.

The initial hosted setup exposed a Supabase default-privilege difference: the
`service_role` could bypass RLS but lacked table grants. Migration
`20260905152000_service_role_table_grants.sql` now grants the server role
explicit access and revokes direct `anon`/`authenticated` table access.

1. **The credentialed hosted pipeline has not been exercised in this checkout.** No OpenAI or Supabase credentials were available. PDF extraction, deterministic graph construction, UI compilation, and the fixture tests were exercised locally; applying migrations and running a real model-backed import still requires project credentials.

2. **Complex PDF reading order depends on embedded PDF text order.** The test-based PDFs preserve lines and pages correctly, but multi-column layouts, positioned sidebars, tables, or unusual font encodings may produce text in an unintuitive order. v0 intentionally has no OCR or layout reconstruction.

3. **Evidence validation balances false positives and model paraphrase.** Page numbers are strictly constrained to the input chunk. Supporting text must match normalized page text exactly or pass a conservative token-and-contiguous-phrase check. This can reject a valid heavily paraphrased quote, while a quote assembled from text on the same page cannot be proven semantically correct without another model judgment.

4. **Global reconciliation is one model request.** This keeps cross-chunk identity genuinely global for normal prototype-sized campaigns. A document producing an exceptionally large candidate list could exceed the selected model context and fail explicitly; v0 does not yet implement hierarchical reconciliation.

5. **Processing is an HTTP request, not a durable job.** The processing screen starts one server request and polls stage state. A platform hard timeout or process restart can mark or leave the import failed, after which it can be retried safely. There is no production job queue in v0.

6. **Search scans one campaign's persisted entities in server code.** Partial, case-insensitive name and alias matching works for prototype-sized campaigns, but it is not optimized for very large entity collections.

7. **No authentication is intentional for v0.** Database and Storage remain private behind server-only service-role access, but anyone who can access a deployed application can submit a campaign. Do not expose this prototype publicly without an external access control layer.
