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
  const stderr = typeof error.stderr === 'string' ? error.stderr : '';
  return {
    code: error.code ?? 'STARTUP_FAILURE',
    side,
    message: error.message,
    ...(error.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
    ...(error.exitCode === null || error.exitCode === undefined ? {} : { exitCode: error.exitCode }),
    ...(error.signal ? { signal: error.signal } : {}),
    ...(stderr ? { stderr: stderr.slice(0, 4_096), stderrTruncated: stderr.length > 4_096 } : {}),
  };
}

async function resetServices(handles, timeoutMs, signal) {
  const results = await Promise.allSettled([
    handles.reference.reset(timeoutMs, signal),
    handles.candidate.reset(timeoutMs, signal),
  ]);
  const reset = {};
  let failure;
  for (const [index, result] of results.entries()) {
    const side = ['reference', 'candidate'][index];
    reset[side] = result.status === 'fulfilled';
    if (result.status === 'rejected' && !failure) {
      failure = {
        code: result.reason?.code === 'RUN_CANCELLED'
          ? 'RUN_CANCELLED'
          : result.reason?.code === 'REQUEST_TIMEOUT' ? 'REQUEST_TIMEOUT' : 'RESET_FAILURE',
        side,
        message: result.reason?.message ?? 'Fixture reset failed',
      };
    }
  }
  return { reset, failure };
}

async function executeReplay(scenario, handles, requestTimeoutMs, signal) {
  if (signal?.aborted) {
    const error = new Error('Run was cancelled');
    error.code = 'RUN_CANCELLED';
    throw error;
  }
  const resetResult = await resetServices(handles, requestTimeoutMs, signal);
  if (resetResult.failure) {
    if (resetResult.failure.code === 'RUN_CANCELLED') {
      const error = new Error('Run was cancelled');
      error.code = 'RUN_CANCELLED';
      throw error;
    }
    return {
      replayed: false,
      reset: resetResult.reset,
      reason: resetResult.failure,
      fatal: true,
      execution: {
        outcome: 'INCONCLUSIVE',
        steps: [],
        reason: resetResult.failure,
        regression: false,
        signature: null,
      },
    };
  }
  const replay = await replayPair({ scenario, services: handles, requestTimeoutMs, signal });
  return {
    replayed: true,
    reset: resetResult.reset,
    execution: summarizeReplay(replay),
  };
}

export async function runScenario(scenarioPath, outputDirectory, options = {}) {
  const startedAt = new Date();
  const startupTimeoutMs = boundedTimeout(options.startupTimeoutMs, 'startupTimeoutMs', 2_000);
  const requestTimeoutMs = boundedTimeout(options.requestTimeoutMs, 'requestTimeoutMs', 1_000);
  const shrinkEnabled = options.shrink === true || (options.shrink !== undefined && options.shrink !== false);
  const shrinkOptions = typeof options.shrink === 'object' ? options.shrink : {};
  const maxAttempts = shrinkEnabled ? boundedAttempts(shrinkOptions.maxAttempts ?? options.maxAttempts) : undefined;
  const signal = options.signal;
  const rawScenario = await readFile(scenarioPath, 'utf8');
  const scenario = validateScenario(JSON.parse(rawScenario));

  return {};
}
