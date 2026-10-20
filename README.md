# BehaviorDiff

BehaviorDiff compares two **real local HTTP/JSON processes**. It replays the same
stateful scenario against an old cart fixture and a candidate cart fixture,
compares response status and JSON semantics, and can shrink a noisy failing
scenario through verified actual replays.

The checked-in candidate intentionally contains a business regression: it ignores
`quantity` when calculating `lineTotal`, `subtotal`, and `total`.

## Requirements

- Node.js `22.23.3` (the version is pinned in `.nvmrc`)
- npm 10 or newer
- No external network, database, or service

The project has no runtime dependencies. `package-lock.json` is retained for
reproducible installs.

## Install, test, and demo

```bash
npm ci --offline
npm run build
npm test
npm run demo
```

`npm run build` creates a dependency-free production copy in `dist/` and
syntax-checks the browser scripts. Run the built local workbench with:

```bash
node dist/bin/behavior-diff-workbench.mjs --port 4173
```

`npm test` is the acceptance gate. It starts the fixture implementations as child
processes on dynamically allocated `127.0.0.1` ports and checks PASS, REGRESSION,
replay, semantic-ignore, shrinking, signature preservation, attempt limits,
startup-timeout, request-timeout, and cleanup paths. It also covers late failures,
malformed responses, cancellation during reduction, workbench shutdown/concurrency,
and the real API shrink/export/replay/PASS-isolation journey. See
[RELIABILITY.md](RELIABILITY.md) for the reliability audit and verification record.

`npm run demo` runs a noisy six-step scenario and exits successfully after
performing actual reduction attempts. It prints accepted and rejected attempts,
the actual old and candidate response bodies, and writes:

```text
artifacts/demo-shrink/evidence.json
artifacts/demo-shrink/scenario.original.json
artifacts/demo-shrink/scenario.replay.json
```

## CLI

Run the regression fixture pair directly:

```bash
node bin/behavior-diff.mjs \
  run scenarios/cart-total.json \
  --out artifacts/cart-total
```

The command exits with:

| Code | Meaning |
| ---: | --- |
| `0` | `PASS`: both services completed and all compared responses were equivalent after explicit ignores |
| `1` | `REGRESSION`: comparable responses differ, including a status or business JSON difference |
| `2` | `INCONCLUSIVE`: startup, timeout, transport, or reference-protocol evidence was incomplete |
| `3` | `CONFIG_ERROR`: malformed scenario or unsupported configuration |

The defective demo exits `1` when run through the CLI. A successful CLI summary
looks like this for the intentional defect:

```text
REGRESSION
step=add-item
pointer=/items/0/lineTotal
reference=20
candidate=10
evidence=.../evidence.json
```

Every valid run writes both `evidence.json` and `scenario.replay.json`, including
startup and request-timeout runs. The evidence includes service PIDs, loopback
URLs, resolved requests, response headers and bodies, captures, comparisons,
ignored volatile differences, and the first business mismatch.

Reference-protocol failures and either-side timeout/transport failures make the
whole run `INCONCLUSIVE`, even if an earlier step recorded a mismatch. Those
observed differences remain in the evidence but are not a trusted shrink baseline.
Candidate-only status, malformed-JSON, and missing-capture regressions retain
their existing classifications; malformed/capture failures cannot be accepted as
shrink reproductions.

`scenario.sha256` identifies the original input file bytes. `replay.sha256`
identifies the exact saved `scenario.replay.json` bytes, which can differ from
the input after formatting or reduction. Both identities are labeled separately
in the workbench metadata.

## Phase 2 stateful shrinking

Run the deterministic shrinker with:

```bash
node bin/behavior-diff.mjs shrink \
  scenarios/cart-noisy.json \
  --out artifacts/cart-noisy-shrink \
  --max-attempts 100
```

The shrinker first records a trusted baseline mismatch. It then tries, in stable
order, to remove one step at a time. Every valid candidate calls `/reset` on both
real fixture processes and replays the candidate scenario through HTTP before it
can be accepted. Invalid candidates are rejected before service execution. After
step removal reaches a fixed point, it tries bounded scalar reductions:

- positive integers: `1`, then `0`;
- nonempty strings: first character, then empty string;
- arrays: remove each element;
- objects: remove each property.

Only scenario variables and inline request bodies are simplified. `$var` wrappers,
capture definitions, methods, expected statuses, JSON Pointers, and templated
paths are not rewritten. No arbitrary fuzzing is performed.

