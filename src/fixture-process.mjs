import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestJson, HttpJsonError } from './http-json.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = Object.freeze({
  'old-cart': path.join(ROOT, 'fixtures', 'old-service.mjs'),
  'candidate-cart': path.join(ROOT, 'fixtures', 'candidate-service.mjs'),
  'candidate-fixed-cart': path.join(ROOT, 'fixtures', 'candidate-fixed-service.mjs'),
});

const ALLOWED_DELAY_STEPS = new Set(['health', 'create-cart', 'add-item', 'read-cart']);

export class FixtureStartError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FixtureStartError';
    this.code = code;
    Object.assign(this, details);
  }
}

function validateDelay(value, label) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new Error(`${label} must be an integer from 0 to 60000`);
  }
  return value;
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', resolve));
}

}
