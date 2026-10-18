# Core reliability audit and verification

Verified on 2026-10-17 with Node **22.23.3** and npm **10.9.9**. This phase
preserves the existing local fixture architecture, comparison semantics, bounded
greedy reduction algorithm, and Evidence Lab design. No dependencies were added.

## Verified defects corrected

| Defect observed before correction | Focused correction |
| --- | --- |
| An earlier JSON mismatch left `regression` true after a later reference status/capture failure, timeout, or transport failure. A reference capture failure on a differing step could also report REGRESSION. | Reference-invalid/incomplete paired execution is INCONCLUSIVE; previously observed steps remain evidence, not a trusted shrink baseline. Reference capture failure also takes precedence over simultaneous candidate status/malformed-response failure. |
| Cancellation inside a reduction became `EVALUATION_ERROR` and returned the last REGRESSION as the overall result. | Preserve `RUN_CANCELLED`, report INCONCLUSIVE/ABORTED, retain the actual trace and last verified scenario, and distinguish cancelled reset from started replay in counts. |
| A startup-failed shrink POST returned 404 for `scenario.original.json`, hiding the real startup diagnosis. | Use the same recorded-artifact model path for creation and retrieval; report unavailable reduction artifacts explicitly. Reset failures are covered too. |
| A request with a partially received body could start a complete job after shutdown began. | Set closing state before cancellation; both run and replay admission reject with 503, including pending-body requests. |
| The demo exited successfully for ABORTED reduction and threw TypeError on startup failure. | Success requires a completed/limit-bounded, actually replayed, target-preserving reduction; missing fields remain unavailable. |
| Capture name `__proto__` invoked an inherited setter rather than creating a captured variable. | Define captures as own data properties; retain existing allowed names and per-side contexts. |
| Error-record spreading overwrote `REFERENCE_NON_JSON`/`CANDIDATE_NON_JSON`; malformed response status/body diagnostics were discarded. | Preserve side-specific reason codes and bounded raw-body/status/truncation evidence. |
| Quantity-specific fixture delay was applied twice. | Apply the selected delay once, retaining step/quantity filtering. |
| Shrink evidence rails displayed no HTTP method for scenario-shaped steps. | Read the actual `step.request.method`, retaining recorded-step fallbacks. |

Evidence identity is also more explicit: input-file SHA-256 remains unchanged in
`scenario.sha256`; `replay.sha256` identifies the exact saved replay-file bytes.
Both are labeled separately in metadata. Reduction abort reasons are exposed in
the workbench model; accepted reductions require a real replay and nonfatal,
matching-signature execution.

## Missing assertions addressed

The original 26-test suite passed despite the failure-path defects above. The
expanded suite has **82 passing tests** (including nested fixture-delay cases):

- Same/different JSON values, types, missing/null values, key order, array order
  and length, nested ignored objects/array subtrees, exact escaped JSON Pointers,
  malformed pointer escapes, and capture array-index boundaries.
- Late reference status/capture failures and either-side transport/timeouts,
  including timeout during body consumption; retain actual paired observations.
- Malformed JSON on either/both sides, bounded diagnostics, candidate-only
  unexpected status, and safe special capture names.
- Real status-regression reduction with required setup, stable step ID/pointer/
  classification, and independent replay. Broken setup is rejected, not accepted
  as a different failure.
- Every accepted main-fixture reduction is replayed and preserves its target.
  Exported original/final scenarios are structurally equal to recorded evidence.
- Budget exhaustion after accepted progress and invalid dependency removal:
  **4 attempts, 3 replays, 2 accepted operations**, without a minimality claim.
- Cancellation during a reduction reset and during actual HTTP execution after
  accepted progress. The latter retains **3 attempts, 3 started replays, 1
  acceptance**, then stops and independently replays the verified best.
- Same-output-directory REGRESSION/shrink → PASS isolation, including clearing
  original-only artifacts, stale mismatch fields, and old replay hashes.
- Actual workbench API shrink → export → two-step replay → clean PASS; shared
  run/replay concurrency slot in both directions, cancellation slot release,
  startup/reset failure models, pending-body shutdown, malformed/oversized bodies,
  invalid configuration, and missing-artifact errors.
- Real demo subprocesses for completed, limit-bounded, aborted, and startup-failed
  execution; deterministic fixture-delay call counts; browser-free rail rendering.

The original safety, timeout, unrelated-signature rejection, deterministic search,
and process-cleanup assertions remain enabled and were not weakened.

## Actual verification results

