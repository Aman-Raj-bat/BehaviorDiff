import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { test } from 'node:test';
import { compareJson } from '../src/compare-json.mjs';
import { spawnFixture } from '../src/fixture-process.mjs';
import { replayPair } from '../src/replay.mjs';
import { requestJson } from '../src/http-json.mjs';
import { captureValues, validateScenario } from '../src/scenario.mjs';
import { shrinkScenario, summarizeReplay } from '../src/shrink.mjs';

function step(id, extra = {}) {
  return { id, request: { method: 'GET', path: `/${id}` }, expect: { status: 200 }, ...extra };
}

function scenario(steps) {
  return validateScenario({
    version: 1,
    name: 'core reliability',
    services: { reference: 'old-cart', candidate: 'candidate-cart' },
    variables: {},
    steps,
  });
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function localPair(t, handler) {
  const services = {};
  const requests = { reference: [], candidate: [] };
  for (const side of ['reference', 'candidate']) {
    const server = http.createServer((request, response) => {
      requests[side].push(request.url);
      handler(side, request, response);
    });
    t.after(() => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    services[side] = { baseUrl: `http://127.0.0.1:${server.address().port}/` };
  }
  return { services, requests };
}

async function lateFailure(t, side, fail, extra = {}) {
  const pair = await localPair(t, (currentSide, request, response) => {
    if (request.url === '/mismatch') {
      return sendJson(response, { value: currentSide === 'reference' ? 1 : 2 });
    }
    if (currentSide === side) return fail(response);
    sendJson(response, { token: 'available' });
  });
  const replay = await replayPair({
    scenario: scenario([step('mismatch'), step('failure', extra), step('must-not-run')]),
    services: pair.services,
    requestTimeoutMs: 250,
  });
  assert.equal(replay.steps.length, 2);
  assert.deepEqual(replay.steps[0].comparison.differences, [
    { pointer: '/value', reference: 1, candidate: 2 },
  ]);
  assert.deepEqual(pair.requests, {
    reference: ['/mismatch', '/failure'],
    candidate: ['/mismatch', '/failure'],
  });
  return replay;
}

const blockingFailures = [
  {
    name: 'unexpected status', code: 'REFERENCE_UNEXPECTED_STATUS', sides: ['reference'],
    fail: (response) => sendJson(response, { token: 'available' }, 503),
  },
  {
    name: 'missing capture', code: 'REFERENCE_CAPTURE_MISSING', sides: ['reference'],
    fail: (response) => sendJson(response, {}),
    extra: { capture: { token: '/token' } },
  },
  {
    name: 'timeout before headers', code: 'REQUEST_TIMEOUT', sides: ['reference', 'candidate'],
    fail: () => {},
  },
  {
    name: 'timeout during body', code: 'REQUEST_TIMEOUT', sides: ['reference', 'candidate'],
    fail: (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write('{"partial":');
    },
  },
  {
    name: 'connection failure', code: 'TRANSPORT_ERROR', sides: ['reference', 'candidate'],
    fail: (response) => response.destroy(),
  },
  {
    name: 'incomplete response body', code: 'TRANSPORT_ERROR', sides: ['reference', 'candidate'],
    fail: (response) => {
      response.writeHead(200, { 'content-type': 'application/json', 'content-length': '1000' });
      response.write('{"partial":');
      setImmediate(() => response.destroy());
    },
  },
];

for (const failure of blockingFailures) {
  for (const side of failure.sides) {
    test(`late ${side} ${failure.name} clears regression and retains paired observations`, async (t) => {
      const replay = await lateFailure(t, side, failure.fail, failure.extra);
      assert.equal(replay.reason.code, failure.code);
      assert.equal(replay.reason.side, side);
      assert.equal(replay.reason.stepId, 'failure');
      assert.equal(replay.regression, false);
      assert.equal(summarizeReplay(replay).outcome, 'INCONCLUSIVE');
      const failed = replay.steps[1][side];
      const otherSide = side === 'reference' ? 'candidate' : 'reference';
      assert.equal(replay.steps[1][otherSide].response.status, 200);
      if (failure.code === 'REQUEST_TIMEOUT') {
        assert.equal(failed.error.timeoutMs, 250);
        assert.equal(replay.reason.timeoutMs, 250);
      } else if (failure.code === 'TRANSPORT_ERROR') {
        assert.equal(failed.error.code, 'TRANSPORT_ERROR');
      } else {
        assert.ok(replay.steps[1].comparison);
        if (failure.extra) assert.deepEqual(failed.captureError, { name: 'token', pointer: '/token' });
        else assert.equal(failed.response.status, 503);
      }
    });
  }
}

test('a reference capture failure on the first differing step is inconclusive', async (t) => {
  const { services } = await localPair(t, (side, _request, response) => {
    sendJson(response, side === 'reference' ? { value: 1 } : { value: 2, token: 'candidate' });
  });
  const replay = await replayPair({
    scenario: scenario([step('capture', { capture: { token: '/token' } })]),
    services,
    requestTimeoutMs: 1000,
  });
  assert.equal(replay.regression, false);
  assert.equal(summarizeReplay(replay).outcome, 'INCONCLUSIVE');
  assert.deepEqual(replay.reason, {
    code: 'REFERENCE_CAPTURE_MISSING', side: 'reference', stepId: 'capture', pointer: '/token',
  });
  assert.deepEqual(replay.steps[0].comparison.differences, [
    { pointer: '/token', reference: { $missing: true }, candidate: 'candidate' },
    { pointer: '/value', reference: 1, candidate: 2 },
  ]);
  assert.deepEqual(replay.steps[0].candidate.captures, { token: 'candidate' });
});

for (const candidateFailure of ['unexpected status', 'malformed JSON']) {
  test(`a missing reference capture outranks candidate ${candidateFailure}`, async (t) => {
    const { services } = await localPair(t, (side, _request, response) => {
      if (side === 'reference') return sendJson(response, { value: 1 });
      if (candidateFailure === 'unexpected status') return sendJson(response, { token: 'candidate' }, 409);
      response.writeHead(200);
      response.end('{broken');
    });
    const replay = await replayPair({
      scenario: scenario([step('capture', { capture: { token: '/token' } })]),
      services,
      requestTimeoutMs: 1000,
    });
    assert.equal(replay.regression, false);
    assert.equal(summarizeReplay(replay).outcome, 'INCONCLUSIVE');
    assert.equal(replay.reason.code, 'REFERENCE_CAPTURE_MISSING');
    assert.equal(replay.reason.side, 'reference');
    assert.equal(replay.reason.pointer, '/token');
    assert.equal(replay.steps[0].reference.captureError.pointer, '/token');
  });
}

test('late candidate capture failures preserve regression semantics', async (t) => {
  const replay = await lateFailure(t, 'candidate', (response) => sendJson(response, {}), {
    capture: { token: '/token' },
  });
  assert.equal(replay.regression, true);
  assert.equal(summarizeReplay(replay).outcome, 'REGRESSION');
  assert.deepEqual(replay.reason, {
    code: 'CANDIDATE_CAPTURE_MISSING', side: 'candidate', stepId: 'failure', pointer: '/token',
  });
  assert.deepEqual(replay.steps[1].reference.captures, { token: 'available' });
  assert.deepEqual(replay.steps[1].candidate.captureError, { name: 'token', pointer: '/token' });
});

for (const side of ['reference', 'candidate']) {
  test(`late ${side} request resolution failure preserves side-specific capture semantics`, async (t) => {
    const pair = await localPair(t, (currentSide, request, response) => {
      sendJson(response, request.url === '/capture'
        ? { token: currentSide === side ? { notScalar: true } : 'available' }
        : { reached: true });
    });
    const replay = await replayPair({
      scenario: scenario([
        step('capture', { capture: { token: '/token' } }),
        step('resolve', { request: { method: 'GET', path: '/use/{{token}}' } }),
        step('must-not-run'),
      ]),
      services: pair.services,
      requestTimeoutMs: 1000,
    });
    assert.equal(replay.steps.length, 2);
    assert.equal(replay.steps[0].comparison.equal, false);
    assert.equal(replay.reason.code, `${side.toUpperCase()}_CAPTURE_MISSING`);
    assert.equal(replay.reason.side, side);
    assert.equal(replay.reason.stepId, 'resolve');
    assert.equal(replay.regression, side === 'candidate');
    assert.equal(summarizeReplay(replay).outcome, side === 'candidate' ? 'REGRESSION' : 'INCONCLUSIVE');
    assert.match(replay.steps[1][side].error.message, /must be scalar/);
    const otherSide = side === 'reference' ? 'candidate' : 'reference';
    assert.deepEqual(pair.requests[side], ['/capture']);
    assert.deepEqual(pair.requests[otherSide], ['/capture', '/use/available']);
    assert.deepEqual(replay.steps[1][otherSide].response.body, { reached: true });
  });
}

for (const side of ['reference', 'candidate']) {
  for (const rawBody of ['{"broken":', 'x'.repeat(5000)]) {
    test(`${side} malformed JSON retains its reason and ${rawBody.length > 4096 ? 'truncated' : 'complete'} diagnostics`, async (t) => {
      const replay = await lateFailure(t, side, (response) => {
        response.writeHead(502, { 'content-type': 'application/json' });
        response.end(rawBody);
      });
      assert.equal(replay.reason.code, `${side.toUpperCase()}_NON_JSON`);
      assert.equal(replay.reason.side, side);
      assert.equal(replay.reason.stepId, 'failure');
      assert.equal(replay.regression, side === 'candidate');
      assert.equal(summarizeReplay(replay).outcome, side === 'candidate' ? 'REGRESSION' : 'INCONCLUSIVE');
      const error = replay.steps[1][side].error;
      assert.equal(error.code, 'NON_JSON_RESPONSE');
      for (const record of [error, replay.reason]) {
        assert.equal(record.status, 502);
        assert.equal(record.rawBody, rawBody.slice(0, 4096));
        assert.equal(record.rawBodyTruncated, rawBody.length > 4096);
        assert.equal(Object.hasOwn(record, 'cause'), false);
      }
    });
  }
}

test('reference malformed JSON takes precedence when both sides are malformed', async (t) => {
  const { services } = await localPair(t, (_side, _request, response) => {
    response.writeHead(500);
    response.end('not JSON');
  });
  services.reference.pid = process.pid;
  services.reference.stderr = 'diagnostic'.repeat(1000);
  const replay = await replayPair({ scenario: scenario([step('malformed')]), services, requestTimeoutMs: 1000 });
  assert.equal(replay.regression, false);
  assert.equal(replay.reason.code, 'REFERENCE_NON_JSON');
  assert.equal(summarizeReplay(replay).outcome, 'INCONCLUSIVE');
  for (const side of ['reference', 'candidate']) {
    assert.equal(replay.steps[0][side].error.code, 'NON_JSON_RESPONSE');
    assert.equal(replay.steps[0][side].error.rawBody, 'not JSON');
  }
  assert.equal(replay.reason.diagnostics.pid, process.pid);
  assert.equal(replay.reason.diagnostics.stderr, services.reference.stderr.slice(0, 4096));
  assert.equal(replay.reason.diagnostics.stderrTruncated, true);
  assert.deepEqual(replay.steps[0].reference.error.diagnostics, replay.reason.diagnostics);
});

test('candidate unexpected status remains a regression with a status mismatch signature', async (t) => {
  const { services } = await localPair(t, (side, _request, response) => {
    sendJson(response, { stable: true }, side === 'reference' ? 200 : 409);
  });
  const replay = await replayPair({
    scenario: scenario([step('status'), step('must-not-run')]), services, requestTimeoutMs: 1000,
  });
  assert.equal(replay.steps.length, 1);
  assert.equal(replay.regression, true);
  assert.deepEqual(replay.reason, {
    code: 'CANDIDATE_UNEXPECTED_STATUS', side: 'candidate', stepId: 'status', expected: 200, actual: 409,
  });
  assert.deepEqual(replay.steps[0].expectation, { reference: true, candidate: false });
  assert.deepEqual(replay.steps[0].comparison.differences, [
    { pointer: '$status', reference: 200, candidate: 409 },
  ]);
  const summary = summarizeReplay(replay);
  assert.equal(summary.outcome, 'REGRESSION');
  assert.deepEqual(summary.signature, { stepId: 'status', pointer: '$status', classification: 'STATUS_DIFFERENCE' });
});

test('late candidate unexpected status preserves the earlier business observations', async (t) => {
  const replay = await lateFailure(t, 'candidate', (response) => sendJson(response, { token: 'available' }, 409));
  assert.equal(replay.regression, true);
  assert.equal(replay.reason.code, 'CANDIDATE_UNEXPECTED_STATUS');
  assert.deepEqual(replay.steps[1].comparison.differences, [
    { pointer: '$status', reference: 200, candidate: 409 },
  ]);
  assert.deepEqual(summarizeReplay(replay).signature, {
    stepId: 'mismatch', pointer: '/value', classification: 'BUSINESS_DIFFERENCE',
  });
});

test('status shrinking executes every reduction and cannot substitute a broken setup failure', async (t) => {
  const ready = { reference: false, candidate: false };
  const { services, requests } = await localPair(t, (side, request, response) => {
    if (request.url === '/reset') {
      ready[side] = false;
      return sendJson(response, { ok: true });
    }
    if (request.url === '/setup') {
      ready[side] = true;
      return sendJson(response, { ok: true });
    }
    if (request.url === '/target') {
      return sendJson(response, { ok: ready[side] }, ready[side] ? (side === 'reference' ? 200 : 409) : 404);
    }
    sendJson(response, { ok: true });
  });
  const input = scenario([step('noise'), step('setup'), step('target')]);
  let executed = 0;
  const evaluate = async (candidate) => {
    await Promise.all(Object.values(services).map((service) => requestJson({
      baseUrl: service.baseUrl, request: { method: 'POST', path: '/reset', body: {} }, timeoutMs: 1000,
    })));
    executed += 1;
    return {
      replayed: true, reset: { reference: true, candidate: true },
      execution: summarizeReplay(await replayPair({ scenario: candidate, services, requestTimeoutMs: 1000 })),
    };
  };
  const baseline = (await evaluate(input)).execution;
  const reduction = await shrinkScenario({ scenario: input, baseline, maxAttempts: 30, evaluate });
  const target = { stepId: 'target', pointer: '$status', classification: 'STATUS_DIFFERENCE' };
  assert.equal(reduction.status, 'COMPLETED');
  assert.equal(reduction.minimalUnderOperations, true);
  assert.deepEqual(reduction.scenario.steps.map((entry) => entry.id), ['setup', 'target']);
  assert.deepEqual(reduction.finalMismatchSignature, target);
  assert.equal(reduction.actualReplays, executed);
  assert.equal(requests.reference.filter((url) => url === '/reset').length, executed);
  assert.equal(requests.candidate.filter((url) => url === '/reset').length, executed);
  const brokenSetup = reduction.attempts.find((attempt) => attempt.removedStepId === 'setup');
  assert.equal(brokenSetup.result, 'REJECTED');
  assert.equal(brokenSetup.replayed, true);
  assert.equal(brokenSetup.execution.outcome, 'INCONCLUSIVE');
  assert.equal(brokenSetup.execution.reason.code, 'REFERENCE_UNEXPECTED_STATUS');
  for (const attempt of reduction.attempts.filter((entry) => entry.result === 'ACCEPTED')) {
    assert.equal(attempt.replayed, true);
    assert.deepEqual(attempt.execution.signature, target);
  }
  const independent = await evaluate(reduction.scenario);
  assert.equal(independent.execution.outcome, 'REGRESSION');
  assert.deepEqual(independent.execution.signature, target);
});

for (const value of ['captured-token', { marker: 'own data' }, null]) {
  test(`__proto__ capture safely retains ${value === null ? 'null' : typeof value} values and replays them`, async (t) => {
    const captureStep = step('capture', {
      capture: Object.fromEntries(['__proto__', 'constructor', 'toString'].map((name) => [name, '/token'])),
    });
    const variables = { stable: true };
    const captured = captureValues(captureStep, { token: value }, variables);
    for (const record of [variables, captured.captures]) {
      assert.equal(Object.getPrototypeOf(record), Object.prototype);
      for (const name of ['__proto__', 'constructor', 'toString']) {
        assert.equal(Object.hasOwn(record, name), true);
        assert.deepEqual(Object.getOwnPropertyDescriptor(record, name), {
          value, writable: true, enumerable: true, configurable: true,
        });
      }
    }
    const { services } = await localPair(t, (_side, request, response) => {
      if (request.url === '/capture') return sendJson(response, { token: value });
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk) => { body += chunk; });
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(body);
      });
    });
    const replay = await replayPair({
      scenario: scenario([
        captureStep,
        step('echo', { request: { method: 'POST', path: '/echo', body: { $var: '__proto__' } } }),
      ]),
      services,
      requestTimeoutMs: 1000,
    });
    assert.equal(summarizeReplay(replay).outcome, 'PASS');
    assert.equal(replay.steps.length, 2);
    for (const side of ['reference', 'candidate']) {
      assert.equal(Object.hasOwn(replay.steps[0][side].captures, '__proto__'), true);
      assert.deepEqual(JSON.parse(JSON.stringify(replay.steps[0][side].captures)).__proto__, value);
      assert.deepEqual(replay.steps[1][side].request.body, value);
      assert.deepEqual(replay.steps[1][side].response.body, value);
    }
  });
}

