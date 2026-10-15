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


  return {};
}
