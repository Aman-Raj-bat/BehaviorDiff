import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareJson } from '../src/compare-json.mjs';
import { requestJson } from '../src/http-json.mjs';
import { runScenario } from '../src/run-scenario.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const BIN = path.join(ROOT, 'bin', 'behavior-diff.mjs');
const REGRESSION_SCENARIO = path.join(ROOT, 'scenarios', 'cart-total.json');
const PASS_SCENARIO = path.join(ROOT, 'scenarios', 'cart-total-pass.json');
const NOISY_SCENARIO = path.join(ROOT, 'scenarios', 'cart-noisy.json');

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function readEvidence(outputDirectory) {
  return JSON.parse(await readFile(path.join(outputDirectory, 'evidence.json'), 'utf8'));
}

function assertProcessStopped(pid) {
  assert.equal(typeof pid, 'number');
  assert.throws(() => process.kill(pid, 0), (error) => error.code === 'ESRCH');
}

function reductionShape(evidence) {
  return {
    status: evidence.reduction.status,
    originalSteps: evidence.reduction.originalScenario.steps.map((step) => step.id),
    finalSteps: evidence.reduction.finalScenario.steps.map((step) => step.id),
    originalMismatchSignature: evidence.reduction.originalMismatchSignature,
    finalMismatchSignature: evidence.reduction.finalMismatchSignature,
    attemptLimitReached: evidence.reduction.attemptLimitReached,
    minimalUnderOperations: evidence.reduction.minimalUnderOperations,
    attempts: evidence.reduction.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      operation: attempt.operation,
      location: attempt.location,
      result: attempt.result,
      reason: attempt.reason,
      replayed: attempt.replayed,
      candidateStepCount: attempt.candidateStepCount,
    })),
  };
}

