import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildWorkbenchModel, parseEvidence, WorkbenchEvidenceError } from '../src/workbench-data.mjs';
import {
  createWorkbenchServer,
  scenarioPathFor,
  validateRunRequest,
} from '../src/workbench-server.mjs';
import { runScenario } from '../src/run-scenario.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const REGRESSION_SCENARIO = path.join(ROOT, 'scenarios', 'cart-total.json');
const PASS_SCENARIO = path.join(ROOT, 'scenarios', 'cart-total-pass.json');
const NOISY_SCENARIO = path.join(ROOT, 'scenarios', 'cart-noisy.json');

async function scenarioAt(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

test('workbench model renders actual regression values, target path, and copy payloads', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-model-'));
  try {
    const evidence = await runScenario(REGRESSION_SCENARIO, path.join(directory, 'run'));
    const model = buildWorkbenchModel(evidence, {
      scenario: await scenarioAt(REGRESSION_SCENARIO),
      runId: 'run-regression-test',
      artifactBase: '/api/runs/run-regression-test',
    });
    const addItem = model.steps.find((step) => step.id === 'add-item');
    assert.equal(model.outcome, 'REGRESSION');
    assert.deepEqual(model.mismatch, {
      stepId: 'add-item',
      pointer: '/items/0/lineTotal',
      classification: 'BUSINESS_DIFFERENCE',
    });
    assert.equal(addItem.reference.response.body.items[0].lineTotal, 20);
    assert.equal(addItem.candidate.response.body.items[0].lineTotal, 10);
    assert.deepEqual(addItem.comparison.differences[0], {
      pointer: '/items/0/lineTotal',
      reference: 20,
      candidate: 10,
    });
    assert.match(model.copyPayloads.scenario, /cart quantity contributes/);
    assert.match(model.copyPayloads.mismatch, /lineTotal/);
    assert.equal(model.artifacts.evidence, '/api/runs/run-regression-test/evidence');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('workbench model preserves six-to-two shrink evidence and accepted/rejected decisions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-shrink-'));
  try {
    const evidence = await runScenario(NOISY_SCENARIO, path.join(directory, 'run'), {
      shrink: { maxAttempts: 100 },
    });
    const model = buildWorkbenchModel(evidence, {
      scenario: evidence.reduction.finalScenario,
      originalScenario: evidence.reduction.originalScenario,
      runId: 'shrink-evidence-test',
    });
    assert.equal(model.counts.originalStepCount, 6);
    assert.equal(model.counts.minimizedStepCount, 2);
    assert.equal(model.counts.actualReplays, evidence.reduction.actualReplays);
    assert.equal(model.counts.attemptsUsed, evidence.reduction.attemptsUsed);
    assert.equal(model.reduction.minimalUnderOperations, true);
    assert.equal(model.reduction.attempts.some((attempt) => attempt.result === 'ACCEPTED'), true);
    assert.equal(model.reduction.attempts.some((attempt) => attempt.result === 'REJECTED'), true);
    assert.equal(model.reduction.attempts.some((attempt) => attempt.reason === 'CONFIG_ERROR'), true);
    assert.equal(model.reduction.attempts.some((attempt) => attempt.reason === 'MISMATCH_NOT_REPRODUCED'), true);
    assert.equal(model.reduction.attempts.every((attempt, index) => attempt.attempt === evidence.reduction.attempts[index].attempt), true);
    assert.deepEqual(model.scenarios.minimized.steps.map((step) => step.id), ['create-cart', 'add-item']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('PASS, ignored volatile fields, and INCONCLUSIVE evidence remain distinct', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-outcomes-'));
  try {
    const passEvidence = await runScenario(PASS_SCENARIO, path.join(directory, 'pass'));
    const passModel = buildWorkbenchModel(passEvidence, { scenario: await scenarioAt(PASS_SCENARIO) });
    assert.equal(passModel.outcome, 'PASS');
    assert.equal(passModel.mismatch, null);
    assert.equal(passModel.steps[1].comparison.differences.length, 0);
    assert.equal(passModel.steps[1].comparison.ignoredDifferences.some((item) => item.pointer === '/cartId'), true);

    const inconclusiveEvidence = await runScenario(REGRESSION_SCENARIO, path.join(directory, 'inconclusive'), {
      requestTimeoutMs: 20,
      fixtureOptions: { candidate: { responseDelayMs: 100, responseDelayStep: 'add-item' } },
    });
    const inconclusiveModel = buildWorkbenchModel(inconclusiveEvidence, { scenario: await scenarioAt(REGRESSION_SCENARIO) });
    assert.equal(inconclusiveModel.outcome, 'INCONCLUSIVE');
    assert.equal(inconclusiveModel.reason.code, 'REQUEST_TIMEOUT');
    assert.equal(inconclusiveModel.counts.actualReplays, null);
    assert.equal(inconclusiveModel.steps.find((step) => step.id === 'add-item').candidate.error.code, 'REQUEST_TIMEOUT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