test('comparator equality is semantic and differences retain exact JSON values', () => {
  for (const [reference, candidate] of [
    [null, null], [false, false], [0, 0], ['', ''],
    [[1, { nested: [true, null] }], [1, { nested: [true, null] }]],
    [{ a: 1, b: { x: 2, y: 3 } }, { b: { y: 3, x: 2 }, a: 1 }],
  ]) {
    assert.deepEqual(compareJson(reference, candidate), { equal: true, differences: [], ignoredDifferences: [] });
  }
  for (const [reference, candidate] of [[null, false], [1, '1'], [false, 0], ['', null], [[], {}]]) {
    assert.deepEqual(compareJson(reference, candidate), {
      equal: false, differences: [{ pointer: '', reference, candidate }], ignoredDifferences: [],
    });
  }
  assert.deepEqual(compareJson({ value: null }, {}).differences, [
    { pointer: '/value', reference: null, candidate: { $missing: true } },
  ]);
  assert.deepEqual(compareJson([1, 2], [2, 1]).differences, [
    { pointer: '/0', reference: 1, candidate: 2 },
    { pointer: '/1', reference: 2, candidate: 1 },
  ]);
});

test('nested ignores stay within exact subtrees and array elements', () => {
  const result = compareJson(
    { meta: { volatile: { id: 'old' }, stable: 1 }, metadata: 1, items: [{ meta: { id: 'old' }, price: 10 }, 2] },
    { meta: { volatile: { id: 'new' }, stable: 2 }, metadata: 2, items: [{ meta: { id: 'new' }, price: 20 }, 2, 3] },
    ['/meta/volatile', '/items/0/meta'],
  );
  assert.equal(result.equal, false);
  assert.deepEqual(result.differences, [
    { pointer: '/items/0/price', reference: 10, candidate: 20 },
    { pointer: '/items/2', reference: { $missing: true }, candidate: 3 },
    { pointer: '/meta/stable', reference: 1, candidate: 2 },
    { pointer: '/metadata', reference: 1, candidate: 2 },
  ]);
  assert.deepEqual(result.ignoredDifferences, [
    { pointer: '/items/0/meta/id', reference: 'old', candidate: 'new' },
    { pointer: '/meta/volatile/id', reference: 'old', candidate: 'new' },
  ]);
  assert.deepEqual(compareJson({ meta: { stable: true } }, { meta: { stable: true } }, ['/meta']).ignoredDifferences, []);
});

