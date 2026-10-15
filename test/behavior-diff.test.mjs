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
