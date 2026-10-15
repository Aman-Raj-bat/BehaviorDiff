const OUTCOMES = new Set(['REGRESSION', 'PASS', 'INCONCLUSIVE']);

export class WorkbenchEvidenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkbenchEvidenceError';
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isInteger(value) {
  return Number.isInteger(value);
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalBoolean(value) {
  return typeof value === 'boolean' ? value : null;
}

