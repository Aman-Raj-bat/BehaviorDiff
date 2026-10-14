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

