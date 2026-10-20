# BehaviorDiff

> **Forensic Behavioral Differential Testing & Delta-Debugging Engine for HTTP/JSON Services**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE.md)
[![Node.js Version](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-brightgreen.svg)](package.json)
[![Tests Passing](https://img.shields.io/badge/Tests-87%20passed-success.svg)](test/workbench.test.mjs)
[![Architecture: Zero Runtime Dependencies](https://img.shields.io/badge/Dependencies-Zero%20Runtime-orange.svg)](package.json)
[![Status: Production Ready](https://img.shields.io/badge/Stability-Verified%20Reliable-blueviolet.svg)](RELIABILITY.md)
[![Live Website](https://img.shields.io/badge/Live%20Website-behaviordiff.onrender.com-success.svg?style=flat&logo=render)](https://behaviordiff.onrender.com/)
[![Video Demo](https://img.shields.io/badge/Video%20Demo-YouTube%20Watch-red.svg?style=flat&logo=youtube)](https://youtu.be/6_B9Yxa2DHs)

> **Live Website**: [https://behaviordiff.onrender.com/](https://behaviordiff.onrender.com/)  
> **Evidence Lab GUI**: [https://behaviordiff.onrender.com/lab](https://behaviordiff.onrender.com/lab)  
> **Video Demo Walkthrough**: [https://youtu.be/6_B9Yxa2DHs](https://youtu.be/6_B9Yxa2DHs)

---

## Table of Contents

- [Overview](#overview)
- [The Real-World Problem](#the-real-world-problem)
- [How BehaviorDiff Solves It](#how-behaviordiff-solves-it)
- [Technologies & Languages](#technologies--languages)
- [Architecture & Workflow](#architecture--workflow)
  - [System Architecture Diagram](#system-architecture-diagram)
  - [Execution & Shrinking Workflow](#execution--shrinking-workflow)
- [The Evidence Lab & Workbench](#the-evidence-lab--workbench)
- [Verification & Execution Gallery](#verification--execution-gallery)
  - [Automated Test Suite (87/87 Passed)](#1-automated-test-suite-8787-passed)
  - [Production Distribution Build](#2-production-distribution-build)
  - [Delta-Debugging & Shrinking Demo](#3-delta-debugging--shrinking-demo)
- [Demo Walkthrough Video](#demo-walkthrough-video)
- [Scenario Anatomy & Delta Shrinking](#scenario-anatomy--delta-shrinking)
- [Getting Started & Installation](#getting-started--installation)
- [Running with Docker](#running-with-docker)
- [Deployment to Render](#deployment-to-render)
- [Built with OmniRush](#built-with-omnirush)
- [License & Copyright](#license--copyright)

---

## Overview

**BehaviorDiff** is an enterprise-grade forensic testing engine designed to detect, isolate, and prove subtle behavioral regressions between two versions of an HTTP/JSON service (a trusted **Reference** vs. a **Candidate**).

Instead of treating API tests as simple pass/fail assertions or brittle text diffs, BehaviorDiff executes stateful, multi-step scenario sequences against both systems in parallel. When a discrepancy occurs, it doesn't leave engineers with hundreds of lines of confusing diffs—it engages an **autonomous delta-debugging (shrinking) loop** that methodically eliminates irrelevant steps and simplifies data payloads until only the minimal reproducing sequence remains.

Every run produces cryptographic, verifiable evidence artifacts with exact **RFC 6901 JSON Pointers**, zero-mock response bodies, and an isolated CLI replay command.

---

## The Real-World Problem

Modern backend and microservice architectures suffer from insidious regressions that unit tests and mock-heavy integration suites fail to catch:

1. **Stateful Accumulation**: Bugs frequently only manifest after a specific sequence of previous mutations (e.g., creating a session, configuring a cart, applying discounts, updating address, checking out). Identifying *which* step triggered the bug is tedious.
2. **Volatile Noise in Diffs**: Naive JSON diffing breaks on dynamic identifiers, UUIDs, timestamps, and randomized token values. Engineers spend hours sifting through false positives.
3. **Noisy Reproductions**: When QA or telemetry catches an error, the reproduction steps often contain 10 to 50 unnecessary user actions. Handing a 30-step bug report to a backend developer leads to wasted triage time.
4. **"Works on My Machine" Friction**: Bug reports lack verifiable, self-contained replay commands that execute against clean service baselines with guaranteed process isolation.

---

## How BehaviorDiff Solves It

BehaviorDiff introduces an automated, deterministic forensic pipeline:

- **Paired Execution with Dynamic Captures**: Replays scenarios against isolated loopback processes for both reference and candidate. Variables (such as `cartId`) captured dynamically from earlier responses are routed independently to subsequent requests.
- **Strict Semantic RFC 6901 Pointer Comparison**: Ignores irrelevant key ordering and strips explicit volatile paths (e.g., `/cartId`, `/meta/requestId`), while pinpointing the exact differing property (e.g., `/items/0/lineTotal`).
- **Autonomous Greedy Delta-Debugging (Shrinking)**: Automatically mutates failing scenarios through step deletion, scalar simplification, and array reduction. It verifies each reduction by executing a real replay and ensures the regression signature matches the target mismatch before accepting the reduction.
- **Cryptographic Replay Artifacts**: Outputs a standalone `scenario.replay.json` containing only the minimized steps, accompanied by an `evidence.json` metadata audit trail with SHA-256 integrity hashes.
- **Interactive Evidence Lab**: A zero-mock local investigation web application with an immersive 3D spatial field that visualizes the reduction trace and allows engineers to run and replay investigations directly from the browser.

---

## Technologies & Languages

BehaviorDiff is engineered with a strict **Zero Runtime Dependencies** philosophy for its backend engine, guaranteeing maximum portability, security, and deterministic execution.

| Layer | Technologies Used | Description |
|---|---|---|
| **Core Engine** | **Node.js (ES Modules)**, JavaScript | Built natively on Node.js `>=22.0.0` utilizing native `node:test`, `node:http`, `node:fs/promises`, and `node:crypto`. Zero npm runtime dependencies. |
| **Frontend UI** | **HTML5, Vanilla CSS3, JavaScript** | Hand-crafted industrial forensic design system. Uses CSS custom properties, responsive grid layouts, glassmorphism, and micro-particle interaction effects. |
| **Spatial 3D Canvas** | **Three.js, Vanta.js (Halo & Fog)** | Hardware-accelerated WebGL ambient atmospheres (`Vanta.HALO` on landing, `Vanta.FOG` in Evidence Lab) with graceful fallback and `prefers-reduced-motion` compliance. |
| **Data Formats** | **JSON, RFC 6901 JSON Pointers** | Declarative scenarios, variable bindings, pointer ignores, and serialized evidence artifacts. |
| **Containerization** | **Docker** (Debian Bookworm Slim) | Minimal reproducible container build with pinned Node 22 runtime and loopback network binding. |
| **Testing & Quality** | **Node.js Test Runner (`node --test`)** | 82 rigorous test suites validating protocol safety, transport timeouts, crash isolation, and workbench delivery. |

---

## Architecture & Workflow

### System Architecture Diagram

```mermaid
graph TB
    subgraph ClientInterfaces ["User & Client Interfaces"]
        CLI["CLI Engine<br/><code>bin/behavior-diff.mjs</code>"]
        WebLanding["Product Landing Page<br/><code>public/index.html</code>"]
        EvidenceLab["Evidence Lab GUI<br/><code>public/lab.html</code>"]
    end

    subgraph WorkbenchServer ["Local Workbench Server (Loopback:4173)"]
        Server["HTTP Gateway & Slot Allocator<br/><code>src/workbench-server.mjs</code>"]
        StaticServe["Static Asset Router & Delivery<br/>(Styles, Scripts, Logos, 3D Assets)"]
    end

    subgraph ForensicCore ["Forensic Core Engine"]
        Runner["Scenario Runner & Concurrency Guard<br/><code>src/scenario-runner.mjs</code>"]
        ProcessMgr["Fixture Process Manager<br/><code>src/fixture-process.mjs</code>"]
        HttpTransport["Loopback HTTP Adapter & Timeout Guard<br/><code>src/http-adapter.mjs</code>"]
        Comparator["RFC 6901 Semantic Comparator<br/><code>src/comparator.mjs</code>"]
        Shrinker["Delta-Debugging Shrinker Engine<br/><code>src/shrinker.mjs</code>"]
        EvidenceGen["Evidence Packager & SHA-256 Signer<br/><code>src/evidence.mjs</code>"]
    end

    subgraph ServiceBoundary ["Isolated Local Fixtures (Dynamic Loopback Ports)"]
        RefService["Reference Baseline Service<br/><code>fixtures/old-service.mjs</code>"]
        CandService["Candidate SUT Service<br/><code>fixtures/candidate-service.mjs</code>"]
    end

    subgraph ArtifactStorage ["Evidence & Artifact Storage"]
        ReplayJSON["Minimized Replay Scenario<br/><code>scenario.replay.json</code>"]
        EvidenceJSON["Cryptographic Evidence<br/><code>evidence.json</code>"]
        OriginalJSON["Baseline Scenario<br/><code>scenario.original.json</code>"]
    end

    CLI --> Runner
    WebLanding --> Server
    EvidenceLab --> Server
    Server --> StaticServe
    Server --> Runner

    Runner --> ProcessMgr
    ProcessMgr --> RefService
    ProcessMgr --> CandService
    Runner --> HttpTransport
    HttpTransport --> RefService
    HttpTransport --> CandService

    Runner --> Comparator
    Runner --> Shrinker
    Shrinker --> Runner
    Comparator --> EvidenceGen
    EvidenceGen --> ReplayJSON
    EvidenceGen --> EvidenceJSON
    EvidenceGen --> OriginalJSON
```

---

### Execution & Shrinking Workflow

```mermaid
sequenceDiagram
    autonumber
    actor Dev as Developer / CI
    participant Engine as BehaviorDiff Core
    participant Fixture as Fixture Processes (Ref & Cand)
    participant Comp as Semantic Comparator
    participant Shrink as Delta Shrinker
    participant Store as Evidence Store

    Dev->>Engine: Run Scenario (e.g. cart-noisy.json)
    Engine->>Fixture: Spawn isolated services on ephemeral loopback ports
    Engine->>Fixture: POST /reset (Clear state)
    loop Each Scenario Step
        Engine->>Fixture: POST / GET with dynamic captures
        Fixture-->>Engine: Status & JSON Response Body
    end
    Engine->>Comp: Compare Reference vs Candidate bodies
    Note over Comp: Filter RFC 6901 ignorePaths<br/>Compare remaining structural JSON
    Comp-->>Engine: Regression Detected: /items/0/lineTotal (Ref: 2 != Cand: 1)
    
    alt Shrink Mode Enabled
        Engine->>Shrink: Engage Delta Debugging Loop
        loop Mutation Attempts (Max Bounded)
            Shrink->>Shrink: Mutate Scenario (Remove step / simplify scalar)
            Shrink->>Fixture: Replay mutated candidate sequence
            Fixture-->>Shrink: Status & Response
            Shrink->>Comp: Check if target mismatch is preserved
            alt Target Preserved & Valid
                Shrink->>Shrink: Accept reduction (e.g. 6 steps -> 2 steps)
            else Broken Setup or Unrelated Mismatch
                Shrink->>Shrink: Reject reduction & rollback
            end
        end
        Shrink-->>Engine: Minimized Scenario (2 steps: create-cart, add-item)
    end

    Engine->>Store: Write scenario.replay.json & evidence.json
    Store-->>Dev: Return outcome=REGRESSION, finalSteps=2, replay command
```

---

## The Evidence Lab & Workbench

BehaviorDiff comes equipped with an interactive **Evidence Lab** (`http://127.0.0.1:4173/lab`) powered by a high-performance, single-tenant local server (`src/workbench-server.mjs`).

- **Truthful Execution**: The Evidence Lab does not construct synthetic mock data. When you click **Run investigation**, the server coordinates real process spawns, real HTTP socket communication, and real delta-debugging iterations.
- **Dynamic Reduction Trace**: Live inspection rail showing original steps vs. removed steps, attempts evaluated, candidate operations accepted vs. rejected, and exact reasons for rejection (`CONFIG_ERROR`, `MISMATCH_NOT_REPRODUCED`, `INCONCLUSIVE_REPLAY`).
- **Interactive Specimen Diffing**: Clean tabular inspection showing Reference JSON vs. Candidate JSON side-by-side with highlight focus on the exact failing JSON Pointer.
- **One-Click Verified Replay**: Trigger an independent replay of the generated `scenario.replay.json` directly from the web interface.
- **Spatial Atmospheric Field**: An industrial graphite visual interface featuring subtle Three.js Vanta Halo and Fog background effects, fluid button particle feedback, and automatic reduction when `prefers-reduced-motion` is detected.

---

## Verification & Execution Gallery

All execution flows have been validated with comprehensive test suites, production build gates, and automated end-to-end delta-debugging demos.

### 1. Automated Test Suite (87/87 Passed)

The test suite validates deep transport isolation, socket crashes, late candidate timeouts, escaped JSON Pointer matching, API concurrency safety, Render deployment configurations, and public host access protection.

| Test Execution Overview | Test Completion & Full Suite Pass (87/87) |
|---|---|
| ![npm test Part 1](docs/assets/npm-test-01.png) | ![npm test Part 2](docs/assets/npm-test-02.png) |
| *Part 1: Protocol robustness, transport timeout handling, late reference/candidate failures, crash recovery, and comparator semantics.* | *Part 2: 87 tests completed successfully with 0 failures, 0 cancellations, and 0 skipped tests (~15.4s duration).* |

---

### 2. Production Distribution Build

BehaviorDiff includes a standalone distribution packaging pipeline (`scripts/build.mjs`) that syntax-checks browser scripts and creates a clean `dist/` bundle without external packaging dependencies.

| Production Build Output |
|---|
| ![npm run build](docs/assets/npm-build.png) |
| *`npm run build`: Compiles `dist/` directory with 5 core source directories (`bin`, `fixtures`, `public`, `scenarios`, `src`) and validates all client modules.* |

---

### 3. Delta-Debugging & Shrinking Demo

Demonstrating the reduction of a noisy 6-step cart checkout scenario down to the minimal 2 steps that reproduce the bug.

| Shrink Search Phase (Attempts 1–33) | Shrink Verification & Evidence Generation (Attempts 34–50) |
|---|---|
| ![npm run demo Part 1](docs/assets/npm-demo-01.png) | ![npm run demo Part 2](docs/assets/npm-demo-02.png) |
| *Part 1: Greedy step removal and scalar simplification attempting 33 systematic mutations against live fixture processes.* | *Part 2: Completion of reduction (6 steps -> 2 steps: `create-cart` + `add-item`), verifying target signature `/items/0/lineTotal` mismatch (Ref: 2 vs. Cand: 1) and exporting replay artifacts.* |

---

## Demo Walkthrough Video

Watch the comprehensive video walkthrough demonstrating the BehaviorDiff forensic engine, autonomous delta-debugging (shrinking), and the Evidence Lab in action:

[![BehaviorDiff Demo Walkthrough Video](https://img.youtube.com/vi/6_B9Yxa2DHs/maxresdefault.jpg)](https://youtu.be/6_B9Yxa2DHs)

| Video Demo Walkthrough | Live Deployment |
|---|---|
| **YouTube**: [https://youtu.be/6_B9Yxa2DHs](https://youtu.be/6_B9Yxa2DHs) | **Render**: [https://behaviordiff.onrender.com/](https://behaviordiff.onrender.com/) |

> **What the demo covers**:
> 1. Launching the interactive **Evidence Lab** interface with dynamic 3D spatial atmosphere (`Vanta.FOG`).
> 2. Executing an autonomous **delta-debugging shrink run** on the noisy 6-step `cart-noisy` scenario.
> 3. Eliminating 4 noisy, unrelated mutations while isolating the single root cause: `/items/0/lineTotal` (Reference `2` vs. Candidate `1`).
> 4. Triggering an **independent replay** of the minimized 2-step scenario and verifying the regression outcome.

---

## Scenario Anatomy & Delta Shrinking

### How It Solves Real-World Complex Scenarios

Consider a typical e-commerce failure: a candidate backend service regresses on calculating the line total for an item when quantity is greater than 1.

The original reported scenario (`scenarios/cart-noisy.json`) has **6 noisy steps**:
1. `create-cart` (Initializes cart session)
2. `add-item` (Adds item with quantity 2, unitPrice 1)
3. `apply-coupon` (Applies a discount code - *unrelated noise*)
4. `update-address` (Updates shipping postal code - *unrelated noise*)
5. `add-note` (Adds checkout notes - *unrelated noise*)
6. `read-cart` (Reads final cart totals)

#### Input Scenario Definition

```json
{
  "version": 1,
  "name": "cart quantity contributes to total (noisy)",
  "seed": 1,
  "services": {
    "reference": "old-cart",
    "candidate": "candidate-cart"
  },
  "variables": {
    "sku": "coffee",
    "quantity": 2,
    "unitPrice": 1
  },
  "steps": [
    {
      "id": "create-cart",
      "request": { "method": "POST", "path": "/carts", "body": {} },
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
    }
    /* Steps 3, 4, 5, 6 contain noisy mutations */
  ]
}
```

#### What Delta-Debugging Does

1. **Baseline Execution**: Discovers that at step `add-item`, the Reference returns `lineTotal: 2`, while the Candidate returns `lineTotal: 1`. Signature established:
   ```json
   { "stepId": "add-item", "pointer": "/items/0/lineTotal", "classification": "BUSINESS_DIFFERENCE" }
   ```
2. **Delta Elimination**: Attempts removing steps 5, 4, 3, etc. When removing `apply-coupon` or `update-address`, the mismatch at `add-item` is still reproduced identically! The reduction is **ACCEPTED**.
3. **Setup Protection**: When attempting to remove `create-cart`, subsequent requests fail with 404 because `cartId` is missing. The engine rejects this reduction (`CONFIG_ERROR`) and preserves the necessary prerequisite.
4. **Scalar Simplification**: Simplifies variable strings, numbers, and auxiliary properties without losing the signature.
5. **Output**: Exports a minimal 2-step `scenario.replay.json` containing only `create-cart` and `add-item`!

---

## Getting Started & Installation

### Prerequisites

- **Node.js**: `v22.0.0` or higher (tested on `v22.18.0` / `v22.23.3`)
- **npm**: `v10.0.0` or higher
- **OS**: Linux, macOS, or Windows

### 1. Clone & Install

```bash
git clone https://github.com/Aman-Raj-bat/BehaviorDiff.git
cd BehaviorDiff

# Offline, deterministic install with pinned dependencies
npm ci --offline
```

### 2. Run the Verification Suite

```bash
npm test
```

### 3. Build Production Bundle

```bash
npm run build
```

This generates `dist/` containing syntax-checked client files, scripts, and fixtures. You can launch the workbench directly from the built bundle:

```bash
node dist/bin/behavior-diff-workbench.mjs --port 4173
```

### 4. Execute the Delta-Shrinking Demo

```bash
npm run demo
```

Inspect the generated evidence files in `artifacts/demo-shrink/`:
- `artifacts/demo-shrink/scenario.replay.json`
- `artifacts/demo-shrink/evidence.json`

### 5. Launch the Evidence Lab Web App

```bash
npm run workbench
```

Open your browser to:
- **Landing Showcase**: `http://127.0.0.1:4173/`
- **Interactive Evidence Lab**: `http://127.0.0.1:4173/lab`

---

## Running with Docker

BehaviorDiff includes a pinned Debian Bookworm container setup for isolated container execution.

### Build the Image

```bash
docker build -t behaviordiff:latest .
```

### Run a Scenario CLI Investigation in Docker

```bash
docker run --rm -v "${PWD}/artifacts:/app/artifacts" behaviordiff:latest \
  run scenarios/cart-total.json --out artifacts/container-run
```

### Run the Evidence Lab Workbench via Docker

```bash
docker run --rm -it -p 4173:4173 --network host --entrypoint node behaviordiff:latest \
  bin/behavior-diff-workbench.mjs --port 4173
```

> **Note for Docker Desktop (macOS/Windows)**: Use port mapping `-p 4173:4173` and visit `http://localhost:4173`. On native Linux, `--network host` connects directly to the container's loopback interface.

---

## Deployment to Render

> **Live Production Deployment**: BehaviorDiff is actively deployed and accessible at **[https://behaviordiff.onrender.com/](https://behaviordiff.onrender.com/)** (and the Evidence Lab at **[https://behaviordiff.onrender.com/lab](https://behaviordiff.onrender.com/lab)**).

BehaviorDiff is fully configured for zero-configuration, secure deployment as a **Web Service** on [Render](https://render.com/).

### Option A: Automated Blueprint Deployment (`render.yaml`)

The repository includes a production-ready `render.yaml` blueprint. To deploy with one click:

1. Push your repository to GitHub.
2. In the Render Dashboard, navigate to **Blueprints** → **New Blueprint Instance**.
3. Select your `BehaviorDiff` repository.
4. Render will read `render.yaml`, configure Node.js 22, bind `HOST: 0.0.0.0`, and automatically generate a cryptographically secure `WORKBENCH_AUTH_TOKEN`.
5. Click **Apply**.

```yaml
# render.yaml
services:
  - type: web
    name: behaviordiff
    env: node
    plan: starter
    buildCommand: npm ci --offline && npm run build
    startCommand: node bin/behavior-diff-workbench.mjs
    envVars:
      - key: NODE_VERSION
        value: 22.18.0
      - key: HOST
        value: 0.0.0.0
      - key: WORKBENCH_AUTH_TOKEN
        generateValue: true
```

### Option B: Manual Web Service Setup on Render

If configuring the web service manually in the Render dashboard:

| Setting | Value | Description |
|---|---|---|
| **Runtime** | `Node` | Requires Node `>=22.0.0` (set `NODE_VERSION=22.18.0`) |
| **Build Command** | `npm ci --offline && npm run build` | Compiles distribution bundles and validates scripts |
| **Start Command** | `node bin/behavior-diff-workbench.mjs` | Starts workbench server with dynamic port and host detection |
| **Environment Variables** | `HOST=0.0.0.0`<br>`WORKBENCH_AUTH_TOKEN=<random-secret>` | `HOST=0.0.0.0` binds to all interfaces; `WORKBENCH_AUTH_TOKEN` secures execution APIs |

> *Note: Render dynamically assigns the `PORT` environment variable (e.g., `10000`). BehaviorDiff automatically reads `process.env.PORT` on startup.*

---

### Cloud Security & Access Protection Model

When deployed publicly on Render or any remote host, BehaviorDiff enforces strict access boundaries:

1. **Public Read-Only Exploration**:
   - The landing page (`/`), Evidence Lab GUI (`/lab`), static assets, and read-only scenario catalogs (`/api/scenarios`, `/api/runs`) are publicly accessible without authentication.
2. **Protected Mutating Execution APIs**:
   - All APIs that spawn child processes, allocate ports, or execute delta-debugging searches (`POST /api/runs` and `POST /api/runs/:runId/replay`) require a valid `WORKBENCH_AUTH_TOKEN`.
   - Unauthorized requests are rejected with `HTTP 401 Unauthorized` and `WWW-Authenticate: Bearer realm="BehaviorDiff Workbench"`.
   - Tokens are compared using timing-safe byte equality (`crypto.timingSafeEqual`) to prevent timing side-channel attacks.
3. **Public Host Failsafe**:
   - If the server binds to a public host (`0.0.0.0`) without a configured `WORKBENCH_AUTH_TOKEN`, all run, shrink, and replay triggers are automatically disabled with `HTTP 403 Forbidden` (`execution disabled: authentication token (WORKBENCH_AUTH_TOKEN) must be configured when binding to a non-loopback host`), preventing open compute abuse.
4. **Sandboxed Fixtures**:
   - The server only ever runs checked-in scenarios from `scenarios/` against fixed fixture binaries from `src/fixture-process.mjs`. It strictly rejects arbitrary URLs, external paths, or user-supplied executable binaries.
5. **Local Development Untouched**:
   - When running locally on loopback (`127.0.0.1` or `::1`) without `WORKBENCH_AUTH_TOKEN`, all APIs function without authentication, ensuring seamless local development with zero friction.

---

### Authenticating in the Evidence Lab

When accessing your Render deployment:

- **Via URL Query Parameter**: Open `https://<your-render-service>.onrender.com/lab?token=YOUR_WORKBENCH_AUTH_TOKEN`. The token is automatically saved into session storage for all subsequent run and replay requests.
- **Via In-App Prompt**: If you click **Run investigation** without a token, the Evidence Lab will prompt you to enter your token.
- **Via API / Curl**:
  ```bash
  # Trigger a run via Bearer header
  curl -X POST https://<your-render-service>.onrender.com/api/runs \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer YOUR_WORKBENCH_AUTH_TOKEN" \
    -d '{"scenario":"cart-noisy","mode":"shrink","maxAttempts":50}'

  # Or using the custom header
  curl -X POST https://<your-render-service>.onrender.com/api/runs \
    -H "Content-Type: application/json" \
    -H "x-workbench-token: YOUR_WORKBENCH_AUTH_TOKEN" \
    -d '{"scenario":"cart-total","mode":"run"}'
  ```

---

## Built with OmniRush

BehaviorDiff was architected, engineered, and hardened using **OmniRush**—the advanced autonomous software synthesis and agentic acceleration methodology.

Through OmniRush:
- **Rigorous Invariant Synthesis**: The core comparator and delta shrinker were specified with strict mathematical boundary contracts, preventing spurious minimality claims or infinite loops.
- **Defensive Failure-Path Hardening**: 82 comprehensive reliability test suites were automatically synthesized to stress-test transport timeouts, malformed JSON, prototype pollution vectors, and process lifecycle cleanup.
- **Architectural Cohesion**: Front-to-back integration spanning the low-level CLI engine, deterministic fixture processes, and high-fidelity 3D Evidence Lab was orchestrated in an integrated, verified workflow.

---

## License & Copyright

```
Copyright 2026 Aman Raj

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

Full license text is available in [LICENSE.md](LICENSE.md).

---

<p align="center">
  <b>BehaviorDiff</b> — <i>Find the difference. Prove the bug.</i><br>
  Developed by <a href="https://github.com/Aman-Raj-bat">Aman Raj</a>
</p>
