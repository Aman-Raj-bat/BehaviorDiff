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
      error.reset = resetResult.reset;
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
  let replay;
  try {
    replay = await replayPair({ scenario, services: handles, requestTimeoutMs, signal });
  } catch (error) {
    // A cancelled, started replay still counts as execution, unlike a failed reset.
    if (error?.code === 'RUN_CANCELLED') {
      error.replayed = true;
      error.reset = resetResult.reset;
    }
    throw error;
  }
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
  await mkdir(outputDirectory, { recursive: true });
  const scenarioHash = createHash('sha256').update(rawScenario).digest('hex');

  const evidence = {
    schemaVersion: shrinkEnabled ? 2 : 1,
    outcome: 'INCONCLUSIVE',
    exitCode: 2,
    run: { runId: nowRunId(), startedAt: startedAt.toISOString() },
    scenario: { name: scenario.name, version: scenario.version, sha256: scenarioHash },
    services: {},
    steps: [],
    summary: {},
    replay: {
      scenarioFile: 'scenario.replay.json',
      command: `node bin/behavior-diff.mjs run ${shellQuote(path.relative(process.cwd(), path.join(outputDirectory, 'scenario.replay.json')) || 'scenario.replay.json')} --out ${shellQuote(path.relative(process.cwd(), path.join(outputDirectory, 'replay')) || 'replay')}`,
    },
  };

  const handles = {};
  let runtimeReason;
  try {
    for (const side of ['reference', 'candidate']) {
      const fixtureOptions = options.fixtureOptions?.[side] ?? {};
      handles[side] = spawnFixture(scenario.services[side], fixtureOptions);
    }

    const starts = await Promise.allSettled([
      handles.reference.start(startupTimeoutMs, signal),
      handles.candidate.start(startupTimeoutMs, signal),
    ]);
    const sides = ['reference', 'candidate'];
    for (const [index, result] of starts.entries()) {
      const side = sides[index];
      if (result.status === 'fulfilled') {
        evidence.services[side] = serviceEvidence(scenario.services[side], handles[side], true);
      } else {
        const error = result.reason instanceof FixtureStartError
          ? result.reason
          : new FixtureStartError('STARTUP_FAILURE', result.reason.message);
        evidence.services[side] = serviceEvidence(scenario.services[side], handles[side], false);
        if (!runtimeReason) runtimeReason = startupReason(side, error);
      }
    }

    if (runtimeReason) {
      evidence.reason = runtimeReason;
      return finalize(evidence, scenario, outputDirectory, startedAt);
    }

    const initial = await executeReplay(scenario, handles, requestTimeoutMs, signal);
    for (const side of ['reference', 'candidate']) evidence.services[side].reset = initial.reset[side];
    if (initial.reason) {
      runtimeReason = initial.reason;
      evidence.reason = runtimeReason;
      return finalize(evidence, scenario, outputDirectory, startedAt);
    }

    let finalScenario = scenario;
    let finalExecution = initial.execution;
    if (shrinkEnabled) {
      const baselineCanShrink = initial.execution.outcome === 'REGRESSION'
        && initial.execution.signature
        && (!initial.execution.reason || initial.execution.reason.code === 'CANDIDATE_UNEXPECTED_STATUS');
      const reduction = baselineCanShrink
        ? await shrinkScenario({
          scenario,
          baseline: initial.execution,
          maxAttempts,
          evaluate: (candidate) => executeReplay(candidate, handles, requestTimeoutMs, signal),
        })
        : {
          status: 'BASELINE_NOT_REPRODUCING',
          maxAttempts,
          attemptsUsed: 1,
          actualReplays: 1,
          attemptLimitReached: false,
          minimalUnderOperations: false,
          acceptedOperations: 0,
          originalScenario: scenario,
          originalMismatchSignature: initial.execution.signature,
          scenario,
          execution: initial.execution,
          finalMismatchSignature: initial.execution.signature,
          attempts: [],
        };
      evidence.reduction = {
        algorithm: 'greedy-step-delete+scalar-v1',
        status: reduction.status,
        ...(reduction.reason ? { reason: reduction.reason } : {}),
        originalScenarioFile: 'scenario.original.json',
        finalScenarioFile: 'scenario.replay.json',
        maxAttempts,
        attemptsUsed: reduction.attemptsUsed,
        actualReplays: reduction.actualReplays,
        attemptLimitReached: reduction.attemptLimitReached,
        minimalUnderOperations: reduction.minimalUnderOperations,
        acceptedOperations: reduction.acceptedOperations,
        originalStepCount: scenario.steps.length,
        finalStepCount: reduction.scenario.steps.length,
        originalScenario: scenario,
        originalMismatchSignature: initial.execution.signature,
        finalScenario: reduction.scenario,
        finalMismatchSignature: reduction.finalMismatchSignature,
        attempts: reduction.attempts,
      };
      finalScenario = reduction.scenario;
      finalExecution = reduction.execution;
      if (reduction.reason?.code === 'RUN_CANCELLED') {
        // Keep the last verified best scenario/trace, but never label cancellation as completion.
        evidence.reason = reduction.reason;
        evidence.steps = finalExecution.steps;
        return finalize(evidence, finalScenario, outputDirectory, startedAt, scenario);
      }
    }

    evidence.steps = finalExecution.steps;
    if (finalExecution.reason) evidence.reason = finalExecution.reason;
    if (finalExecution.reason && !finalExecution.regression) {
      evidence.outcome = 'INCONCLUSIVE';
      evidence.exitCode = 2;
    } else if (finalExecution.regression) {
      evidence.outcome = 'REGRESSION';
      evidence.exitCode = 1;
    } else {
      evidence.outcome = 'PASS';
      evidence.exitCode = 0;
    }

    const differingStep = evidence.steps.find((step) => step.comparison?.differences?.length);
    evidence.summary = {
      comparedSteps: evidence.steps.filter((step) => step.comparison).length,
      ...(differingStep ? {
        firstDifference: {
          stepId: differingStep.id,
          pointer: differingStep.comparison.differences[0].pointer,
          classification: finalExecution.signature?.classification,
        },
      } : {}),
    };
    return finalize(evidence, finalScenario, outputDirectory, startedAt, shrinkEnabled ? scenario : undefined);
  } catch (error) {
    if (error?.code !== 'RUN_CANCELLED') throw error;
    evidence.outcome = 'INCONCLUSIVE';
    evidence.exitCode = 2;
    evidence.reason = { code: 'RUN_CANCELLED', message: 'Run was cancelled' };
    return finalize(evidence, scenario, outputDirectory, startedAt);
  } finally {
    await Promise.all(Object.values(handles).map((handle) => handle.stop()));
  }
}

async function finalize(evidence, scenario, outputDirectory, startedAt, originalScenario) {
  const finishedAt = new Date();
  evidence.run.finishedAt = finishedAt.toISOString();
  evidence.run.durationMs = finishedAt.getTime() - startedAt.getTime();
  await writeReplayArtifacts(outputDirectory, scenario, evidence, { originalScenario });
  return evidence;
}