test('real paired replay detects the candidate business regression and exports evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-regression-'));
  const output = path.join(directory, 'run');
  try {
    const result = await runCli(['run', REGRESSION_SCENARIO, '--out', output]);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stdout, /REGRESSION/);
    assert.match(result.stdout, /pointer=\/items\/0\/lineTotal/);

    const evidence = await readEvidence(output);
    assert.equal(evidence.outcome, 'REGRESSION');
    assert.equal(evidence.services.reference.ready, true);
    assert.equal(evidence.services.candidate.ready, true);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);

    const create = evidence.steps[0];
    assert.notEqual(create.reference.captures.cartId, create.candidate.captures.cartId);
    assert.equal(create.reference.request.method, create.candidate.request.method);
    assert.deepEqual(create.reference.request.body, create.candidate.request.body);
    assert.deepEqual(create.comparison.differences, []);
    assert.deepEqual(create.comparison.ignoredDifferences.map((item) => item.pointer), [
      '/cartId',
      '/meta/requestId',
    ]);

    const addItem = evidence.steps.find((step) => step.id === 'add-item');
    assert.equal(addItem.reference.request.path, `/carts/${create.reference.captures.cartId}/items`);
    assert.equal(addItem.candidate.request.path, `/carts/${create.candidate.captures.cartId}/items`);
    assert.deepEqual(addItem.reference.request.body, addItem.candidate.request.body);
    assert.deepEqual(addItem.comparison.differences[0], {
      pointer: '/items/0/lineTotal',
      reference: 20,
      candidate: 10,
    });
    assert.equal(addItem.comparison.differences.some((item) => item.pointer === '/cartId'), false);
    assert.equal(addItem.reference.response.body.total, 20);
    assert.equal(addItem.candidate.response.body.total, 10);
    assert.equal(addItem.reference.response.headers['x-behavior-diff-fixture'], 'old-cart');
    assert.equal(addItem.candidate.response.headers['x-behavior-diff-fixture'], 'candidate-cart');
    assert.equal(evidence.summary.firstDifference.stepId, 'add-item');
    assert.equal(evidence.summary.firstDifference.pointer, '/items/0/lineTotal');

    const replayOutput = path.join(directory, 'replay');
    const replay = await runCli(['run', path.join(output, 'scenario.replay.json'), '--out', replayOutput]);
    assert.equal(replay.code, 1, replay.stderr);
    const replayEvidence = await readEvidence(replayOutput);
    assert.equal(replayEvidence.outcome, 'REGRESSION');
    assert.deepEqual(replayEvidence.summary.firstDifference, evidence.summary.firstDifference);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('noisy stateful scenarios shrink through real replays and preserve the target signature', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-shrink-'));
  try {
    const output = path.join(directory, 'shrink');
    const evidence = await runScenario(NOISY_SCENARIO, output, {
      shrink: { maxAttempts: 100 },
    });
    assert.equal(evidence.outcome, 'REGRESSION');
    assert.equal(evidence.reduction.status, 'COMPLETED');
    assert.equal(evidence.reduction.originalScenario.steps.length, 6);
    assert.equal(evidence.reduction.finalScenario.steps.length, 2);
    assert.deepEqual(evidence.reduction.finalScenario.steps.map((step) => step.id), [
      'create-cart',
      'add-item',
    ]);
    assert.deepEqual(evidence.reduction.originalMismatchSignature, {
      stepId: 'add-item',
      pointer: '/items/0/lineTotal',
      classification: 'BUSINESS_DIFFERENCE',
    });
    assert.deepEqual(evidence.reduction.finalMismatchSignature, evidence.reduction.originalMismatchSignature);
    assert.equal(evidence.reduction.attemptLimitReached, false);
    assert.equal(evidence.reduction.minimalUnderOperations, true);
    assert.match(await readFile(path.join(output, 'scenario.original.json'), 'utf8'), /noise-health-before/);
    assert.match(await readFile(path.join(output, 'scenario.replay.json'), 'utf8'), /"id": "add-item"/);
    assert.equal(evidence.reduction.attemptsUsed, evidence.reduction.attempts.length + 1);
    assert.equal(
      evidence.reduction.actualReplays,
      evidence.reduction.attempts.filter((attempt) => attempt.replayed).length + 1,
    );
    for (const attempt of evidence.reduction.attempts.filter((item) => item.replayed)) {
      assert.deepEqual(attempt.reset, { reference: true, candidate: true });
    }
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.result === 'ACCEPTED'), true);
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.result === 'ACCEPTED' && attempt.operation === 'SIMPLIFY_ARRAY'), true);
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.result === 'ACCEPTED' && attempt.operation === 'SIMPLIFY_OBJECT'), true);
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.reason === 'CONFIG_ERROR'), true);
    const invalidCaptureRemoval = evidence.reduction.attempts.find(
      (attempt) => attempt.removedStepId === 'create-cart',
    );
    assert.equal(invalidCaptureRemoval.reason, 'CONFIG_ERROR');
    assert.match(invalidCaptureRemoval.error, /unknown variable cartId/);
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.reason === 'MISMATCH_NOT_REPRODUCED'), true);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);

    const replayOutput = path.join(directory, 'replay');
    const replay = await runCli(['run', path.join(output, 'scenario.replay.json'), '--out', replayOutput]);
    assert.equal(replay.code, 1, replay.stderr);
    const replayEvidence = await readEvidence(replayOutput);
    assert.deepEqual(replayEvidence.summary.firstDifference, {
      stepId: 'add-item',
      pointer: '/items/0/lineTotal',
      classification: 'BUSINESS_DIFFERENCE',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('semantic comparison passes with explicitly ignored volatile fields and different key order', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-pass-'));
  try {
    const output = path.join(directory, 'run');
    const result = await runCli(['run', PASS_SCENARIO, '--out', output]);
    assert.equal(result.code, 0, result.stderr);
    const evidence = await readEvidence(output);
    assert.equal(evidence.outcome, 'PASS');
    assert.equal(evidence.steps.length, 3);
    for (const step of evidence.steps) {
      assert.deepEqual(step.comparison.differences, []);
    }
    assert.notEqual(
      evidence.steps[0].reference.response.body.cartId,
      evidence.steps[0].candidate.response.body.cartId,
    );
    assert.equal(evidence.steps[1].comparison.ignoredDifferences.length >= 2, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reference protocol failures remain inconclusive even when bodies also differ', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-reference-protocol-'));
  try {
    const scenario = JSON.parse(await readFile(REGRESSION_SCENARIO, 'utf8'));
    scenario.steps.find((step) => step.id === 'add-item').expect.status = 201;
    const scenarioPath = path.join(directory, 'reference-protocol.json');
    await writeFile(scenarioPath, JSON.stringify(scenario), 'utf8');
    const evidence = await runScenario(scenarioPath, path.join(directory, 'run'));
    assert.equal(evidence.outcome, 'INCONCLUSIVE');
    assert.equal(evidence.exitCode, 2);
    assert.equal(evidence.reason.code, 'REFERENCE_UNEXPECTED_STATUS');
    assert.equal(evidence.reason.side, 'reference');
    assert.equal(evidence.steps.find((step) => step.id === 'add-item').comparison.differences.length > 0, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('identical shrink inputs produce deterministic decisions and final scenarios', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-deterministic-shrink-'));
  try {
    const first = await runScenario(NOISY_SCENARIO, path.join(directory, 'first'), {
      shrink: { maxAttempts: 100 },
    });
    const second = await runScenario(NOISY_SCENARIO, path.join(directory, 'second'), {
      shrink: { maxAttempts: 100 },
    });
    assert.deepEqual(reductionShape(first), reductionShape(second));
    assert.deepEqual(first.reduction.finalScenario, second.reduction.finalScenario);
    assert.equal(first.reduction.actualReplays, second.reduction.actualReplays);
    assertProcessStopped(first.services.reference.pid);
    assertProcessStopped(first.services.candidate.pid);
    assertProcessStopped(second.services.reference.pid);
    assertProcessStopped(second.services.candidate.pid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('JSON Pointer escaping is exact and never applies broad normalization', () => {
  const result = compareJson(
    { 'a/b': 1, '~key': 2, keep: 3 },
    { 'a/b': 9, '~key': 8, keep: 3 },
    ['/a~1b', '/~0key'],
  );
  assert.equal(result.equal, true);
  assert.deepEqual(result.differences, []);
  assert.equal(result.ignoredDifferences.length, 2);

  const equalIgnoredObject = compareJson(
    { meta: { stable: true } },
    { meta: { stable: true } },
    ['/meta'],
  );
  assert.equal(equalIgnoredObject.ignoredDifferences.length, 0);
  const unequalIgnoredObject = compareJson(
    { meta: { stable: true } },
    { meta: { stable: false } },
    ['/meta'],
  );
  assert.deepEqual(unequalIgnoredObject.ignoredDifferences, [{
    pointer: '/meta/stable',
    reference: true,
    candidate: false,
  }]);
});

test('shrink attempt limits return the verified best scenario without claiming minimality', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-shrink-limit-'));
  try {
    const evidence = await runScenario(NOISY_SCENARIO, path.join(directory, 'run'), {
      shrink: { maxAttempts: 1 },
    });
    assert.equal(evidence.outcome, 'REGRESSION');
    assert.equal(evidence.reduction.status, 'LIMIT_REACHED');
    assert.equal(evidence.reduction.attemptsUsed, 1);
    assert.equal(evidence.reduction.actualReplays, 1);
    assert.deepEqual(evidence.reduction.attempts, []);
    assert.equal(evidence.reduction.attemptLimitReached, true);
    assert.equal(evidence.reduction.minimalUnderOperations, false);
    assert.equal(evidence.reduction.finalScenario.steps.length, 6);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('shrinking a passing baseline stays PASS without claiming a reduction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-shrink-pass-'));
  try {
    const evidence = await runScenario(PASS_SCENARIO, path.join(directory, 'run'), {
      shrink: { maxAttempts: 100 },
    });
    assert.equal(evidence.outcome, 'PASS');
    assert.equal(evidence.reduction.status, 'BASELINE_NOT_REPRODUCING');
    assert.equal(evidence.reduction.attemptsUsed, 1);
    assert.equal(evidence.reduction.actualReplays, 1);
    assert.deepEqual(evidence.reduction.attempts, []);
    assert.equal(evidence.reduction.minimalUnderOperations, false);
    assert.equal(evidence.reduction.finalScenario.steps.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('malformed or unsafe scenarios fail before any service is started', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-config-'));
  try {
    const scenario = JSON.parse(await readFile(REGRESSION_SCENARIO, 'utf8'));
    scenario.steps[0].request.path = '//example.invalid/should-not-be-fetched';
    const scenarioPath = path.join(directory, 'unsafe.json');
    await writeFile(scenarioPath, JSON.stringify(scenario), 'utf8');
    const result = await runCli(['run', scenarioPath, '--out', path.join(directory, 'run')]);
    assert.equal(result.code, 3);
    assert.match(result.stderr, /CONFIG_ERROR/);

    const getWithBody = JSON.parse(await readFile(REGRESSION_SCENARIO, 'utf8'));
    getWithBody.steps[0].request.method = 'GET';
    getWithBody.steps[0].request.body = {};
    const getBodyPath = path.join(directory, 'get-body.json');
    const getBodyOutput = path.join(directory, 'get-body-run');
    await writeFile(getBodyPath, JSON.stringify(getWithBody), 'utf8');
    const getBodyResult = await runCli(['run', getBodyPath, '--out', getBodyOutput]);
    assert.equal(getBodyResult.code, 3);
    assert.match(getBodyResult.stderr, /body is not allowed for GET/);
    await assert.rejects(readFile(path.join(getBodyOutput, 'evidence.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unrelated mismatch signature is rejected even when the candidate still regresses', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-signature-'));
  try {
    const evidence = await runScenario(NOISY_SCENARIO, path.join(directory, 'run'), {
      shrink: { maxAttempts: 100 },
      fixtureOptions: {
        candidate: { alternateMismatchSku: 'c' },
      },
    });
    assert.equal(evidence.reduction.status, 'COMPLETED');
    const changed = evidence.reduction.attempts.find((attempt) => attempt.reason === 'MISMATCH_SIGNATURE_CHANGED');
    assert.ok(changed);
    assert.equal(changed.execution.signature.pointer, '/subtotal');
    assert.equal(
      evidence.reduction.attempts.some(
        (attempt) => attempt.result === 'ACCEPTED' && attempt.execution.signature.pointer === '/subtotal',
      ),
      false,
    );
    assert.deepEqual(evidence.reduction.finalMismatchSignature, evidence.reduction.originalMismatchSignature);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('request timeout is inconclusive and retains paired partial evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-timeout-'));
  try {
    const output = path.join(directory, 'run');
    const evidence = await runScenario(REGRESSION_SCENARIO, output, {
      requestTimeoutMs: 20,
      fixtureOptions: {
        candidate: { responseDelayMs: 100, responseDelayStep: 'add-item' },
      },
    });
    assert.equal(evidence.outcome, 'INCONCLUSIVE');
    assert.equal(evidence.exitCode, 2);
    assert.equal(evidence.reason.code, 'REQUEST_TIMEOUT');
    assert.equal(evidence.reason.side, 'candidate');
    assert.equal(evidence.reason.stepId, 'add-item');
    const addItem = evidence.steps.find((step) => step.id === 'add-item');
    assert.equal(addItem.reference.response.body.total, 20);
    assert.equal(addItem.candidate.error.code, 'REQUEST_TIMEOUT');
    assert.equal(evidence.services.reference.ready, true);
    assert.equal(evidence.services.candidate.ready, true);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('timeouts are rejected as reductions and never accepted as the target mismatch', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-shrink-timeout-'));
  try {
    const evidence = await runScenario(NOISY_SCENARIO, path.join(directory, 'run'), {
      requestTimeoutMs: 20,
      shrink: { maxAttempts: 100 },
      fixtureOptions: {
        candidate: {
          timeoutOnQuantity: 1,
          responseDelayMs: 100,
          responseDelayStep: 'add-item',
        },
      },
    });
    const timeoutAttempt = evidence.reduction.attempts.find(
      (attempt) => attempt.execution?.reason?.code === 'REQUEST_TIMEOUT',
    );
    assert.ok(timeoutAttempt);
    assert.equal(timeoutAttempt.result, 'REJECTED');
    assert.equal(timeoutAttempt.reason, 'INCONCLUSIVE_REPLAY');
    assert.equal(timeoutAttempt.rejectionDetail.code, 'REQUEST_TIMEOUT');
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.execution?.reason?.code === 'REQUEST_TIMEOUT' && attempt.result === 'ACCEPTED'), false);
    assert.deepEqual(evidence.reduction.finalMismatchSignature, evidence.reduction.originalMismatchSignature);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a crashed fixture aborts shrinking and cannot be accepted as a reproduction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-shrink-crash-'));
  try {
    const evidence = await runScenario(NOISY_SCENARIO, path.join(directory, 'run'), {
      shrink: { maxAttempts: 100 },
      fixtureOptions: {
        candidate: { crashOnQuantity: 1 },
      },
    });
    const crashAttempt = evidence.reduction.attempts.find(
      (attempt) => attempt.execution?.reason?.code === 'TRANSPORT_ERROR',
    );
    assert.ok(crashAttempt);
    assert.equal(crashAttempt.result, 'REJECTED');
    assert.equal(evidence.reduction.status, 'ABORTED');
    assert.equal(evidence.reduction.minimalUnderOperations, false);
    assert.equal(evidence.reduction.attempts.some((attempt) => attempt.execution?.reason?.code === 'TRANSPORT_ERROR' && attempt.result === 'ACCEPTED'), false);
    assert.deepEqual(evidence.reduction.finalMismatchSignature, evidence.reduction.originalMismatchSignature);
    assert.equal(typeof crashAttempt.execution.steps.find((step) => step.id === 'add-item').candidate.error.diagnostics.pid, 'number');
    assert.equal(crashAttempt.execution.steps.find((step) => step.id === 'add-item').candidate.error.diagnostics.exitCode, 1);
    assertProcessStopped(evidence.services.reference.pid);
    assertProcessStopped(evidence.services.candidate.pid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
