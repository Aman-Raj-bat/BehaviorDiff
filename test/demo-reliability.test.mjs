import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { createCartService } from '../fixtures/service-common.mjs';
import { requestJson } from '../src/http-json.mjs';
import { buildWorkbenchModel } from '../src/workbench-data.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const TARGET = {
  stepId: 'add-item',
  pointer: '/items/0/lineTotal',
  classification: 'BUSINESS_DIFFERENCE',
};

function fixtureEnvironment(overrides = {}) {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('BEHAVIOR_DIFF_'))),
    ...overrides,
  };
}

async function demoProject(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-demo-reliability-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // Copy, rather than symlink: both the demo and fixture registry resolve their project from import.meta.url.
  await Promise.all(['scripts', 'src', 'fixtures', 'scenarios'].map((name) => cp(
    path.join(ROOT, name), path.join(directory, name), { recursive: true },
  )));
  return directory;
}

function runDemo(directory, environment = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, 'scripts', 'demo.mjs')], {
      cwd: directory,
      env: fixtureEnvironment(environment),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

async function demoArtifacts(directory) {
  const output = path.join(directory, 'artifacts', 'demo-shrink');
  const readJson = async (name) => JSON.parse(await readFile(path.join(output, name), 'utf8'));
  return {
    evidence: await readJson('evidence.json'),
    replay: await readJson('scenario.replay.json'),
  };
}

function assertFixturesStopped(evidence) {
  for (const service of Object.values(evidence.services)) {
    assert.equal(typeof service.pid, 'number');
    assert.throws(() => process.kill(service.pid, 0), (error) => error.code === 'ESRCH');
  }
}

test('demo subprocess succeeds only after a completed target-preserving reduction', async (t) => {
  const directory = await demoProject(t);
  const result = await runDemo(directory);
  const { evidence, replay } = await demoArtifacts(directory);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.equal(evidence.outcome, 'REGRESSION');
  assert.equal(evidence.reduction.status, 'COMPLETED');
  assert.deepEqual(evidence.reduction.originalMismatchSignature, TARGET);
  assert.deepEqual(evidence.reduction.finalMismatchSignature, TARGET);
  assert.deepEqual(replay.steps.map((step) => step.id), ['create-cart', 'add-item']);
  assert.match(result.stdout, /^reductionStatus=COMPLETED$/m);
  assert.match(result.stdout, /^originalSteps=6$/m);
  assert.match(result.stdout, /^finalSteps=2$/m);
  assert.match(result.stdout, /^finalStepIds=create-cart,add-item$/m);
  assert.match(result.stdout, /^minimalUnderOperations=true$/m);
  const addItem = evidence.steps.find((step) => step.id === 'add-item');
  assert.ok(result.stdout.includes(`reference response=${JSON.stringify(addItem.reference.response.body)}\n`));
  assert.ok(result.stdout.includes(`candidate response=${JSON.stringify(addItem.candidate.response.body)}\n`));
  assert.ok(result.stdout.includes(`business mismatch=${JSON.stringify(addItem.comparison.differences[0])}\n`));
  assert.ok(result.stdout.includes(`signature=${JSON.stringify(TARGET)}\n`));
  assertFixturesStopped(evidence);
});

test('demo subprocess accepts a verified limit-bounded reduction without claiming minimality', async (t) => {
  const directory = await demoProject(t);
  const scenarioPath = path.join(directory, 'scenarios', 'cart-noisy.json');
  const scenario = JSON.parse(await readFile(scenarioPath, 'utf8'));
  // Exhaust the fixed demo budget through real accepted array reductions, without adding runtime options.
  scenario.variables.unusedArray = Array(120).fill('noise');
  await writeFile(scenarioPath, JSON.stringify(scenario), 'utf8');
  const result = await runDemo(directory);
  const { evidence, replay } = await demoArtifacts(directory);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(evidence.outcome, 'REGRESSION');
  assert.equal(evidence.reduction.status, 'LIMIT_REACHED');
  assert.equal(evidence.reduction.attemptsUsed, 100);
  assert.equal(evidence.reduction.attemptLimitReached, true);
  assert.equal(evidence.reduction.minimalUnderOperations, false);
  assert.deepEqual(evidence.reduction.originalMismatchSignature, TARGET);
  assert.deepEqual(evidence.reduction.finalMismatchSignature, TARGET);
  assert.deepEqual(replay, evidence.reduction.finalScenario);
  assert.match(result.stdout, /^reductionStatus=LIMIT_REACHED$/m);
  assert.match(result.stdout, /^minimalUnderOperations=false$/m);
  assertFixturesStopped(evidence);
});

test('demo subprocess fails for ABORTED reduction even when the last verified replay still regresses', async (t) => {
  const directory = await demoProject(t);
  const result = await runDemo(directory, { BEHAVIOR_DIFF_CRASH_ON_QUANTITY: '1' });
  const { evidence, replay } = await demoArtifacts(directory);
  assert.equal(evidence.outcome, 'REGRESSION');
  assert.equal(evidence.reduction.status, 'ABORTED');
  assert.deepEqual(evidence.reduction.finalMismatchSignature, TARGET);
  assert.deepEqual(replay, evidence.reduction.finalScenario);
  assert.ok(evidence.reduction.attempts.some((attempt) => attempt.execution?.reason?.code === 'TRANSPORT_ERROR'));
  assert.equal(result.code, 1, result.stdout);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^reductionStatus=ABORTED$/m);
  assert.match(result.stdout, /^minimalUnderOperations=false$/m);
  assertFixturesStopped(evidence);
});

