import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runScenario } from '../src/run-scenario.mjs';
import { mismatchSignature } from '../src/shrink.mjs';

const NOISY = new URL('../scenarios/cart-noisy.json', import.meta.url);
const PASS = new URL('../scenarios/cart-total-pass.json', import.meta.url);
const REGRESSION = new URL('../scenarios/cart-total.json', import.meta.url);
const TARGET = { stepId: 'add-item', pointer: '/items/0/lineTotal', classification: 'BUSINESS_DIFFERENCE' };

async function temporary(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-shrink-reliability-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function json(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function assertCounts(reduction) {
  assert.equal(reduction.attemptsUsed, 1 + reduction.attempts.length);
  assert.equal(reduction.actualReplays, 1 + reduction.attempts.filter((attempt) => attempt.replayed).length);
  assert.equal(reduction.acceptedOperations, reduction.attempts.filter((attempt) => attempt.result === 'ACCEPTED').length);
  assert.ok(reduction.attemptsUsed <= reduction.maxAttempts);
  for (const [index, attempt] of reduction.attempts.entries()) {
    assert.equal(attempt.attempt, index + 2);
    assert.equal(attempt.candidateHash, createHash('sha256').update(JSON.stringify(attempt.candidateScenario)).digest('hex'));
    if (attempt.result !== 'ACCEPTED') continue;
    assert.equal(attempt.replayed, true);
    assert.equal(attempt.execution.outcome, 'REGRESSION');
    assert.ok(!attempt.execution.reason || attempt.execution.reason.code === 'CANDIDATE_UNEXPECTED_STATUS');
    assert.deepEqual(attempt.execution.signature, reduction.originalMismatchSignature);
    assert.deepEqual(mismatchSignature(attempt.execution.steps), reduction.originalMismatchSignature);
  }
}

test('a budget exhausted after progress counts real replays and invalid reductions separately', async (t) => {
  const directory = await temporary(t);
  const output = path.join(directory, 'run');
  const evidence = await runScenario(NOISY, output, { shrink: { maxAttempts: 4 } });
  const reduction = evidence.reduction;
  assert.equal(evidence.outcome, 'REGRESSION');
  assert.equal(reduction.status, 'LIMIT_REACHED');
  assert.equal(reduction.attemptsUsed, 4);
  assert.equal(reduction.actualReplays, 3);
  assert.equal(reduction.acceptedOperations, 2);
  assert.equal(reduction.finalStepCount, 4);
  assert.equal(reduction.minimalUnderOperations, false);
  assert.equal(reduction.attempts[2].reason, 'CONFIG_ERROR');
  assert.equal(reduction.attempts[2].replayed, false);
  assert.deepEqual(reduction.finalMismatchSignature, TARGET);
  assertCounts(reduction);
  assert.deepEqual(await json(path.join(output, 'scenario.original.json')), await json(NOISY));
  assert.deepEqual(await json(path.join(output, 'scenario.replay.json')), reduction.finalScenario);
  const replay = await runScenario(path.join(output, 'scenario.replay.json'), path.join(directory, 'replay'));
  assert.equal(replay.outcome, 'REGRESSION');
  assert.deepEqual(replay.summary.firstDifference, TARGET);
});

test('cancellation during reduction HTTP execution retains the verified best and truthful counts', async (t) => {
  const directory = await temporary(t);
  const output = path.join(directory, 'run');
  const controller = new AbortController();
  const realFetch = globalThis.fetch;
  let resets = 0;
  let cancelled = false;
  const intercepted = t.mock.method(globalThis, 'fetch', async (url, options) => {
    const response = await realFetch(url, options);
    const pathname = new URL(url).pathname;
    if (pathname === '/reset') resets += 1;
    // Baseline and the first accepted reduction have both completed. Do not fake responses.
    if (!cancelled && resets >= 6 && pathname === '/carts') {
      cancelled = true;
      controller.abort();
    }
    return response;
  });
  const evidence = await runScenario(NOISY, output, {
    signal: controller.signal, shrink: { maxAttempts: 100 },
  });
  intercepted.mock.restore();
  assert.equal(cancelled, true);
  assert.equal(evidence.outcome, 'INCONCLUSIVE');
  assert.equal(evidence.exitCode, 2);
  assert.equal(evidence.reason.code, 'RUN_CANCELLED');
  const reduction = evidence.reduction;
  assert.equal(reduction.status, 'ABORTED');
  assert.equal(reduction.reason.code, 'RUN_CANCELLED');
  assert.equal(reduction.minimalUnderOperations, false);
  assert.equal(reduction.attemptLimitReached, false);
  assert.equal(reduction.attemptsUsed, 3);
  assert.equal(reduction.actualReplays, 3);
  assert.equal(reduction.acceptedOperations, 1);
  assert.equal(reduction.finalStepCount, 5);
  assert.equal(reduction.attempts[1].result, 'REJECTED');
  assert.equal(reduction.attempts[1].reason, 'RUN_CANCELLED');
  assert.equal(reduction.attempts[1].replayed, true);
  assert.deepEqual(reduction.finalMismatchSignature, TARGET);
  assert.deepEqual(mismatchSignature(evidence.steps), TARGET);
  assertCounts(reduction);
  assert.deepEqual(await json(path.join(output, 'evidence.json')), evidence);
  assert.deepEqual(await json(path.join(output, 'scenario.replay.json')), reduction.finalScenario);
  for (const service of Object.values(evidence.services)) {
    assert.throws(() => process.kill(service.pid, 0), { code: 'ESRCH' });
  }
  const replay = await runScenario(path.join(output, 'scenario.replay.json'), path.join(directory, 'independent-replay'));
  assert.equal(replay.outcome, 'REGRESSION');
  assert.deepEqual(replay.summary.firstDifference, TARGET);
});

test('late reference failure is not a trusted shrink baseline despite earlier business differences', async (t) => {
  const directory = await temporary(t);
  const input = await json(REGRESSION);
  input.steps[2].expect.status = 201;
  const scenarioPath = path.join(directory, 'late-reference.json');
  await writeFile(scenarioPath, JSON.stringify(input));
  const evidence = await runScenario(scenarioPath, path.join(directory, 'run'), { shrink: true });
  assert.equal(evidence.outcome, 'INCONCLUSIVE');
  assert.equal(evidence.reason.code, 'REFERENCE_UNEXPECTED_STATUS');
  assert.equal(evidence.steps[1].comparison.differences[0].pointer, TARGET.pointer);
  assert.equal(evidence.reduction.status, 'BASELINE_NOT_REPRODUCING');
  assert.equal(evidence.reduction.actualReplays, 1);
  assert.equal(evidence.reduction.acceptedOperations, 0);
  assert.equal(evidence.reduction.minimalUnderOperations, false);
  assert.deepEqual(evidence.reduction.attempts, []);
});

test('inline body reductions reject broken setup and retain only executed target-preserving changes', async (t) => {
  const directory = await temporary(t);
  const input = await json(REGRESSION);
  input.variables = {};
  input.steps[1].request.body = { sku: 'coffee', quantity: 2, unitPrice: 10 };
  const scenarioPath = path.join(directory, 'inline.json');
  await writeFile(scenarioPath, JSON.stringify(input));
  const evidence = await runScenario(scenarioPath, path.join(directory, 'run'), { shrink: true });
  const reduction = evidence.reduction;
  assert.equal(reduction.status, 'COMPLETED');
  assert.deepEqual(reduction.finalMismatchSignature, TARGET);
  assertCounts(reduction);
  const brokenBody = reduction.attempts.filter((attempt) => attempt.operation === 'SIMPLIFY_OBJECT');
  assert.ok(brokenBody.length > 0);
  for (const attempt of brokenBody) {
    assert.equal(attempt.result, 'REJECTED');
    assert.equal(attempt.replayed, true);
    assert.equal(attempt.execution.outcome, 'INCONCLUSIVE');
    assert.equal(attempt.execution.reason.code, 'REFERENCE_UNEXPECTED_STATUS');
  }
  for (const step of reduction.finalScenario.steps) {
    const original = input.steps.find((item) => item.id === step.id);
    assert.equal(step.request.method, original.request.method);
    assert.equal(step.request.path, original.request.path);
    assert.deepEqual(step.expect, original.expect);
    assert.deepEqual(step.capture, original.capture);
    assert.deepEqual(step.ignorePaths, original.ignorePaths);
  }
});

test('a PASS run replaces shrink evidence without stale mismatch, original scenario, or replay hashes', async (t) => {
  const directory = await temporary(t);
  const output = path.join(directory, 'reused');
  const regression = await runScenario(NOISY, output, { shrink: { maxAttempts: 4 } });
  const pass = await runScenario(PASS, output);
  const saved = await json(path.join(output, 'evidence.json'));
  const replayBytes = await readFile(path.join(output, 'scenario.replay.json'));
  assert.equal(saved.outcome, 'PASS');
  assert.equal(saved.exitCode, 0);
  assert.equal(saved.reason, undefined);
  assert.equal(saved.summary.firstDifference, undefined);
  assert.equal(saved.reduction, undefined);
  assert.notEqual(saved.run.runId, regression.run.runId);
  assert.notEqual(saved.scenario.sha256, regression.scenario.sha256);
  assert.notEqual(saved.replay.sha256, regression.replay.sha256);
  assert.equal(saved.replay.sha256, createHash('sha256').update(replayBytes).digest('hex'));
  assert.deepEqual(saved, pass);
  assert.deepEqual(JSON.parse(replayBytes), await json(PASS));
  assert.equal(saved.steps.every((step) => step.comparison.equal), true);
  await assert.rejects(readFile(path.join(output, 'scenario.original.json')), { code: 'ENOENT' });
});