The mismatch identity is stable across step-index changes and contains only:

```json
{
  "stepId": "add-item",
  "pointer": "/items/0/lineTotal",
  "classification": "BUSINESS_DIFFERENCE"
}
```

The step ID, not its array index, identifies the target. A candidate is accepted
only when actual replay produces the same signature. `PASS`, timeouts, transport
errors, service crashes, malformed responses, missing captures, and unrelated
mismatches are rejected. A candidate with an invalid response-variable dependency
is rejected before replay.

`maxAttempts` includes the original baseline replay and every candidate evaluation.
Invalid candidates consume an attempt but do not increment `actualReplays`. The
evidence records both counts, every accepted/rejected candidate, the candidate
scenario, validation/replay reason, original and final signatures, and whether the
attempt limit was reached. `minimalUnderOperations` is true only after the full
implemented greedy step/scalar search completes without an attempt limit or
abort. It does not claim global minimality beyond those operations.

`actualReplays` counts started scenario evaluations after successful reset,
including a replay interrupted by cancellation. A failed or cancelled reset does
not count as a replay. Cancellation during reduction records `ABORTED` with
`RUN_CANCELLED`, makes the overall outcome `INCONCLUSIVE`, and preserves the
last verified best scenario and actual attempt trace without claiming completion.
Other aborted reductions also retain the last verified best, with the abort
reason in reduction evidence. The demo exits unsuccessfully for an abort.

The shrink command returns exit code `0` for a verified completed or limit-bounded
reduction, `2` when the baseline is not a trusted reproducing mismatch or the
shrink run aborts, and `3` for configuration errors. The final
`scenario.replay.json` is standalone and can be run with the normal `run` command
to reproduce the same semantic mismatch. `scenario.original.json` preserves the
input used for the baseline.

## Scenario format

Scenarios are JSON documents with this shape:

```json
{
  "version": 1,
  "name": "cart quantity contributes to total",
  "seed": 1,
  "services": {
    "reference": "old-cart",
    "candidate": "candidate-cart"
  },
  "variables": {
    "sku": "coffee",
    "quantity": 2,
    "unitPrice": 10
  },
  "steps": [
    {
      "id": "create-cart",
      "request": {
        "method": "POST",
        "path": "/carts",
        "body": {}
      },
      "expect": { "status": 201 },
      "capture": { "cartId": "/cartId" },
      "ignorePaths": ["/cartId", "/meta/requestId"]
    },
    {
      "id": "add-item",
      "request": {
        "method": "POST",
        "path": "/carts/{{cartId}}/items",
        "body": {
          "sku": { "$var": "sku" },
          "quantity": { "$var": "quantity" },
          "unitPrice": { "$var": "unitPrice" }
        }
      },
      "expect": { "status": 200 },
      "ignorePaths": ["/cartId", "/meta/requestId"]
    },
    {
      "id": "read-cart",
      "request": {
        "method": "GET",
        "path": "/carts/{{cartId}}"
      },
      "expect": { "status": 200 },
      "ignorePaths": ["/cartId", "/meta/requestId"]
    }
  ]
}
```

Supported request methods are `GET` and `POST`, and paths must be relative paths
on the local fixture. `{{name}}` embeds a scalar variable in a path. An object of
the exact form `{ "$var": "name" }` inserts the original JSON value into a body.
There are no expressions, shell strings, remote URLs, or executable scenario
content.

Captures are resolved independently for reference and candidate. In the example,
the later requests use different actual paths such as
`/carts/old-cart-cart-1/items` and `/carts/candidate-cart-cart-1/items`, while
their logical method and request body are the same.

The optional non-negative `seed` is part of the deterministic scenario input. The
Phase 1 fixtures use deterministic counters rather than randomness, and each run
starts fresh processes and calls their fixed `/reset` endpoint before replay, so
the same scenario input produces the same business responses.

`ignorePaths` accepts only explicit non-empty RFC 6901 JSON Pointers. It removes
only the named subtree from semantic comparison. The evidence records any values
that differed at ignored paths under `ignoredDifferences`; business differences
remain under `differences` with their exact JSON Pointer. Object key order is
ignored, array order is significant, and values are not broadly normalized.

## Fixture services

The fixture processes are checked in under `fixtures/`:

- `old-service.mjs`: correct cart totals
- `candidate-service.mjs`: intentional quantity regression
- `candidate-fixed-service.mjs`: correct candidate behavior with different JSON key insertion order for the PASS path