test('escaped pointer ignores distinguish literal slashes, tildes, and empty keys', () => {
  const result = compareJson(
    { 'a/b': { '~key': { value: 1 } }, a: { b: 1 }, '~1': 1, '/': 1, '': { '': 1 } },
    { 'a/b': { '~key': { value: 2 } }, a: { b: 2 }, '~1': 2, '/': 2, '': { '': 2 } },
    ['/a~1b/~0key', '/~01', '//'],
  );
  assert.deepEqual(result.differences, [
    { pointer: '/~1', reference: 1, candidate: 2 },
    { pointer: '/a/b', reference: 1, candidate: 2 },
  ]);
  assert.deepEqual(result.ignoredDifferences, [
    { pointer: '//', reference: 1, candidate: 2 },
    { pointer: '/a~1b/~0key/value', reference: 1, candidate: 2 },
    { pointer: '/~01', reference: 1, candidate: 2 },
  ]);
});

test('capture pointers enforce array indices, own properties, and single-pass escapes', () => {
  const body = { 'a/b': { '~key': [null, false, 'last'] }, '~1': 'literal tilde-one', '': { '': 0 } };
  for (const [pointer, value] of [
    ['/a~1b/~0key/0', null], ['/a~1b/~0key/1', false], ['/a~1b/~0key/2', 'last'],
    ['/~01', 'literal tilde-one'], ['//', 0],
  ]) {
    const variables = {};
    assert.deepEqual(captureValues({ capture: { value: pointer } }, body, variables), { captures: { value } });
    assert.deepEqual(variables, { value });
  }
  for (const pointer of [
    '/a~1b/~0key/00', '/a~1b/~0key/01', '/a~1b/~0key/-', '/a~1b/~0key/-1',
    '/a~1b/~0key/3', '/a~1b/~0key/length', '/a~1b/~0key/1e0', '/toString', '/__proto__', '/a/b', '/~1',
  ]) {
    const variables = {};
    assert.deepEqual(captureValues({ capture: { value: pointer } }, body, variables), { error: { name: 'value', pointer } });
    assert.deepEqual(variables, {});
  }
  for (const pointer of ['', '/bad~', '/bad~2']) {
    assert.throws(() => scenario([step('invalid', { capture: { value: pointer } })]), /JSON Pointer/);
    assert.throws(() => compareJson({}, {}, [pointer]), /JSON Pointer/);
  }
});

