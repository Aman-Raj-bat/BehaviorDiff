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

  return {};
}
