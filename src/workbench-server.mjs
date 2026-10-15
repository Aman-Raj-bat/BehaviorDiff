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

  return {};
}
