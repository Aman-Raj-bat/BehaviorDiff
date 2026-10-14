import { compareJson } from './compare-json.mjs';
import { HttpJsonError, requestJson } from './http-json.mjs';
import { captureValues, resolveRequest, ScenarioConfigError } from './scenario.mjs';

const MAX_DIAGNOSTIC_BYTES = 4_096;

function diagnosticRecord(services, side) {
  const service = services?.[side];
  if (!service) return {};
  const stderr = typeof service.stderr === 'string' ? service.stderr : '';
  return {
    ...(Number.isInteger(service.pid) ? { pid: service.pid } : {}),
    ...(service.exitCode === null || service.exitCode === undefined ? {} : { exitCode: service.exitCode }),
    ...(service.signalCode ? { signal: service.signalCode } : {}),
    ...(stderr ? {
      stderr: stderr.slice(0, MAX_DIAGNOSTIC_BYTES),
      stderrTruncated: stderr.length > MAX_DIAGNOSTIC_BYTES,
    } : {}),
  };
}

function errorRecord(error, diagnostics = {}) {
  return {
    code: error.code ?? 'REPLAY_ERROR',
    message: error.message,
    ...(error.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
    ...(Object.keys(diagnostics).length === 0 ? {} : { diagnostics }),
  };
}

function responseRecord(response) {
  return {
    status: response.status,
    headers: response.headers,
    body: response.body,
    durationMs: response.durationMs,
  };
}

function sideRecord(request, response, error, captures, captureError, diagnostics) {
  return {
    ...(request === undefined ? {} : { request }),
    ...(response === undefined ? {} : { response: responseRecord(response) }),
    ...(error === undefined ? {} : { error: errorRecord(error, diagnostics) }),
    captures,
    ...(captureError === undefined ? {} : { captureError }),
  };
}

function isReferenceBlocking(error) {
  return error && (error.code === 'REQUEST_TIMEOUT' || error.code === 'TRANSPORT_ERROR' || error.code === 'NON_JSON_RESPONSE');
}

function statusDifference(reference, candidate) {
  if (reference.status === candidate.status) return [];
  return [{ pointer: '$status', reference: reference.status, candidate: candidate.status }];
}

export async function replayPair({ scenario, services, requestTimeoutMs, signal }) {
  const contexts = {
    reference: { ...scenario.variables },
    candidate: { ...scenario.variables },
  };
  const steps = [];
  let reason;
  let regression = false;

  for (const step of scenario.steps) {
    if (signal?.aborted) {
      const error = new Error('Run was cancelled');
      error.code = 'RUN_CANCELLED';
      throw error;
    }
    const entry = {
      id: step.id,
      expectedStatus: step.expect.status,
      requestTemplate: step.request,
      ignorePaths: step.ignorePaths ?? [],
    };
    const sideData = {};

    for (const side of ['reference', 'candidate']) {
      try {
        const request = resolveRequest(step, contexts[side]);
        sideData[side] = { request };
      } catch (error) {
        const wrapped = error instanceof ScenarioConfigError
          ? error
          : new ScenarioConfigError(error.message);
        sideData[side] = { error: wrapped };
        if (!reason) {
          reason = {
            code: side === 'candidate' ? 'CANDIDATE_CAPTURE_MISSING' : 'REFERENCE_CAPTURE_MISSING',
            side,
            stepId: step.id,
            message: wrapped.message,
          };
          regression ||= side === 'candidate';
        }
      }
    }

    const requests = {};
    for (const side of ['reference', 'candidate']) {
      if (sideData[side].request) requests[side] = requestJson({
        baseUrl: services[side].baseUrl,
        request: sideData[side].request,
        timeoutMs: requestTimeoutMs,
        signal,
      }).then(
        (response) => ({ response }),
        (error) => ({ error }),
      );
    }
    const settled = await Promise.all(Object.entries(requests).map(async ([side, promise]) => [side, await promise]));
    if (signal?.aborted) {
      const error = new Error('Run was cancelled');
      error.code = 'RUN_CANCELLED';
      throw error;
    }
    for (const [side, result] of settled) {
      if (result.error && typeof services?.[side]?.waitForExit === 'function') {
        await services[side].waitForExit();
      }
      sideData[side].result = result;
    }

    for (const side of ['reference', 'candidate']) {
      const data = sideData[side];
      if (data.result?.response) {
        const capture = captureValues(step, data.result.response.body, contexts[side]);
        data.captures = capture.captures ?? {};
        data.captureError = capture.error;
      } else {
        data.captures = {};
      }
    }

    entry.reference = sideRecord(
      sideData.reference.request,
      sideData.reference.result?.response,
      sideData.reference.result?.error ?? sideData.reference.error,
      sideData.reference.captures,
      sideData.reference.captureError,
      diagnosticRecord(services, 'reference'),
    );
    entry.candidate = sideRecord(
      sideData.candidate.request,
      sideData.candidate.result?.response,
      sideData.candidate.result?.error ?? sideData.candidate.error,
      sideData.candidate.captures,
      sideData.candidate.captureError,
      diagnosticRecord(services, 'candidate'),
    );

    if (sideData.reference.error || sideData.candidate.error) {
      steps.push(entry);
      break;
    }

    const referenceError = sideData.reference.result?.error;
    const candidateError = sideData.candidate.result?.error;
    if (referenceError || candidateError) {
      if (referenceError && isReferenceBlocking(referenceError)) {
        reason = {
          code: referenceError.code === 'NON_JSON_RESPONSE' ? 'REFERENCE_NON_JSON' : referenceError.code,
          side: 'reference',
          stepId: step.id,
          ...errorRecord(referenceError, diagnosticRecord(services, 'reference')),
        };
      } else if (candidateError && (candidateError.code === 'REQUEST_TIMEOUT' || candidateError.code === 'TRANSPORT_ERROR')) {
        reason = {
          code: candidateError.code,
          side: 'candidate',
          stepId: step.id,
          ...errorRecord(candidateError, diagnosticRecord(services, 'candidate')),
        };
      } else if (candidateError?.code === 'NON_JSON_RESPONSE') {
        reason = {
          code: 'CANDIDATE_NON_JSON',
          side: 'candidate',
          stepId: step.id,
          ...errorRecord(candidateError, diagnosticRecord(services, 'candidate')),
        };
        regression = true;

  return {};
}
