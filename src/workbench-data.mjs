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

function optionalNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

export function parseEvidence(raw, label = 'evidence') {
  let evidence;
  try {
    evidence = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new WorkbenchEvidenceError(`${label} is not valid JSON: ${error.message}`);
  }
  if (!isRecord(evidence)) throw new WorkbenchEvidenceError(`${label} must be a JSON object`);
  if (!OUTCOMES.has(evidence.outcome)) {
    throw new WorkbenchEvidenceError(`${label}.outcome must be REGRESSION, PASS, or INCONCLUSIVE`);
  }
  if (evidence.steps !== undefined && !Array.isArray(evidence.steps)) {
    throw new WorkbenchEvidenceError(`${label}.steps must be an array when present`);
  }
  for (const [index, step] of (evidence.steps ?? []).entries()) {
    if (!isRecord(step)) throw new WorkbenchEvidenceError(`${label}.steps[${index}] must be an object`);
    if (step.comparison !== undefined && !isRecord(step.comparison)) {
      throw new WorkbenchEvidenceError(`${label}.steps[${index}].comparison must be an object when present`);
    }
    for (const field of ['differences', 'ignoredDifferences']) {
      if (step.comparison?.[field] !== undefined && !Array.isArray(step.comparison[field])) {
        throw new WorkbenchEvidenceError(`${label}.steps[${index}].comparison.${field} must be an array when present`);
      }
      for (const [differenceIndex, difference] of (step.comparison?.[field] ?? []).entries()) {
        if (!isRecord(difference) || typeof difference.pointer !== 'string') {
          throw new WorkbenchEvidenceError(`${label}.steps[${index}].comparison.${field}[${differenceIndex}] must contain a pointer`);
        }
      }
    }
    if (step.comparison?.ignoredPaths !== undefined && !Array.isArray(step.comparison.ignoredPaths)) {
      throw new WorkbenchEvidenceError(`${label}.steps[${index}].comparison.ignoredPaths must be an array when present`);
    }

  return {};
}