| Check executed | Observed result |
| --- | --- |
| `npm ci --offline` | Exit 0; dependency-free install, 0 vulnerabilities reported. |
| `npm test` | **82 passed, 0 failed, 0 cancelled, 0 skipped**. Includes real workbench integration and fixture HTTP executions. |
| `npm run demo` | Exit 0; COMPLETED, 6 → 2 steps, 50 attempts, 46 actual replays, signature preserved. |
| `node bin/behavior-diff.mjs shrink scenarios/cart-noisy.json --out artifacts/reliability-cli-shrink --max-attempts 100` | Exit 0; SHRUNK, 50/100 attempts, two steps, limit not reached. |
| `node bin/behavior-diff.mjs run artifacts/reliability-cli-shrink/scenario.replay.json --out artifacts/reliability-cli-shrink/replay` | Observed exit 1; REGRESSION, `/items/0/lineTotal`, reference 2, candidate 1. |
| `node bin/behavior-diff.mjs run artifacts/demo-shrink/scenario.replay.json --out artifacts/demo-shrink/replay-reliability-check` | REGRESSION; same pointer and values. |
| `node --check` on changed application/test JavaScript | All checked files parsed successfully. |
| `git diff --check` | No whitespace errors. |

In addition to the automated API tests, a real ephemeral-loopback workbench smoke
run exercised this sequence, saving artifacts under
`artifacts/reliability-workbench/`:

| API operation | Actual result |
| --- | --- |
| Run `cart-total` | HTTP 201 REGRESSION; three steps, line total 20 versus 10. |
| Run `cart-total-pass` | HTTP 201 PASS; three steps, no mismatch. |
| Run `cart-noisy` | HTTP 201 REGRESSION; six steps, correct target. |
| Shrink `cart-noisy` | HTTP 201 REGRESSION / COMPLETED; six → two steps, 50 attempts, 46 replays, 11 accepted and 38 rejected candidate operations. |
| Export evidence and replay minimized scenario | Evidence equals returned raw model; replay returns HTTP 201 REGRESSION, same two steps, signature and values. |
| Run PASS after shrink/replay | HTTP 201 PASS, mismatch null, reduction null. Earlier evidence remains separate. |
| Shrink with startup timeout of 1 ms | HTTP 201 INCONCLUSIVE / STARTUP_TIMEOUT, rather than missing-original 404. |

The preserved signature is:

```json
{"stepId":"add-item","pointer":"/items/0/lineTotal","classification":"BUSINESS_DIFFERENCE"}
```

The saved minimized request has quantity 2 and unit price 1, so its recorded
reference/candidate line totals are **2 / 1**, rather than the original **20 / 10**.
`minimalUnderOperations=true` describes completion of the implemented greedy
operations only; it is **not** proof of global minimality.

Reproducible demo evidence remains at:

- `artifacts/demo-shrink/evidence.json`
- `artifacts/demo-shrink/scenario.original.json`
- `artifacts/demo-shrink/scenario.replay.json`
- `artifacts/demo-shrink/replay-reliability-check/evidence.json`

These generated artifacts are git-ignored. No Git commit or push was performed.

## Remaining limitations and risks (not demonstrated workflow failures)

- Docker and Chromium/Chrome executables are unavailable in this environment.
  **Docker build/run, full browser interaction, clipboard permissions, and visual
  verification were not performed.** Browser-free rendering checks are not a
  substitute for those checks. No separate build/lint/typecheck npm script exists.
- Headers are recorded for diagnostics; the existing semantic comparison contract
  compares status and JSON, not general header equivalence. This was preserved.
- Cancellation is exposed through client disconnection/server shutdown, not a
  separate cancel endpoint. In-progress cancelled replay does not invent missing
  response evidence; the last verified scenario/trace is retained and marked
  ABORTED/INCONCLUSIVE.
- A reset is not a general barrier against a handler continuing server-side after
  its HTTP client times out. Current fixture replays pass isolation checks; future
  fixtures with delayed cross-cart mutations would need stronger quiescence rules.
- Shrink attempt limits do not bound total memory. Scalar candidates are eagerly
  cloned and response bodies are not separately size-capped. The trusted fixture
  registry, request-size limits, redirects disabled, and loopback restriction
  remain unchanged; broader/untrusted fixtures are outside this phase.
- Evidence files are written sequentially, not as an atomic multi-file transaction.
  Interrupted filesystem writes may leave an incomplete directory. The workbench
  omits unreadable/incomplete runs rather than synthesizing results.

**Next phase:** run one browser-level regression → shrink → replay walkthrough
and a clean Docker build in an equipped environment, retaining `npm test` as the
core gate. Address any demonstrated interaction defects before considering
another UI redesign.
