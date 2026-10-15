import { createHash } from 'node:crypto';
import { validateScenario } from './scenario.mjs';

export function mismatchSignature(steps) {
  for (const step of steps) {
    const difference = step.comparison?.differences?.[0];
    if (!difference) continue;
    return {
      stepId: step.id,
      pointer: difference.pointer,
      classification: difference.pointer === '$status' ? 'STATUS_DIFFERENCE' : 'BUSINESS_DIFFERENCE',
    };
  }
  return null;
}

export function summarizeReplay(replayResult) {
  const signature = mismatchSignature(replayResult.steps);
  let outcome = 'PASS';
  if (replayResult.reason && !replayResult.regression) outcome = 'INCONCLUSIVE';
  else if (replayResult.regression) outcome = 'REGRESSION';
  return {
    outcome,
    steps: replayResult.steps,
    reason: replayResult.reason,
    regression: replayResult.regression,
    signature,
  };
}

function sameSignature(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function canTrustCandidate(execution, target) {
  if (execution.outcome !== 'REGRESSION' || !sameSignature(execution.signature, target)) return false;
  return !execution.reason || execution.reason.code === 'CANDIDATE_UNEXPECTED_STATUS';
}

function candidateHash(scenario) {
  return createHash('sha256').update(JSON.stringify(scenario)).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function encodePointerPart(value) {
  return String(value).replaceAll('~', '~0').replaceAll('/', '~1');
}

function pointerFor(parts) {
  return `/${parts.map(encodePointerPart).join('/')}`;
}

function removeStep(scenario, index) {
  const candidate = clone(scenario);
  candidate.steps.splice(index, 1);
  return candidate;
}

function rejectionFor(execution, target) {
  if (!execution) return 'INCONCLUSIVE_REPLAY';
  if (execution.outcome === 'INCONCLUSIVE') return 'INCONCLUSIVE_REPLAY';
  if (execution.outcome !== 'REGRESSION') return 'MISMATCH_NOT_REPRODUCED';
  if (!sameSignature(execution.signature, target)) return 'MISMATCH_SIGNATURE_CHANGED';
  if (execution.reason) return 'INCONCLUSIVE_REPLAY';
  return 'MISMATCH_NOT_REPRODUCED';
}

function isFatalExecution(execution) {
  return execution?.reason?.code === 'TRANSPORT_ERROR' || execution?.reason?.code === 'REFERENCE_REPLAY_ERROR';
}

function createAttempt({ number, operation, location, candidate, metadata = {} }) {
  return {
    attempt: number,
    operation,
    location,
    candidateHash: candidateHash(candidate),
    candidateStepCount: candidate.steps.length,
    candidateScenario: clone(candidate),
    ...metadata,
  };
}

async function evaluateCandidate({ candidate, operation, location, metadata, state, evaluate }) {
  if (state.attemptsUsed >= state.maxAttempts) return { limited: true };
  state.attemptsUsed += 1;
  const attempt = createAttempt({
    number: state.attemptsUsed,
    operation,
    location,
    candidate,
    metadata,
  });

  try {
    validateScenario(candidate);
  } catch (error) {
    attempt.result = 'REJECTED';
    attempt.replayed = false;
    attempt.reason = 'CONFIG_ERROR';
    attempt.error = error.message;
    state.attempts.push(attempt);
    return { accepted: false };
  }

  let evaluated;
  try {
    evaluated = await evaluate(candidate);
  } catch (error) {
    evaluated = {
      replayed: false,
      fatal: true,
      reason: { code: 'EVALUATION_ERROR', message: error.message },
    };
  }
  attempt.replayed = evaluated.replayed === true;
  if (attempt.replayed) state.actualReplays += 1;
  if (evaluated.reset) attempt.reset = evaluated.reset;
  if (evaluated.execution) {
    attempt.execution = {
      outcome: evaluated.execution.outcome,
      reason: evaluated.execution.reason,
      signature: evaluated.execution.signature,
      steps: evaluated.execution.steps,
    };
  }


  return {};
}
