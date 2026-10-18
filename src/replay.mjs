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
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(typeof error.rawBody === 'string' ? {
      rawBody: error.rawBody.slice(0, MAX_DIAGNOSTIC_BYTES),
      rawBodyTruncated: error.rawBodyTruncated === true || error.rawBody.length > MAX_DIAGNOSTIC_BYTES,
    } : {}),
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
          regression = side === 'candidate';
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
      // Incomplete paired evidence supersedes any mismatch observed earlier.
      regression = false;
      if (referenceError && isReferenceBlocking(referenceError)) {
        reason = {
          ...errorRecord(referenceError, diagnosticRecord(services, 'reference')),
          code: referenceError.code === 'NON_JSON_RESPONSE' ? 'REFERENCE_NON_JSON' : referenceError.code,
          side: 'reference',
          stepId: step.id,
        };
      } else if (candidateError && (candidateError.code === 'REQUEST_TIMEOUT' || candidateError.code === 'TRANSPORT_ERROR')) {
        reason = {
          ...errorRecord(candidateError, diagnosticRecord(services, 'candidate')),
          code: candidateError.code,
          side: 'candidate',
          stepId: step.id,
        };
      } else if (candidateError?.code === 'NON_JSON_RESPONSE') {
        reason = {
          ...errorRecord(candidateError, diagnosticRecord(services, 'candidate')),
          code: 'CANDIDATE_NON_JSON',
          side: 'candidate',
          stepId: step.id,
        };
        regression = true;
      } else if (referenceError) {
        reason = {
          ...errorRecord(referenceError, diagnosticRecord(services, 'reference')),
          code: 'REFERENCE_REPLAY_ERROR',
          side: 'reference',
          stepId: step.id,
        };
      } else {
        reason = {
          ...errorRecord(candidateError, diagnosticRecord(services, 'candidate')),
          code: 'CANDIDATE_REPLAY_ERROR',
          side: 'candidate',
          stepId: step.id,
        };
        regression = true;
      }
      steps.push(entry);
      break;
    }

    const referenceResponse = sideData.reference.result?.response;
    const candidateResponse = sideData.candidate.result?.response;
    if (referenceResponse && candidateResponse) {
      entry.expectation = {
        reference: referenceResponse.status === step.expect.status,
        candidate: candidateResponse.status === step.expect.status,
      };
      const bodyComparison = compareJson(referenceResponse.body, candidateResponse.body, entry.ignorePaths);
      const differences = [
        ...statusDifference(referenceResponse, candidateResponse),
        ...bodyComparison.differences,
      ];
      entry.comparison = {
        equal: differences.length === 0,
        differences,
        ignoredPaths: entry.ignorePaths,
        ignoredDifferences: bodyComparison.ignoredDifferences,
      };
      if (referenceResponse.status !== step.expect.status) {
        regression = false;
        reason = {
          code: 'REFERENCE_UNEXPECTED_STATUS',
          side: 'reference',
          stepId: step.id,
          expected: step.expect.status,
          actual: referenceResponse.status,
        };
        steps.push(entry);
        break;
      }
      if (candidateResponse.status !== step.expect.status) {
        reason = {
          code: 'CANDIDATE_UNEXPECTED_STATUS',
          side: 'candidate',
          stepId: step.id,
          expected: step.expect.status,
          actual: candidateResponse.status,
        };
        regression = true;
        steps.push(entry);
        break;
      }
      if (differences.length > 0) regression = true;
    }

    if (sideData.reference.captureError) {
      regression = false;
      reason = {
        code: 'REFERENCE_CAPTURE_MISSING',
        side: 'reference',
        stepId: step.id,
        pointer: sideData.reference.captureError.pointer,
      };
      steps.push(entry);
      break;
    }
    if (sideData.candidate.captureError) {
      reason = {
        code: 'CANDIDATE_CAPTURE_MISSING',
        side: 'candidate',
        stepId: step.id,
        pointer: sideData.candidate.captureError.pointer,
      };
      regression = true;
      steps.push(entry);
      break;
    }

    steps.push(entry);
  }

  // Candidate protocol/status exits must not mask an invalid reference capture
  // recorded on that same paired step. Keep both sides' actual observations.
  const lastStep = steps.at(-1);
  if (lastStep?.reference.captureError && reason?.side !== 'reference') {
    regression = false;
    reason = {
      code: 'REFERENCE_CAPTURE_MISSING',
      side: 'reference',
      stepId: lastStep.id,
      pointer: lastStep.reference.captureError.pointer,
    };
  }
  return { steps, reason, regression };
}
