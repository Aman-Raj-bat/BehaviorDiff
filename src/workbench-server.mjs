import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from './run-scenario.mjs';
import { ScenarioConfigError, validateScenario } from './scenario.mjs';
import {
  WorkbenchEvidenceError,
  buildWorkbenchModel,
  parseEvidence,
} from './workbench-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCENARIOS = Object.freeze({
  'cart-total': 'cart-total.json',
  'cart-total-pass': 'cart-total-pass.json',
  'cart-noisy': 'cart-noisy.json',
});
const RUN_ID = /^[a-z0-9][a-z0-9-]{7,79}$/;
const MAX_BODY_BYTES = 32 * 1024;

export class WorkbenchRequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'WorkbenchRequestError';
    this.status = status;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function jsonResponse(response, status, body) {
  if (response.destroyed) return;
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function textResponse(response, status, body, contentType = 'text/plain; charset=utf-8') {
  if (response.destroyed) return;
  response.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonFile(filePath, label) {
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new WorkbenchRequestError(`${label} was not found`, 404);
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new WorkbenchRequestError(`${label} is not valid JSON: ${error.message}`, 422);
  }
}

function boundedInteger(value, label, minimum, maximum) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new WorkbenchRequestError(`${label} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

export function scenarioPathFor(scenarioId, root = ROOT) {
  if (typeof scenarioId !== 'string' || !Object.hasOwn(SCENARIOS, scenarioId)) {
    throw new WorkbenchRequestError('scenario must be one of the checked-in scenarios');
  }
  const scenariosDirectory = path.resolve(root, 'scenarios');
  const scenarioPath = path.resolve(scenariosDirectory, SCENARIOS[scenarioId]);
  if (!scenarioPath.startsWith(`${scenariosDirectory}${path.sep}`)) {
    throw new WorkbenchRequestError('scenario path is outside the trusted scenario directory', 400);
  }
  return scenarioPath;
}

export function validateRunRequest(body) {
  if (!isRecord(body)) throw new WorkbenchRequestError('request body must be a JSON object');
  const scenario = body.scenario;
  const mode = body.mode ?? 'run';
  if (typeof scenario !== 'string' || !Object.hasOwn(SCENARIOS, scenario)) {
    throw new WorkbenchRequestError('scenario must be one of the checked-in scenarios');
  }
  if (mode !== 'run' && mode !== 'shrink') {
    throw new WorkbenchRequestError('mode must be run or shrink');
  }
  const startupTimeoutMs = boundedInteger(body.startupTimeoutMs, 'startupTimeoutMs', 1, 60_000);
  const requestTimeoutMs = boundedInteger(body.requestTimeoutMs, 'requestTimeoutMs', 1, 60_000);
  const maxAttempts = boundedInteger(body.maxAttempts, 'maxAttempts', 1, 10_000);
  if (mode === 'run' && maxAttempts !== undefined) {
    throw new WorkbenchRequestError('maxAttempts is only valid in shrink mode');
  }
  return {
    scenario,
    mode,
    ...(startupTimeoutMs === undefined ? {} : { startupTimeoutMs }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
  };
}

function newRunId(prefix = 'run') {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(5).toString('hex')}`;
}

function artifactDirectory(outputRoot, runId) {
  if (!RUN_ID.test(runId)) throw new WorkbenchRequestError('invalid run identifier');
  const root = path.resolve(outputRoot);
  const directory = path.resolve(root, runId);
  if (!directory.startsWith(`${root}${path.sep}`)) throw new WorkbenchRequestError('invalid artifact path');
  return directory;
}

async function modelFromDirectory(directory, runId, artifactBase) {
  const evidence = parseEvidence(await readJsonFile(path.join(directory, 'evidence.json'), 'evidence'));
  const minimized = await readJsonFile(path.join(directory, 'scenario.replay.json'), 'minimized scenario');
  let original = null;
  if (evidence.reduction) {
    try {
      original = await readJsonFile(path.join(directory, 'scenario.original.json'), 'original scenario');
    } catch (error) {
      if (!(error instanceof WorkbenchRequestError) || error.status !== 404) throw error;
    }
  }
  return buildWorkbenchModel(evidence, {
    scenario: minimized,
    originalScenario: original,
    runId,
    artifactBase,
  });
}

async function requestBody(request) {
  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    request.resume();
    throw new WorkbenchRequestError('request body is too large', 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new WorkbenchRequestError('request body is too large', 413);
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new WorkbenchRequestError(`request body is not valid JSON: ${error.message}`);
  }
}

async function scenarioCatalog(root) {
  return Promise.all(Object.entries(SCENARIOS).map(async ([id, filename]) => {
    const scenario = validateScenario(await readJsonFile(path.join(root, 'scenarios', filename), filename));
    return {
      id,
      filename,
      name: scenario.name,
      reference: scenario.services.reference,
      candidate: scenario.services.candidate,
      stepCount: scenario.steps.length,
    };
  }));
}

async function listRuns(outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !RUN_ID.test(entry.name)) continue;
    try {
      const model = await modelFromDirectory(
        artifactDirectory(outputRoot, entry.name),
        entry.name,
        `/api/runs/${entry.name}`,
      );
      runs.push({
        runId: model.runId,
        outcome: model.outcome,
        scenarioName: model.scenario.name,
        minimizedStepCount: model.counts.minimizedStepCount,
        mismatch: model.mismatch,
        startedAt: model.run.startedAt ?? null,
      });
    } catch {
      // An incomplete artifact directory is not exposed as a run.
    }
  }
  return runs.sort((left, right) => String(right.startedAt).localeCompare(String(left.startedAt)));
}