The runner maps these names to fixed Node entry points. It never executes a path,
shell command, repository, or user-provided program. Each service binds only to a
fresh loopback port and is terminated after replay, including failed startup and
timeout paths. HTTP requests disable redirects, require the configured service to
remain on loopback, and cap serialized request bodies at 1 MB.

## Investigation workbench

The local workbench is a thin Node.js HTTP server and static browser UI over the
existing runner, comparator, shrinker, and evidence artifacts. It does not create
mock responses or calculate a second set of metrics. The browser receives the
recorded response bodies, JSON Pointer differences, ignored differences, reduction
attempts, scenario files, and replay command produced by the CLI engine.

Start it after installing dependencies:

```bash
npm run workbench
```

The root URL is the product landing page. The working Evidence Lab is available at
`http://127.0.0.1:4173/lab` (the landing page's **Launch Evidence Lab** action
opens this route). Open `http://127.0.0.1:4173/` for the landing page. To use an
automatically allocated port, run:

```bash
node bin/behavior-diff-workbench.mjs --port 0
```

For the end-to-end judge walkthrough, open `/lab`, choose `cart-noisy`, select **Shrink**, and
press **Run investigation**. The browser then waits for the real six-step replay,
shows the line-total regression, lists the actual accepted and rejected reduction
replays, and renders the resulting two-step scenario. Use **Replay minimized
scenario** to execute the exported artifact again; the returned response bodies
and mismatch remain evidence-backed. The standalone CLI equivalent is:

```bash
npm run demo
node bin/behavior-diff.mjs run artifacts/demo-shrink/scenario.replay.json \
  --out artifacts/demo-shrink/replay-workbench-check
```

Expected CLI results are `outcome=REGRESSION`, `finalSteps=2`, and the target
`/items/0/lineTotal`; the standalone replay exits with code `1` and reports the
same target. Stop the workbench with `Ctrl-C`. To remove generated judge artifacts
after a walkthrough, run:

```bash
rm -rf artifacts/demo-shrink artifacts/demo-shrink/replay-workbench-check \
  artifacts/workbench
```

The workbench exposes only the checked-in `cart-total`, `cart-total-pass`, and
`cart-noisy` scenarios. It maps those IDs to files under `scenarios/`, validates
their existing schema, and keeps the fixture registry in `src/fixture-process.mjs`
as the only executable mapping. It does not accept arbitrary filesystem paths,
remote URLs, shell commands, or user-provided executables. The **Replay minimized
scenario** action is a real local `runScenario` invocation against the exported
`scenario.replay.json`; its result is shown as `REGRESSION`, `PASS`, or
`INCONCLUSIVE` only after the replay returns.

The server permits one long-running run or replay at a time and returns HTTP 429
for another job while it is active. Request bodies are capped at 32 KiB and
incomplete connections time out after the server's bounded request timeout. If a
browser request is cancelled or the workbench receives SIGINT/SIGTERM, the active
run is cancelled and the fixture processes are cleaned up through the normal
runner `finally` path.

Shutdown rejects job admission with HTTP 503, including requests whose bodies
were still arriving when shutdown began. Startup/reset failure before reduction
returns the real `INCONCLUSIVE` model; reduction measurements and the separate
original-scenario artifact are explicitly unavailable because reduction did not
start. The replay artifact still contains the input scenario.

The UI deliberately labels unavailable fields instead of estimating them. In a
shrink run, `minimalUnderOperations` means the implemented greedy step deletion
and scalar simplification operations completed; it is not a claim of global
optimality. Ignored volatile differences remain visible in their own panel even
when the overall outcome is `PASS`.

## Docker preparation

The minimal Dockerfile uses the pinned Node 22 image and offline `npm ci`:

```bash
docker build -t behaviordiff .
docker run --rm -v "$PWD:/app" behaviordiff \
  run scenarios/cart-total.json --out artifacts/container-run
```

The Docker image keeps the CLI as its default entrypoint. The workbench can be
started in a derived/local container with the same checked-in files by overriding
the command, for example:

```bash
docker run --rm --network host --entrypoint node behaviordiff \
  bin/behavior-diff-workbench.mjs --port 4173
```

The server still binds to loopback. On Linux, `--network host` makes that
container loopback address available to the local browser; Docker Desktop users
should use a local CLI/demo verification or a documented loopback networking
configuration rather than changing the application bind address.
