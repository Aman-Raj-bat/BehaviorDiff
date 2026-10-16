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

test('malformed and incomplete evidence fail safely without inventing measurements', () => {
  assert.throws(() => parseEvidence('{bad json'), WorkbenchEvidenceError);
  assert.throws(() => parseEvidence({ outcome: 'MAYBE' }), /outcome/);
  assert.throws(() => parseEvidence({ outcome: 'INCONCLUSIVE', steps: [null] }), /steps\[0\]/);
  assert.throws(() => parseEvidence({ outcome: 'REGRESSION', steps: [{ comparison: { differences: 'not-an-array' } }] }), /differences/);
  const summaryOnly = buildWorkbenchModel({
    outcome: 'REGRESSION',
    summary: { firstDifference: { stepId: 'invented', pointer: '/not-recorded', classification: 'BUSINESS_DIFFERENCE' } },
  });
  assert.equal(summaryOnly.mismatch, null);
  const incomplete = buildWorkbenchModel({ outcome: 'INCONCLUSIVE' });
  assert.equal(incomplete.counts.actualReplays, null);
  assert.equal(incomplete.counts.originalStepCount, null);
  assert.equal(incomplete.mismatch, null);
  assert.equal(incomplete.copyPayloads.scenario, null);
});

test('workbench API uses fixed scenarios and performs a real replay action', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-api-'));
  const workbench = createWorkbenchServer({ outputRoot: path.join(directory, 'artifacts') });
  try {
    const address = await workbench.listen({ port: 0 });
    const request = (pathname, options) => fetch(`${address.url.replace(/\/$/, '')}${pathname}`, options);
    const page = await request('/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Make a behavior mismatch legible/);
    const script = await request('/app.js');
    assert.equal(script.status, 200);
    assert.match(await script.text(), /navigator\.clipboard\.writeText/);
    const scenarios = await (await request('/api/scenarios')).json();
    assert.deepEqual(scenarios.scenarios.map((scenario) => scenario.id), ['cart-total', 'cart-total-pass', 'cart-noisy']);

    const unsafe = await request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: '../secret', mode: 'run' }),
    });
    assert.equal(unsafe.status, 400);
    assert.match((await unsafe.json()).error, /checked-in scenarios/);
    assert.throws(() => validateRunRequest({ scenario: 'http://example.invalid', mode: 'run' }), /checked-in scenarios/);
    assert.throws(() => scenarioPathFor('../../etc/passwd'), /checked-in scenarios/);

    const createdResponse = await request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'cart-total', mode: 'run' }),
    });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.equal(created.outcome, 'REGRESSION');
    assert.equal(created.steps.find((step) => step.id === 'add-item').candidate.response.body.total, 10);

    const stored = await (await request(`/api/runs/${created.runId}`)).json();
    assert.equal(stored.mismatch.pointer, '/items/0/lineTotal');
    const evidenceResponse = await request(`/api/runs/${created.runId}/evidence`);
    assert.equal(evidenceResponse.status, 200);
    assert.equal((await evidenceResponse.json()).outcome, 'REGRESSION');

    const replayResponse = await request(`/api/runs/${created.runId}/replay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    assert.equal(replayResponse.status, 201);
    const replay = await replayResponse.json();
    assert.equal(replay.outcome, 'REGRESSION');
    assert.equal(replay.steps.find((step) => step.id === 'add-item').comparison.differences[0].pointer, '/items/0/lineTotal');
    const replayParts = replay.runId.split('/');
    const replayEvidence = await request(`/api/runs/${replayParts[0]}/replays/${replayParts[1]}/evidence`);
    assert.equal(replayEvidence.status, 200);
    assert.equal((await replayEvidence.json()).outcome, 'REGRESSION');
  } finally {
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('workbench serializes jobs and bounds malformed request bodies', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-hardening-'));
  const workbench = createWorkbenchServer({ outputRoot: path.join(directory, 'artifacts') });
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    const post = (body) => fetch(`${base}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const tooLarge = await post(JSON.stringify({ scenario: 'cart-total', mode: 'run', padding: 'x'.repeat(40_000) }));
    assert.equal(tooLarge.status, 413);

    const first = post(JSON.stringify({ scenario: 'cart-noisy', mode: 'shrink', maxAttempts: 100 }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await post(JSON.stringify({ scenario: 'cart-total', mode: 'run' }));
    assert.equal(second.status, 429);
    await first;
  } finally {
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});