async function runTrustedScenario({ root, outputRoot, request, signal }) {
  const scenarioPath = scenarioPathFor(request.scenario, root);
  const runId = newRunId(request.mode);
  const directory = artifactDirectory(outputRoot, runId);
  await mkdir(outputRoot, { recursive: true });
  await runScenario(scenarioPath, directory, {
    ...(request.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: request.startupTimeoutMs }),
    ...(request.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: request.requestTimeoutMs }),
    ...(signal ? { signal } : {}),
    shrink: request.mode === 'shrink' ? { maxAttempts: request.maxAttempts ?? 100 } : false,
  });
  return modelFromDirectory(directory, runId, `/api/runs/${runId}`);
}

async function replayTrustedScenario({ outputRoot, runId, signal }) {
  const sourceDirectory = artifactDirectory(outputRoot, runId);
  const sourceScenario = await readJsonFile(path.join(sourceDirectory, 'scenario.replay.json'), 'minimized scenario');
  try {
    validateScenario(sourceScenario);
  } catch (error) {
    throw new WorkbenchRequestError(`stored minimized scenario is invalid: ${error.message}`, 422);
  }
  const replayId = newRunId('replay');
  const replayDirectory = artifactDirectory(path.join(sourceDirectory, 'replays'), replayId);
  await runScenario(
    path.join(sourceDirectory, 'scenario.replay.json'),
    replayDirectory,
    { shrink: false, ...(signal ? { signal } : {}) },
  );
  return modelFromDirectory(
    replayDirectory,
    `${runId}/${replayId}`,
    `/api/runs/${runId}/replays/${replayId}`,
  );
}

async function serveArtifact(response, filePath, label) {
  const raw = await readFile(filePath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') throw new WorkbenchRequestError(`${label} was not found`, 404);
    throw error;
  });
  parseEvidence(raw, label);
  textResponse(response, 200, raw, 'application/json; charset=utf-8');
}

const STATIC_FILES = Object.freeze({
  '/': ['public/index.html', 'text/html; charset=utf-8'],
  '/lab': ['public/lab.html', 'text/html; charset=utf-8'],
  '/lab/': ['public/lab.html', 'text/html; charset=utf-8'],
  '/app.js': ['public/app.js', 'text/javascript; charset=utf-8'],
  '/landing.js': ['public/landing.js', 'text/javascript; charset=utf-8'],
  '/interaction-effects.js': ['public/interaction-effects.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['public/styles.css', 'text/css; charset=utf-8'],
  '/logo.svg': ['public/logo.svg', 'image/svg+xml; charset=utf-8'],
  '/favicon.svg': ['public/favicon.svg', 'image/svg+xml; charset=utf-8'],
  '/favicon.png': ['public/favicon.png', 'image/png'],
  '/hand_cursor.png': ['public/hand_cursor.png', 'image/png'],
});

function parseRunPath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'api' || parts[1] !== 'runs') return null;
  if (!RUN_ID.test(parts[2])) throw new WorkbenchRequestError('invalid run identifier');
  return parts.slice(2);
}

async function runRequestJob(request, response, runJob, task, activeControllers) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  request.once('aborted', abort);
  response.once('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  activeControllers.add(controller);
  try {
    return await runJob(() => task(controller.signal));
  } finally {
    activeControllers.delete(controller);
    request.removeListener('aborted', abort);
  }
}