test('demo subprocess reports early startup failure and unavailable evidence without a TypeError', async (t) => {
  const directory = await demoProject(t);
  const result = await runDemo(directory, { BEHAVIOR_DIFF_FAIL_STARTUP: '1' });
  const { evidence, replay } = await demoArtifacts(directory);
  assert.equal(evidence.outcome, 'INCONCLUSIVE');
  assert.equal(evidence.reason.code, 'STARTUP_FAILURE');
  assert.equal(evidence.reduction, undefined);
  assert.deepEqual(evidence.steps, []);
  assert.equal(replay.steps.length, 6);
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^outcome=INCONCLUSIVE$/m);
  assert.match(result.stdout, /^reason=STARTUP_FAILURE$/m);
  for (const field of ['reductionStatus', 'originalSteps', 'finalSteps', 'finalStepIds', 'reference response',
    'candidate response', 'business mismatch', 'signature', 'actualReplays', 'minimalUnderOperations']) {
    assert.ok(result.stdout.includes(`${field}=unavailable\n`), result.stdout);
  }
  assert.match(result.stdout, /^replay=node bin\/behavior-diff\.mjs run /m);
  assert.match(result.stdout, /^evidence=artifacts[\\/]demo-shrink[\\/]evidence\.json$/m);
  assert.doesNotMatch(result.stdout + result.stderr, /TypeError|undefined/);
  assertFixturesStopped(evidence);
});