for (const kind of ['reference status', 'reference capture', 'candidate timeout', 'candidate crash']) {
  test(`existing cart fixtures: late ${kind} is inconclusive after the real total mismatch`, async (t) => {
    const input = JSON.parse(await readFile(new URL('../scenarios/cart-total.json', import.meta.url), 'utf8'));
    const options = {};
    if (kind === 'reference status') input.steps[2].expect.status = 201;
    if (kind === 'reference capture') input.steps[2].capture = { missing: '/notPresent' };
    if (kind === 'candidate timeout') {
      options.responseDelayMs = 1000;
      options.responseDelayStep = 'read-cart';
    }
    if (kind === 'candidate crash') {
      options.crashOnQuantity = 1;
      const addItem = structuredClone(input.steps[1]);
      addItem.id = 'late-crash';
      addItem.request.body.quantity = 1;
      input.steps[2] = addItem;
    }
    validateScenario(input);
    const services = {};
    for (const side of ['reference', 'candidate']) {
      services[side] = spawnFixture(input.services[side], side === 'candidate' ? options : {});
      t.after(() => services[side].stop());
    }
    await Promise.all(Object.values(services).map((service) => service.start(2000)));
    await Promise.all(Object.values(services).map((service) => service.reset(1000)));
    const replay = await replayPair({ scenario: input, services, requestTimeoutMs: 250 });
    assert.equal(replay.steps.length, 3);
    assert.deepEqual(replay.steps[1].comparison.differences[0], {
      pointer: '/items/0/lineTotal', reference: 20, candidate: 10,
    });
    assert.equal(replay.regression, false);
    assert.equal(summarizeReplay(replay).outcome, 'INCONCLUSIVE');
    assert.equal(replay.reason.code, {
      'reference status': 'REFERENCE_UNEXPECTED_STATUS',
      'reference capture': 'REFERENCE_CAPTURE_MISSING',
      'candidate timeout': 'REQUEST_TIMEOUT',
      'candidate crash': 'TRANSPORT_ERROR',
    }[kind]);
    assert.equal(replay.reason.side, kind.startsWith('reference') ? 'reference' : 'candidate');
    assert.equal(replay.reason.stepId, input.steps[2].id);
    assert.equal(replay.steps[2].reference.response.status, 200);
    if (kind.startsWith('reference')) assert.equal(replay.steps[2].candidate.response.status, 200);
    if (kind === 'candidate crash') {
      assert.equal(replay.steps[2].candidate.error.diagnostics.pid, services.candidate.pid);
      assert.equal(replay.steps[2].candidate.error.diagnostics.exitCode, 1);
    }
  });
}
