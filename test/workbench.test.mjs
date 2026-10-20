import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
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

function postJson(base, pathname, body, options = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    ...options,
  });
}

async function within(promise, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Forward every request to the actual fixture, holding only one real reset response.
function synchronizeFixtureReset(resetNumber = 1) {
  const realFetch = globalThis.fetch;
  const reached = Promise.withResolvers();
  const released = Promise.withResolvers();
  let resets = 0;
  globalThis.fetch = async (input, options) => {
    const response = await realFetch(input, options);
    if (options?.method === 'POST' && new URL(input).pathname === '/reset' && ++resets === resetNumber) {
      reached.resolve(options.signal);
      await released.promise;
    }
    return response;
  };
  return {
    reached: reached.promise,
    release: released.resolve,
    restore() {
      released.resolve();
      globalThis.fetch = realFetch;
    },
  };
}

function partialJsonPost(workbench, base, pathname, body) {
  const serialized = JSON.stringify(body);
  const received = Promise.withResolvers();
  const result = Promise.withResolvers();
  const onRequest = (request) => request.once('data', received.resolve);
  workbench.server.once('request', onRequest);
  const request = httpRequest(`${base}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(serialized),
      connection: 'close',
    },
  }, async (response) => {
    try {
      const chunks = [];
      for await (const chunk of response) chunks.push(chunk);
      result.resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    } catch (error) {
      result.reject(error);
    }
  });
  request.on('error', result.reject);
  // A failed assertion may destroy the connection before its response is awaited.
  result.promise.catch(() => {});
  request.write(serialized.slice(0, 1));
  return {
    received: received.promise,
    result: result.promise,
    finish: () => request.end(serialized.slice(1)),
    destroy() {
      workbench.server.removeListener('request', onRequest);
      request.destroy();
    },
  };
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
    const pageHtml = await page.text();
    assert.match(pageHtml, /Find the <span>difference\.<\/span>/);
    assert.match(pageHtml, /Launch Evidence Lab/);
    assert.match(pageHtml, /cart-noisy/);
    assert.match(pageHtml, /href="\/lab"/);
    assert.doesNotMatch(pageHtml, /href="\.\/lab/);
    assert.match(pageHtml, /class="preview-cursor"/);
    assert.match(pageHtml, /data-cursor-src="\/hand_cursor\.png"/);
    assert.match(pageHtml, /class="preview-cursor-image"/);
    assert.match(pageHtml, /href="\/favicon\.svg"/);
    assert.match(pageHtml, /href="\/favicon\.png"/);
    assert.match(pageHtml, /src="\/logo\.svg"/);
    const lab = await request('/lab');
    assert.equal(lab.status, 200);
    assert.match(lab.headers.get('content-type'), /^text\/html; charset=utf-8/);
    const labHtml = await lab.text();
    assert.match(labHtml, /Make a behavior mismatch legible/);
    assert.match(labHtml, /EVIDENCE LAB/);
    assert.match(labHtml, /topbar-scenario-select/);
    assert.match(labHtml, /class="lab-layout"/);
    assert.match(labHtml, /id="run-view"/);
    assert.match(labHtml, /class="skip-link"/);
    assert.match(labHtml, /href="\/favicon\.svg"/);
    assert.match(labHtml, /href="\/favicon\.png"/);
    assert.match(labHtml, /src="\/logo\.svg"/);
    assert.match(labHtml, /class="empty-workspace-card"/);
    const refreshedLab = await request('/lab');
    assert.equal(refreshedLab.status, 200);
    assert.match(await refreshedLab.text(), /id="run-form"/);
    const labWithSlash = await request('/lab/');
    assert.equal(labWithSlash.status, 200);
    assert.match(await labWithSlash.text(), /id="run-form"/);
    const script = await request('/app.js');
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
    const appScript = await script.text();
    assert.match(appScript, /navigator\.clipboard\.writeText/);
    assert.match(appScript, /evidenceRail/);
    assert.match(appScript, /mismatchSpecimen/);
    assert.match(appScript, /runView\.innerHTML/);
    const landingScript = await request('/landing.js');
    assert.equal(landingScript.status, 200);
    assert.match(landingScript.headers.get('content-type'), /^text\/javascript; charset=utf-8/);
    const landingScriptText = await landingScript.text();
    assert.match(landingScriptText, /prefers-reduced-motion/);
    assert.match(landingScriptText, /getBoundingClientRect/);
    assert.match(landingScriptText, /phaseDurations/);
    assert.match(landingScriptText, /cursorImage/);
    assert.match(landingScriptText, /activeTargets/);
    assert.match(landingScriptText, /scheduleNextPhase/);
    const styles = await request('/styles.css');
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /^text\/css; charset=utf-8/);
    const stylesText = await styles.text();
    assert.match(stylesText, /--signal-lime:\s*#D7FF64/);
    assert.match(stylesText, /--type-body:\s*1rem/);
    assert.match(stylesText, /\.preview-cursor/);
    assert.match(stylesText, /\.lab-page \.lab-layout/);
    assert.match(stylesText, /\.reduction-overview/);
    assert.match(stylesText, /\.specimen/);
    assert.match(stylesText, /\.reduction-trace/);
    assert.match(stylesText, /\.brand-logo/);
    const logo = await request('/logo.svg');
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get('content-type'), /^image\/svg\+xml; charset=utf-8/);
    assert.match(await logo.text(), /<svg[^>]+viewBox/);
    const favicon = await request('/favicon.svg');
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get('content-type'), /^image\/svg\+xml; charset=utf-8/);
    assert.match(await favicon.text(), /<svg[^>]+viewBox/);
    const faviconPng = await request('/favicon.png');
    assert.equal(faviconPng.status, 200);
    assert.match(faviconPng.headers.get('content-type'), /^image\/png/);
    assert.equal((await faviconPng.arrayBuffer()).byteLength > 100, true);
    const handCursor = await request('/hand_cursor.png');
    assert.equal(handCursor.status, 200);
    assert.match(handCursor.headers.get('content-type'), /^image\/png/);
    assert.equal((await handCursor.arrayBuffer()).byteLength > 100, true);
    const scenarios = await (await request('/api/scenarios')).json();
    assert.deepEqual(scenarios.scenarios.map((scenario) => scenario.id), ['cart-total', 'cart-total-pass', 'cart-noisy']);
    const scenariosWithQuery = await request('/api/scenarios?refresh=1');
    assert.equal(scenariosWithQuery.status, 200);
    assert.match(scenariosWithQuery.headers.get('content-type'), /^application\/json; charset=utf-8/);
    const runs = await request('/api/runs');
    assert.equal(runs.status, 200);
    assert.match(runs.headers.get('content-type'), /^application\/json; charset=utf-8/);
    const unknown = await request('/not-a-valid-route');
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'not found' });
    const nestedUnknown = await request('/lab/unknown');
    assert.equal(nestedUnknown.status, 404);
    assert.deepEqual(await nestedUnknown.json(), { error: 'not found' });

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

test('workbench shares one concurrency slot between real runs and replays in both directions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-hardening-'));
  const outputRoot = path.join(directory, 'artifacts');
  const workbench = createWorkbenchServer({ outputRoot });
  let reset;
  let pending;
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    const seedResponse = await postJson(base, '/api/runs', { scenario: 'cart-total' });
    assert.equal(seedResponse.status, 201);
    const seed = await seedResponse.json();
    const replayPath = `/api/runs/${seed.runId}/replay`;

    for (const [activePath, body, blockedPath, blockedBody] of [
      ['/api/runs', { scenario: 'cart-total-pass', requestTimeoutMs: 10_000 }, replayPath, {}],
      [replayPath, {}, '/api/runs', { scenario: 'cart-total-pass' }],
    ]) {
      reset = synchronizeFixtureReset();
      pending = postJson(base, activePath, body);
      await within(reset.reached, 'active fixture reset');
      const blocked = await postJson(base, blockedPath, blockedBody);
      assert.equal(blocked.status, 429);
      assert.match((await blocked.json()).error, /already in progress/);
      reset.release();
      const completed = await pending;
      assert.equal(completed.status, 201);
      assert.equal((await completed.json()).outcome, activePath === '/api/runs' ? 'PASS' : 'REGRESSION');
      reset.restore();
    }
    assert.equal((await readdir(outputRoot)).length, 2);
    assert.equal((await readdir(path.join(outputRoot, seed.runId, 'replays'))).length, 1);
  } finally {
    reset?.restore();
    await pending?.catch(() => {});
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('aborting at the first real reduction reset records cancellation metrics and releases the slot', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-cancel-'));
  const outputRoot = path.join(directory, 'artifacts');
  const workbench = createWorkbenchServer({ outputRoot });
  const reset = synchronizeFixtureReset(3);
  const controller = new AbortController();
  let request;
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    request = postJson(base, '/api/runs', {
      scenario: 'cart-noisy', mode: 'shrink', maxAttempts: 100, requestTimeoutMs: 10_000,
    }, {
      signal: controller.signal,
    });
    const signal = await within(reset.reached, 'first reduction reset after the two baseline resets');
    const cancelled = once(signal, 'abort');
    controller.abort();
    await assert.rejects(request, (error) => error.name === 'AbortError');
    await within(cancelled, 'server cancellation reaching the fixture request');
    reset.release();

    // Retry only the busy response: the first admitted real PASS run proves slot release.
    const deadline = Date.now() + 5_000;
    let next;
    do {
      next = await postJson(base, '/api/runs', { scenario: 'cart-total-pass' });
      if (next.status !== 429) break;
      await next.json();
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);
    assert.equal(next.status, 201);
    assert.equal((await next.json()).outcome, 'PASS');

    const entries = await readdir(outputRoot, { withFileTypes: true });
    assert.equal(entries.length, 2);
    const shrink = entries.find((entry) => entry.name.startsWith('shrink-'));
    const evidence = await scenarioAt(path.join(outputRoot, shrink.name, 'evidence.json'));
    assert.equal(evidence.outcome, 'INCONCLUSIVE');
    assert.equal(evidence.reason.code, 'RUN_CANCELLED');
    assert.equal(evidence.reduction.status, 'ABORTED');
    assert.equal(evidence.reduction.minimalUnderOperations, false);
    assert.equal(evidence.reduction.attemptsUsed, 2);
    assert.equal(evidence.reduction.actualReplays, 1);
    assert.equal(evidence.reduction.attempts.length, 1);
    assert.equal(evidence.reduction.attempts[0].reason, 'RUN_CANCELLED');
    assert.equal(evidence.reduction.attempts[0].replayed, false);
    const storedResponse = await fetch(`${base}/api/runs/${shrink.name}`);
    assert.equal(storedResponse.status, 200);
    const stored = await storedResponse.json();
    assert.equal(stored.outcome, 'INCONCLUSIVE');
    assert.equal(stored.mismatch, null);
    assert.equal(stored.counts.actualReplays, evidence.reduction.actualReplays);
    assert.equal(stored.counts.attemptsUsed, evidence.reduction.attemptsUsed);
    for (const service of Object.values(evidence.services)) {
      if (typeof service.pid !== 'number') continue;
      assert.throws(() => process.kill(service.pid, 0), (error) => error.code === 'ESRCH');
    }
  } finally {
    controller.abort();
    reset.restore();
    await request?.catch(() => {});
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('startup-failed shrink returns its real INCONCLUSIVE model with unavailable reduction artifacts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-startup-'));
  const workbench = createWorkbenchServer({ outputRoot: path.join(directory, 'artifacts') });
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    const response = await postJson(base, '/api/runs', {
      scenario: 'cart-noisy', mode: 'shrink', startupTimeoutMs: 1,
    });
    assert.equal(response.status, 201);
    const model = await response.json();
    assert.equal(model.outcome, 'INCONCLUSIVE');
    assert.equal(model.reason.code, 'STARTUP_TIMEOUT');
    assert.equal(model.reduction, null);
    assert.equal(model.counts.actualReplays, null);
    assert.equal(model.counts.attemptsUsed, null);
    assert.equal(model.counts.originalStepCount, null);
    assert.equal(model.counts.minimizedStepCount, 6);
    assert.equal(model.scenarios.original, null);
    assert.equal(model.artifacts.originalScenario, null);
    assert.deepEqual(model.steps, []);
    assert.deepEqual(await (await fetch(`${base}/api/runs/${model.runId}`)).json(), model);
    assert.deepEqual(await (await fetch(`${base}${model.artifacts.evidence}`)).json(), model.raw);
    assert.deepEqual(await (await fetch(`${base}${model.artifacts.minimizedScenario}`)).json(), await scenarioAt(NOISY_SCENARIO));
    const original = await fetch(`${base}/api/runs/${model.runId}/original-scenario`);
    assert.equal(original.status, 404);
    assert.match((await original.json()).error, /unavailable/);
    const listed = await (await fetch(`${base}/api/runs`)).json();
    assert.equal(listed.runs.length, 1);
    assert.equal(listed.runs[0].outcome, 'INCONCLUSIVE');
  } finally {
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('shrink reset timeout before reduction returns INCONCLUSIVE without inventing an original', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-reset-'));
  const workbench = createWorkbenchServer({ outputRoot: path.join(directory, 'artifacts') });
  const reset = synchronizeFixtureReset();
  let pending;
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    pending = postJson(base, '/api/runs', { scenario: 'cart-noisy', mode: 'shrink', requestTimeoutMs: 100 });
    const signal = await within(reset.reached, 'initial real reset response');
    if (!signal.aborted) await within(once(signal, 'abort'), 'reset request timeout');
    reset.release();
    const response = await pending;
    assert.equal(response.status, 201);
    const model = await response.json();
    assert.equal(model.outcome, 'INCONCLUSIVE');
    assert.equal(model.reason.code, 'REQUEST_TIMEOUT');
    assert.equal(model.reduction, null);
    assert.equal(model.counts.attemptsUsed, null);
    assert.equal(model.counts.actualReplays, null);
    assert.equal(model.scenarios.original, null);
    assert.equal(model.artifacts.originalScenario, null);
    assert.deepEqual(await (await fetch(`${base}/api/runs/${model.runId}`)).json(), model);
  } finally {
    reset.restore();
    await pending?.catch(() => {});
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('shutdown rejects new jobs and run/replay bodies completed after cancellation with 503', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-shutdown-'));
  const outputRoot = path.join(directory, 'artifacts');
  const workbench = createWorkbenchServer({ outputRoot });
  let reset;
  let active;
  let shutdown;
  let partialRun;
  let partialReplay;
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    const seedResponse = await postJson(base, '/api/runs', { scenario: 'cart-total' });
    assert.equal(seedResponse.status, 201);
    const seed = await seedResponse.json();
    const replayPath = `/api/runs/${seed.runId}/replay`;
    reset = synchronizeFixtureReset();
    active = postJson(base, '/api/runs', { scenario: 'cart-total', requestTimeoutMs: 10_000 });
    const signal = await within(reset.reached, 'active reset before shutdown');
    partialRun = partialJsonPost(workbench, base, '/api/runs', { scenario: 'cart-total-pass' });
    await within(partialRun.received, 'partial run body reaching the server');
    partialReplay = partialJsonPost(workbench, base, replayPath, {});
    await within(partialReplay.received, 'partial replay body reaching the server');

    shutdown = workbench.close();
    assert.equal(signal.aborted, true);
    const newRun = await postJson(base, '/api/runs', { scenario: 'cart-total-pass' });
    const newReplay = await postJson(base, replayPath, {});
    const newRunError = await newRun.json();
    const newReplayError = await newReplay.json();
    reset.release();
    const cancelledResponse = await active;
    assert.equal(cancelledResponse.status, 201);
    assert.equal((await cancelledResponse.json()).reason.code, 'RUN_CANCELLED');

    // These headers and first bytes arrived before close(), but their bodies finish later.
    partialRun.finish();
    partialReplay.finish();
    const lateRun = await within(partialRun.result, 'late run rejection');
    const lateReplay = await within(partialReplay.result, 'late replay rejection');
    await within(shutdown, 'workbench shutdown');
    assert.equal(newRun.status, 503);
    assert.equal(newReplay.status, 503);
    assert.equal(lateRun.status, 503);
    assert.equal(lateReplay.status, 503);
    for (const error of [newRunError, newReplayError, lateRun.body, lateReplay.body]) {
      assert.match(error.error, /closing/);
    }
    assert.equal((await readdir(outputRoot)).length, 2);
    await assert.rejects(readdir(path.join(outputRoot, seed.runId, 'replays')), { code: 'ENOENT' });
  } finally {
    reset?.restore();
    partialRun?.destroy();
    partialReplay?.destroy();
    await active?.catch(() => {});
    await shutdown;
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('cart-noisy API shrink exports a two-step replay and a later PASS run stays isolated', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-flow-'));
  const workbench = createWorkbenchServer({ outputRoot: path.join(directory, 'artifacts') });
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    const response = await postJson(base, '/api/runs', { scenario: 'cart-noisy', mode: 'shrink', maxAttempts: 100 });
    assert.equal(response.status, 201);
    const shrink = await response.json();
    assert.equal(shrink.outcome, 'REGRESSION');
    assert.deepEqual(shrink.mismatch, {
      stepId: 'add-item',
      pointer: '/items/0/lineTotal',
      classification: 'BUSINESS_DIFFERENCE',
    });
    assert.equal(shrink.counts.originalStepCount, 6);
    assert.equal(shrink.counts.minimizedStepCount, 2);
    assert.equal(shrink.reduction.minimalUnderOperations, true);
    assert.equal(shrink.reduction.attempts.some((attempt) => attempt.result === 'ACCEPTED'), true);
    assert.equal(shrink.reduction.attempts.some((attempt) => attempt.result === 'REJECTED'), true);
    assert.equal(shrink.counts.actualReplays, shrink.raw.reduction.actualReplays);
    assert.equal(shrink.counts.attemptsUsed, shrink.raw.reduction.attemptsUsed);
    const exportedResponse = await fetch(`${base}${shrink.artifacts.minimizedScenario}`);
    assert.equal(exportedResponse.status, 200);
    const exported = await exportedResponse.json();
    assert.deepEqual(exported.steps.map((step) => step.id), ['create-cart', 'add-item']);
    assert.deepEqual(exported, JSON.parse(shrink.copyPayloads.scenario));
    assert.deepEqual(exported, shrink.scenarios.minimized);
    assert.equal(shrink.replay.sha256, createHash('sha256').update(`${JSON.stringify(exported, null, 2)}\n`).digest('hex'));
    assert.equal(shrink.replay.sha256, shrink.raw.replay.sha256);
    const originalResponse = await fetch(`${base}${shrink.artifacts.originalScenario}`);
    assert.equal(originalResponse.status, 200);
    assert.deepEqual(await originalResponse.json(), await scenarioAt(NOISY_SCENARIO));
    assert.deepEqual(await (await fetch(`${base}${shrink.artifacts.evidence}`)).json(), shrink.raw);

    const replayResponse = await postJson(base, `/api/runs/${shrink.runId}/replay`, {});
    assert.equal(replayResponse.status, 201);
    const replay = await replayResponse.json();
    assert.equal(replay.outcome, 'REGRESSION');
    assert.deepEqual(replay.mismatch, shrink.mismatch);
    assert.deepEqual(replay.steps.map((step) => step.id), ['create-cart', 'add-item']);
    assert.deepEqual(replay.scenarios.minimized, exported);
    assert.equal(replay.reduction, null);
    assert.equal(replay.counts.actualReplays, null);
    assert.equal(replay.artifacts.originalScenario, null);
    const item = replay.steps[1];
    assert.equal(item.reference.response.body.items[0].lineTotal, exported.variables.quantity * exported.variables.unitPrice);
    assert.equal(item.candidate.response.body.items[0].lineTotal, exported.variables.unitPrice);
    assert.deepEqual(item.comparison.differences, shrink.steps[1].comparison.differences);
    const replayBase = replay.artifacts.evidence.replace(/\/evidence$/, '');
    assert.deepEqual(await (await fetch(`${base}${replayBase}`)).json(), replay);
    assert.deepEqual(await (await fetch(`${base}${replay.artifacts.minimizedScenario}`)).json(), exported);
    assert.deepEqual(await (await fetch(`${base}${replay.artifacts.evidence}`)).json(), replay.raw);

    const passResponse = await postJson(base, '/api/runs', { scenario: 'cart-total-pass' });
    assert.equal(passResponse.status, 201);
    const pass = await passResponse.json();
    assert.equal(pass.outcome, 'PASS');
    assert.notEqual(pass.runId, shrink.runId);
    assert.equal(pass.mismatch, null);
    assert.equal(pass.reduction, null);
    assert.equal(pass.counts.actualReplays, null);
    assert.equal(pass.counts.acceptedOperations, null);
    assert.equal(pass.scenarios.original, null);
    assert.equal(pass.artifacts.originalScenario, null);
    assert.equal(pass.services.candidate.fixture, 'candidate-fixed-cart');
    assert.equal(pass.steps[1].candidate.response.body.total, 20);
    assert.equal(pass.steps[1].comparison.differences.length, 0);
    assert.equal(pass.steps[1].comparison.ignoredDifferences.some((difference) => difference.pointer === '/cartId'), true);
    assert.deepEqual(await (await fetch(`${base}/api/runs/${shrink.runId}`)).json(), shrink);
    assert.deepEqual(await (await fetch(`${base}${replayBase}`)).json(), replay);
    const listed = await (await fetch(`${base}/api/runs`)).json();
    assert.deepEqual(new Set(listed.runs.map((run) => run.runId)), new Set([shrink.runId, pass.runId]));
  } finally {
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid API requests return bounded client errors without admitting jobs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-invalid-'));
  const outputRoot = path.join(directory, 'artifacts');
  const workbench = createWorkbenchServer({ outputRoot });
  try {
    const address = await workbench.listen({ port: 0 });
    const base = address.url.replace(/\/$/, '');
    for (const [body, status, message] of [
      ['{bad json', 400, /not valid JSON/],
      ['null', 400, /JSON object/],
      ['[]', 400, /JSON object/],
      ['{}', 400, /checked-in scenarios/],
      [JSON.stringify({ scenario: '../../etc/passwd' }), 400, /checked-in scenarios/],
      [JSON.stringify({ scenario: 'http://example.invalid' }), 400, /checked-in scenarios/],
      [JSON.stringify({ scenario: 'cart-total', mode: 'unknown' }), 400, /mode must be/],
      [JSON.stringify({ scenario: 'cart-total', startupTimeoutMs: 0 }), 400, /startupTimeoutMs/],
      [JSON.stringify({ scenario: 'cart-total', requestTimeoutMs: 60_001 }), 400, /requestTimeoutMs/],
      [JSON.stringify({ scenario: 'cart-total', maxAttempts: 2 }), 400, /only valid in shrink/],
      [JSON.stringify({ scenario: 'cart-total', mode: 'shrink', maxAttempts: 1.5 }), 400, /maxAttempts/],
      [JSON.stringify({ scenario: 'cart-total', mode: 'shrink', maxAttempts: 10_001 }), 400, /maxAttempts/],
      [JSON.stringify({ scenario: 'cart-total', padding: 'x'.repeat(40_000) }), 413, /too large/],
    ]) {
      const response = await fetch(`${base}/api/runs`, { method: 'POST', body });
      assert.equal(response.status, status, body.slice(0, 100));
      assert.match(response.headers.get('content-type'), /application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match((await response.json()).error, message);
    }
    const streamed = await fetch(`${base}/api/runs`, {
      method: 'POST',
      duplex: 'half',
      body: (async function* () {
        yield '{"padding":"';
        yield 'x'.repeat(40_000);
        yield '"}';
      })(),
    });
    assert.equal(streamed.status, 413);
    assert.match((await streamed.json()).error, /too large/);
    for (const [pathname, method, body, status, message] of [
      ['/api/runs/bad', 'GET', undefined, 400, /invalid run identifier/],
      ['/api/runs/run-missing-test', 'GET', undefined, 404, /evidence was not found/],
      ['/api/runs/run-missing-test/replay', 'POST', '{}', 404, /minimized scenario was not found/],
      ['/api/runs/run-missing-test/replay', 'POST', '{', 400, /not valid JSON/],
      ['/api/runs/run-missing-test/replays/bad', 'GET', undefined, 400, /invalid replay identifier/],
      ['/api/unknown', 'GET', undefined, 404, /not found/],
      ['/api/runs', 'DELETE', undefined, 404, /not found/],
    ]) {
      const response = await fetch(`${base}${pathname}`, { method, body });
      assert.equal(response.status, status, `${method} ${pathname}`);
      assert.match((await response.json()).error, message);
    }
    assert.deepEqual(await (await fetch(`${base}/api/runs`)).json(), { runs: [] });
    assert.deepEqual(await readdir(outputRoot), []);
  } finally {
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('normal workbench runs do not expose shrink-only original scenarios', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'behaviordiff-workbench-original-'));
  const outputRoot = path.join(directory, 'artifacts');
  const workbench = createWorkbenchServer({ outputRoot });
  try {
    const address = await workbench.listen({ port: 0 });
    const response = await fetch(`${address.url.replace(/\/$/, '')}/api/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenario: 'cart-total', mode: 'run' }),
    });
    const model = await response.json();
    const original = await fetch(`${address.url.replace(/\/$/, '')}/api/runs/${model.runId}/original-scenario`);
    assert.equal(original.status, 404);
  } finally {
    await workbench.close();
    await rm(directory, { recursive: true, force: true });
  }
});