test('fixture response delay is scheduled once and respects step and quantity filters', async (t) => {
  const delayMs = 12_345;
  const cases = [
    { name: 'quantity and step match', step: 'add-item', quantity: '1', addOne: 1, addTwo: 0, health: 0, read: 0 },
    { name: 'quantity without step filter', quantity: '1', addOne: 1, addTwo: 0, health: 1, read: 1 },
    { name: 'step filter excludes matching quantity', step: 'read-cart', quantity: '1', addOne: 0, addTwo: 0, health: 0, read: 1 },
    { name: 'step delay without quantity filter', step: 'add-item', addOne: 1, addTwo: 1, health: 0, read: 0 },
    { name: 'no delay configured', step: 'add-item', quantity: '1', delay: '0', addOne: 0, addTwo: 0, health: 0, read: 0 },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async (t) => {
      const previous = { ...process.env };
      const environment = fixtureEnvironment({ BEHAVIOR_DIFF_RESPONSE_DELAY_MS: entry.delay ?? String(delayMs) });
      if (entry.step) environment.BEHAVIOR_DIFF_RESPONSE_DELAY_STEP = entry.step;
      if (entry.quantity) environment.BEHAVIOR_DIFF_TIMEOUT_ON_QUANTITY = entry.quantity;
      for (const name of Object.keys(process.env)) {
        if (name.startsWith('BEHAVIOR_DIFF_')) delete process.env[name];
      }
      Object.assign(process.env, environment);
      t.after(() => {
        for (const name of Object.keys(process.env)) {
          if (name.startsWith('BEHAVIOR_DIFF_')) delete process.env[name];
        }
        Object.assign(process.env, previous);
      });
      const delays = [];
      const realSetTimeout = globalThis.setTimeout;
      t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => {
        // Exercise the HTTP handler but count fixture waits deterministically instead of timing the network.
        if (ms === delayMs || ms === 0) {
          delays.push(ms);
          return realSetTimeout(callback, 0, ...args);
        }
        return realSetTimeout(callback, ms, ...args);
      });
      const service = createCartService({ fixture: 'old-cart', variant: 'reference' });
      t.after(() => service.stop());
      const log = t.mock.method(console, 'log', () => {});
      await service.start();
      const ready = JSON.parse(log.mock.calls[0].arguments[0]);
      log.mock.restore();
      const request = async (method, requestPath, body) => requestJson({
        baseUrl: `http://127.0.0.1:${ready.port}/`,
        request: { method, path: requestPath, ...(body === undefined ? {} : { body }) },
        timeoutMs: 2_000,
      });
      const create = await request('POST', '/carts', {});
      assert.equal(create.status, 201);
      const cartPath = `/carts/${create.body.cartId}`;
      for (const [method, requestPath, body, expected] of [
        ['POST', `${cartPath}/items`, { sku: 'coffee', quantity: 1, unitPrice: 10 }, entry.addOne],
        ['POST', `${cartPath}/items`, { sku: 'coffee', quantity: 2, unitPrice: 10 }, entry.addTwo],
        ['GET', '/health', undefined, entry.health],
        ['GET', cartPath, undefined, entry.read],
        ['POST', '/reset', {}, 0],
      ]) {
        delays.length = 0;
        const response = await request(method, requestPath, body);
        assert.equal(response.status, 200);
        assert.deepEqual(delays, Array(expected).fill(delayMs), `${method} ${requestPath}`);
      }
    });
  }
});

test('UI helpers render scenario methods for retained and removed shrink rail steps truthfully', async () => {
  const source = await readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const initialization = source.indexOf("\ndocument.addEventListener('click'");
  assert.ok(initialization > 0);
  // Load the real rendering definitions without browser event wiring or API bootstrapping.
  const { stepMethod, evidenceRail } = runInNewContext(
    `${source.slice(0, initialization)}\n({ stepMethod, evidenceRail });`,
    { document: { querySelector: () => null } },
  );
  const original = JSON.parse(await readFile(path.join(ROOT, 'scenarios', 'cart-noisy.json'), 'utf8'));
  const minimized = { ...original, steps: original.steps.filter((step) => ['create-cart', 'add-item'].includes(step.id)) };
  const model = buildWorkbenchModel({
    outcome: 'REGRESSION',
    reduction: { originalScenario: original, finalScenario: minimized },
    steps: minimized.steps.map((step) => ({ id: step.id, requestTemplate: step.request })),
  });
  const html = evidenceRail(model);
  assert.equal((html.match(/<b>POST<\/b>/g) ?? []).length, 3);
  assert.equal((html.match(/<b>GET<\/b>/g) ?? []).length, 3);
  assert.equal((html.match(/class="evidence-step removed/g) ?? []).length, 4);
  assert.match(html, /<b>GET<\/b> \/health/);
  assert.match(html, /<b>POST<\/b> \/carts\/\{\{cartId\}\}\/items/);
  assert.doesNotMatch(html, /<b>—<\/b>|undefined/);
  assert.equal(stepMethod({ requestTemplate: { method: 'POST' } }), 'POST');
  assert.equal(stepMethod({ reference: { request: { method: 'GET' } } }), 'GET');
  assert.equal(stepMethod({}), '—');
  assert.equal(stepMethod(undefined), '—');
});