export function createWorkbenchServer({
  root = ROOT,
  outputRoot = path.join(root, 'artifacts', 'workbench'),
  maxConcurrentJobs = 1,
} = {}) {
  if (!Number.isInteger(maxConcurrentJobs) || maxConcurrentJobs < 1) {
    throw new WorkbenchRequestError('maxConcurrentJobs must be a positive integer');
  }
  let activeJobs = 0;
  let closing = false;
  const activeControllers = new Set();
  const activeTasks = new Set();
  function assertAcceptingJobs() {
    if (closing) throw new WorkbenchRequestError('workbench is closing', 503);
  }
  async function runJob(task) {
    // Body reads may have started before close() cancelled the active jobs.
    assertAcceptingJobs();
    if (activeJobs >= maxConcurrentJobs) {
      throw new WorkbenchRequestError('another workbench run is already in progress', 429);
    }
    activeJobs += 1;
    let taskPromise;
    try {
      taskPromise = task();
      activeTasks.add(taskPromise);
      return await taskPromise;
    } finally {
      if (taskPromise) activeTasks.delete(taskPromise);
      activeJobs -= 1;
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && STATIC_FILES[url.pathname]) {
        const [relativePath, contentType] = STATIC_FILES[url.pathname];
        const encoding = contentType.startsWith('text/') || contentType.includes('svg') ? 'utf8' : undefined;
        const raw = await readFile(path.join(root, relativePath), encoding).catch((error) => {
          if (error.code === 'ENOENT') throw new WorkbenchRequestError('static asset not found', 404);
          throw error;
        });
        textResponse(response, 200, raw, contentType);
        return;
      }

      if (url.pathname === '/api/scenarios' && request.method === 'GET') {
        jsonResponse(response, 200, { scenarios: await scenarioCatalog(root) });
        return;
      }

      if (url.pathname === '/api/runs' && request.method === 'GET') {
        jsonResponse(response, 200, { runs: await listRuns(outputRoot) });
        return;
      }

      if (url.pathname === '/api/runs' && request.method === 'POST') {
        assertAcceptingJobs();
        const runRequest = validateRunRequest(await requestBody(request));
        jsonResponse(response, 201, await runRequestJob(
          request,
          response,
          runJob,
          (signal) => runTrustedScenario({ root, outputRoot, request: runRequest, signal }),
          activeControllers,
        ));
        return;
      }

      const runPath = parseRunPath(url.pathname);
      if (runPath) {
        if (runPath.length >= 3 && runPath[1] === 'replays') {
          const [parentRunId, , replayId, action] = runPath;
          if (!RUN_ID.test(replayId)) throw new WorkbenchRequestError('invalid replay identifier');
          const replayRoot = path.join(artifactDirectory(outputRoot, parentRunId), 'replays');
          const replayDirectory = artifactDirectory(replayRoot, replayId);
          const replayModelId = `${parentRunId}/${replayId}`;
          if (runPath.length === 3 && request.method === 'GET') {
            jsonResponse(response, 200, await modelFromDirectory(
              replayDirectory,
              replayModelId,
              `/api/runs/${parentRunId}/replays/${replayId}`,
            ));
            return;
          }
          if (runPath.length === 4 && request.method === 'GET') {
            if (action === 'evidence') {
              await serveArtifact(response, path.join(replayDirectory, 'evidence.json'), 'replay evidence');
              return;
            }
            if (action === 'scenario') {
              jsonResponse(response, 200, await readJsonFile(path.join(replayDirectory, 'scenario.replay.json'), 'replay scenario'));
              return;
            }
          }
        }
        const [runId, action] = runPath;
        const directory = artifactDirectory(outputRoot, runId);
        if (runPath.length === 1 && request.method === 'GET') {
          jsonResponse(response, 200, await modelFromDirectory(directory, runId, `/api/runs/${runId}`));
          return;
        }
        if (runPath.length === 2 && request.method === 'GET') {
          if (action === 'evidence') {
            await serveArtifact(response, path.join(directory, 'evidence.json'), 'evidence');
            return;
          }
          if (action === 'scenario') {
            const scenario = await readJsonFile(path.join(directory, 'scenario.replay.json'), 'minimized scenario');
            jsonResponse(response, 200, scenario);
            return;
          }
          if (action === 'original-scenario') {
            const evidence = parseEvidence(await readJsonFile(path.join(directory, 'evidence.json'), 'evidence'));
            if (!evidence.reduction) throw new WorkbenchRequestError('original scenario is unavailable without a recorded reduction', 404);
            const scenario = await readJsonFile(path.join(directory, 'scenario.original.json'), 'original scenario');
            jsonResponse(response, 200, scenario);
            return;
          }
        }
        if (runPath.length === 2 && action === 'replay' && request.method === 'POST') {
          assertAcceptingJobs();
          await requestBody(request);
          jsonResponse(response, 201, await runRequestJob(
            request,
            response,
            runJob,
            (signal) => replayTrustedScenario({ outputRoot, runId, signal }),
            activeControllers,
          ));
          return;
        }
      }

      throw new WorkbenchRequestError('not found', 404);
    } catch (error) {
      const status = error instanceof WorkbenchRequestError || error instanceof WorkbenchEvidenceError
        ? error.status ?? 422
        : error instanceof ScenarioConfigError ? 422 : 500;
      if (status === 500) console.error(error);
      jsonResponse(response, status, {
        error: status === 500 ? 'workbench request failed' : error instanceof Error ? error.message : 'workbench request failed',
      });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;

  return {
    server,
    async listen({ port = 4173, host = '127.0.0.1' } = {}) {
      if (host !== '127.0.0.1' && host !== '::1') throw new WorkbenchRequestError('workbench must bind to loopback');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, resolve);
      });
      const address = server.address();
      const displayHost = host.includes(':') ? `[${host}]` : host;
      return {
        host,
        port: typeof address === 'object' && address ? address.port : port,
        url: `http://${displayHost}:${typeof address === 'object' && address ? address.port : port}/`,
      };
    },
    async close() {
      closing = true;
      for (const controller of activeControllers) controller.abort();
      await Promise.allSettled([...activeTasks]);
      if (!server.listening) return;
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

export { ROOT, SCENARIOS };
