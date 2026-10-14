import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { writeReplayArtifacts } from './evidence.mjs';
import { FixtureStartError, spawnFixture } from './fixture-process.mjs';
import { replayPair } from './replay.mjs';
import { validateScenario } from './scenario.mjs';
import { shrinkScenario, summarizeReplay } from './shrink.mjs';

function boundedTimeout(value, label, fallback) {
  const chosen = value ?? fallback;
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 60_000) throw new Error(`${label} must be an integer from 1 to 60000`);
  return chosen;
}

function boundedAttempts(value, fallback = 100) {
  const chosen = value ?? fallback;
  if (!Number.isInteger(chosen) || chosen < 1 || chosen > 10_000) throw new Error('maxAttempts must be an integer from 1 to 10000');
  return chosen;
}

function nowRunId() {
  const timestamp = new Date().toISOString().replaceAll(/[-:.TZ]/g, '').slice(0, 14);
  return `${timestamp}-${randomBytes(4).toString('hex')}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function serviceEvidence(fixture, handle, ready) {
  return {
    fixture,
    ...(handle.baseUrl ? { baseUrl: handle.baseUrl } : {}),
    pid: handle.pid,
    ready,
  };
}

function startupReason(side, error) {

  return {};
}
