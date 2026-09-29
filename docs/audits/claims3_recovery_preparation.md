# Claims-3 connection recovery preparation — offline only

The first `test9-claims3-1` dispatch remains a failed attempt with unknown usage in the original, ignored `fixtures/private/claims3-v1/progress.v1.json` checkpoint. Its required SHA-256 is `6ab9140003a4255841da06673eae6ee142af703e0338689c9c8ab0d0aee91029`. This preparation made **zero model calls** and did not edit that file.

The connection diagnosis reproduced `UNABLE_TO_VERIFY_LEAF_SIGNATURE` with Node's default trust and a successful TLS-only handshake with `--use-system-ca`. The new `npm run evaluate:claims3` command launches the actual runner with that flag. Live dispatch also checks `process.execArgv` and refuses to proceed without it. The OpenAI client still uses `maxRetries: 0`.

## Recovery lineage and authorization

Use `--recovery-v1` to select the separate, ignored `fixtures/private/claims3-recovery-v1/` artifact directory. Before any live dispatch, the runner verifies the original failed checkpoint's bytes, identity, state, unknown usage and error. The new progress file will carry its SHA-256 and the prior failed attempt alongside each **new** attempt. It is written with `dispatching` state before the SDK call. A failed or uncertain recovery attempt blocks further automatic dispatch.

The ordinary path still reads the failed `claims3-v1` checkpoint and refuses to resume it. The recovery path requires **both** `--recovery-v1` and the distinct shell-level `ALLOW_PAID_CLAIMS3_RECOVERY_V1_LUNA=1`; the old `ALLOW_PAID_CLAIMS3_LUNA` flag cannot authorize it. It also requires `--live-luna`, an explicit request allowlist and `--max-calls` from 1 to 4. All new attempts, including failed or uncertain ones, count toward that cap. `test9-claims3-1` must complete in the recovery checkpoint before an untouched request can be sent alone.

Offline preflight, safe to run now:

```powershell
npm run evaluate:claims3 -- --recovery-v1
```

The following is the **future command shape only**. Do not use it without a separate live authorization:

```powershell
$env:ALLOW_PAID_CLAIMS3_RECOVERY_V1_LUNA='1'
npm run evaluate:claims3 -- --recovery-v1 --live-luna --allow-requests=test9-claims3-1 --max-calls=4
```

After a completed recovery, separately authorized untouched requests can use the same recovery directory and remaining new-attempt budget. The four source windows, request IDs, inventory and evidence manifests, prompt and schema, model, and output caps are unchanged.

## Offline verification

- The npm command displays `node --use-system-ca --conditions=react-server --import tsx` and completes the recovery preflight without an HTTP request.
- The recovery preflight reports the original failed attempt and zero recovery attempts. It has the same four frozen requests and 66,119-token reservation as the ordinary preflight.
- Focused tests cover the original resume block, distinct recovery authorization, separate checkpoint write without modifying the original, attempt accounting, recovery-first order and system-CA guard.

This code is prepared for a **separately authorized** live run. The original attempt's unknown usage remains unknown; the new path does not recast it as unused.
