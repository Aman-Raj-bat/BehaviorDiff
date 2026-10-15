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


  return {};
}
