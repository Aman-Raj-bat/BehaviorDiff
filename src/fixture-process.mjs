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

export function spawnFixture(fixture, {
  startupDelayMs,
  responseDelayMs,
  responseDelayStep,
  startupFailure,
  crashOnQuantity,
  timeoutOnQuantity,
  alternateMismatchSku,
} = {}) {
  const script = SCRIPTS[fixture];
  if (!script) throw new Error(`Unknown fixture ${fixture}`);
  const startupDelay = validateDelay(startupDelayMs, 'startupDelayMs');
  const responseDelay = validateDelay(responseDelayMs, 'responseDelayMs');
  const crashQuantity = crashOnQuantity === undefined ? undefined : validateDelay(crashOnQuantity, 'crashOnQuantity');
  const timeoutQuantity = timeoutOnQuantity === undefined ? undefined : validateDelay(timeoutOnQuantity, 'timeoutOnQuantity');
  if (responseDelayStep !== undefined && !ALLOWED_DELAY_STEPS.has(responseDelayStep)) {
    throw new Error(`responseDelayStep is not allowed: ${responseDelayStep}`);
  }

  const environment = { ...process.env };
  if (startupDelay) environment.BEHAVIOR_DIFF_STARTUP_DELAY_MS = String(startupDelay);
  if (responseDelay) environment.BEHAVIOR_DIFF_RESPONSE_DELAY_MS = String(responseDelay);
  if (responseDelayStep) environment.BEHAVIOR_DIFF_RESPONSE_DELAY_STEP = responseDelayStep;
  if (startupFailure) environment.BEHAVIOR_DIFF_FAIL_STARTUP = '1';
  if (crashQuantity !== undefined) environment.BEHAVIOR_DIFF_CRASH_ON_QUANTITY = String(crashQuantity);
  if (timeoutQuantity !== undefined) environment.BEHAVIOR_DIFF_TIMEOUT_ON_QUANTITY = String(timeoutQuantity);
  if (alternateMismatchSku !== undefined) environment.BEHAVIOR_DIFF_ALTERNATE_MISMATCH_SKU = alternateMismatchSku;

  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  return {};
}
