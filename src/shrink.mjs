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

  return {};
}
