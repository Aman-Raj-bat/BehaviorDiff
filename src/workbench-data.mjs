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
  }
  if (evidence.reduction !== undefined && !isRecord(evidence.reduction)) {
    throw new WorkbenchEvidenceError(`${label}.reduction must be an object when present`);
  }
  return evidence;
}

function firstMismatch(evidence) {
  if (evidence.outcome !== 'REGRESSION') return null;
  for (const step of evidence.steps ?? []) {
    const difference = step?.comparison?.differences?.[0];
    if (!difference || typeof difference.pointer !== 'string' || typeof step.id !== 'string') continue;
    return {
      stepId: step.id,
      pointer: difference.pointer,
      classification: difference.pointer === '$status' ? 'STATUS_DIFFERENCE' : 'BUSINESS_DIFFERENCE',
    };
  }
  return null;
}

function scenarioStepCount(scenario) {
  return Array.isArray(scenario?.steps) ? scenario.steps.length : null;
}

function serviceView(service) {
  if (!isRecord(service)) return null;
  return {
    fixture: optionalString(service.fixture),
    ready: optionalBoolean(service.ready),
    reset: optionalBoolean(service.reset),
    pid: isInteger(service.pid) ? service.pid : null,
    baseUrl: optionalString(service.baseUrl),
  };
}

function attemptView(attempt) {
  if (!isRecord(attempt)) return null;
  return {
    attempt: isInteger(attempt.attempt) ? attempt.attempt : null,
    operation: optionalString(attempt.operation),
    location: optionalString(attempt.location),
    candidateStepCount: isInteger(attempt.candidateStepCount) ? attempt.candidateStepCount : null,
    result: optionalString(attempt.result),
    reason: optionalString(attempt.reason),
    replayed: optionalBoolean(attempt.replayed),
    reset: isRecord(attempt.reset) ? copy(attempt.reset) : null,
    execution: isRecord(attempt.execution) ? copy(attempt.execution) : null,
    candidateScenario: isRecord(attempt.candidateScenario) ? copy(attempt.candidateScenario) : null,
    metadata: {
      ...(Object.hasOwn(attempt, 'removedStepId') ? { removedStepId: attempt.removedStepId } : {}),
      ...(Object.hasOwn(attempt, 'from') ? { from: attempt.from } : {}),
      ...(Object.hasOwn(attempt, 'to') ? { to: attempt.to } : {}),
      ...(Object.hasOwn(attempt, 'removed') ? { removed: attempt.removed } : {}),
      ...(Object.hasOwn(attempt, 'removedProperty') ? { removedProperty: attempt.removedProperty } : {}),
      ...(Object.hasOwn(attempt, 'error') ? { error: attempt.error } : {}),
      ...(Object.hasOwn(attempt, 'rejectionDetail') ? { rejectionDetail: copy(attempt.rejectionDetail) } : {}),
    },
  };
}

function signatureView(signature) {
  if (!isRecord(signature)) return null;
  if (typeof signature.stepId !== 'string' || typeof signature.pointer !== 'string' || typeof signature.classification !== 'string') return null;
  return {
    stepId: signature.stepId,
    pointer: signature.pointer,
    classification: signature.classification,
  };
}

function reductionView(reduction) {
  if (!isRecord(reduction)) return null;
  return {
    algorithm: optionalString(reduction.algorithm),
    status: optionalString(reduction.status),
    reason: isRecord(reduction.reason) ? copy(reduction.reason) : null,
    maxAttempts: isInteger(reduction.maxAttempts) ? reduction.maxAttempts : null,
    attemptsUsed: isInteger(reduction.attemptsUsed) ? reduction.attemptsUsed : null,
    actualReplays: isInteger(reduction.actualReplays) ? reduction.actualReplays : null,
    attemptLimitReached: optionalBoolean(reduction.attemptLimitReached),
    minimalUnderOperations: optionalBoolean(reduction.minimalUnderOperations),
    acceptedOperations: isInteger(reduction.acceptedOperations) ? reduction.acceptedOperations : null,
    originalStepCount: isInteger(reduction.originalStepCount)
      ? reduction.originalStepCount
      : scenarioStepCount(reduction.originalScenario),
    finalStepCount: isInteger(reduction.finalStepCount)
      ? reduction.finalStepCount
      : scenarioStepCount(reduction.finalScenario),
    originalMismatchSignature: signatureView(reduction.originalMismatchSignature),
    finalMismatchSignature: signatureView(reduction.finalMismatchSignature),
    attempts: Array.isArray(reduction.attempts) ? reduction.attempts.map(attemptView).filter(Boolean) : [],
    attemptsAvailable: Array.isArray(reduction.attempts),
  };
}

function jsonText(value) {
  return value === undefined || value === null ? null : JSON.stringify(value, null, 2);
}

export function buildWorkbenchModel(evidenceInput, {
  scenario = null,
  originalScenario = null,
  runId = null,
  artifactBase = null,
} = {}) {
  const evidence = parseEvidence(evidenceInput);
  const reduction = reductionView(evidence.reduction);
  const finalScenario = scenario ?? evidence.reduction?.finalScenario ?? null;
  const initialScenario = originalScenario ?? evidence.reduction?.originalScenario ?? null;
  const mismatch = firstMismatch(evidence);

  return {
    runId: optionalString(runId),
    outcome: evidence.outcome,
    exitCode: isInteger(evidence.exitCode) ? evidence.exitCode : null,
    run: isRecord(evidence.run) ? copy(evidence.run) : {},
    scenario: {
      name: optionalString(evidence.scenario?.name) ?? optionalString(finalScenario?.name),
      version: isInteger(evidence.scenario?.version) ? evidence.scenario.version : null,
      sha256: optionalString(evidence.scenario?.sha256),
    },
    services: {
      reference: serviceView(evidence.services?.reference),
      candidate: serviceView(evidence.services?.candidate),
    },
    counts: {
      originalStepCount: reduction?.originalStepCount ?? scenarioStepCount(initialScenario),
      minimizedStepCount: reduction?.finalStepCount ?? scenarioStepCount(finalScenario),
      attemptsUsed: reduction?.attemptsUsed ?? null,
      actualReplays: reduction?.actualReplays ?? null,
      acceptedOperations: reduction?.acceptedOperations ?? null,
    },
    mismatch,
    reason: isRecord(evidence.reason) ? copy(evidence.reason) : null,
    steps: Array.isArray(evidence.steps) ? copy(evidence.steps) : [],
    reduction,
    replay: {
      command: optionalString(evidence.replay?.command),
      scenarioFile: optionalString(evidence.replay?.scenarioFile),
      sha256: optionalString(evidence.replay?.sha256),
    },
    scenarios: {
      original: copy(initialScenario) ?? null,
      minimized: copy(finalScenario) ?? null,
    },
    artifacts: artifactBase ? {
      evidence: `${artifactBase}/evidence`,
      minimizedScenario: `${artifactBase}/scenario`,
      originalScenario: initialScenario ? `${artifactBase}/original-scenario` : null,
    } : null,
    raw: copy(evidence),
    copyPayloads: {
      scenario: jsonText(finalScenario),
      replayCommand: optionalString(evidence.replay?.command),
      mismatch: mismatch ? JSON.stringify(mismatch, null, 2) : null,
    },
  };
}

export function evidenceSummary(evidenceInput, options = {}) {
  const model = buildWorkbenchModel(evidenceInput, options);
  return {
    runId: model.runId,
    outcome: model.outcome,
    scenarioName: model.scenario.name,
    minimizedStepCount: model.counts.minimizedStepCount,
    mismatch: model.mismatch,
  };
}
