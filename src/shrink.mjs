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

  if (evaluated.execution && canTrustCandidate(evaluated.execution, state.target)) {
    attempt.result = 'ACCEPTED';
    attempt.reason = 'TARGET_MISMATCH_REPRODUCED';
    state.attempts.push(attempt);
    return { accepted: true, execution: evaluated.execution };
  }

  attempt.result = 'REJECTED';
  attempt.reason = evaluated.reason?.code ?? rejectionFor(evaluated.execution, state.target);
  if (evaluated.execution?.reason) attempt.rejectionDetail = evaluated.execution.reason;
  state.attempts.push(attempt);
  if (evaluated.fatal || isFatalExecution(evaluated.execution)) state.aborted = true;
  return { accepted: false, aborted: state.aborted };
}

export async function shrinkScenario({ scenario, baseline, maxAttempts, evaluate }) {
  const state = {
    maxAttempts,
    attemptsUsed: 1,
    actualReplays: 1,
    attempts: [],
    target: baseline.signature,
    aborted: false,
  };
  let current = clone(scenario);
  let finalExecution = baseline;
  let acceptedOperations = 0;

  let overallChanged = true;
  while (overallChanged && !state.aborted && state.attemptsUsed < state.maxAttempts) {
    overallChanged = false;
    let changed = true;
    while (changed && !state.aborted && state.attemptsUsed < state.maxAttempts) {
      changed = false;
      for (let index = 0; index < current.steps.length; index += 1) {
        if (state.attemptsUsed >= state.maxAttempts || state.aborted) break;
        const removedStepId = current.steps[index]?.id ?? `index-${index}`;
        const candidate = removeStep(current, index);
        const result = await evaluateCandidate({
          candidate,
          operation: 'REMOVE_STEP',
          location: `/steps/${index}`,
          state,
          evaluate,
        });
        if (result.limited || state.aborted) break;
        if (result.accepted) {
          current = candidate;
          finalExecution = result.execution;
          acceptedOperations += 1;
          changed = true;
          overallChanged = true;
          break;
        }
        state.attempts[state.attempts.length - 1].removedStepId = removedStepId;
      }
    }

    if (!state.aborted && state.attemptsUsed < state.maxAttempts) {
      let scalarChanged = true;
      while (scalarChanged && !state.aborted && state.attemptsUsed < state.maxAttempts) {
        scalarChanged = false;
        for (const candidateChange of scalarCandidates(current)) {
          if (state.attemptsUsed >= state.maxAttempts || state.aborted) break;
          const result = await evaluateCandidate({
            candidate: candidateChange.scenario,
            operation: candidateChange.operation,
            location: candidateChange.location,
            metadata: candidateChange.metadata,
            state,
            evaluate,
          });
          if (result.limited || state.aborted) break;
          if (result.accepted) {
            current = candidateChange.scenario;
            finalExecution = result.execution;
            acceptedOperations += 1;
            scalarChanged = true;
            overallChanged = true;
            break;
          }
        }
      }
    }
  }

  const attemptLimitReached = state.attemptsUsed >= state.maxAttempts;
  return {
    scenario: current,
    execution: finalExecution,
    targetSignature: state.target,
    finalMismatchSignature: finalExecution.signature,
    attempts: state.attempts,
    attemptsUsed: state.attemptsUsed,
    actualReplays: state.actualReplays,
    acceptedOperations,
    attemptLimitReached,
    minimalUnderOperations: !attemptLimitReached && !state.aborted,
    status: state.aborted ? 'ABORTED' : attemptLimitReached ? 'LIMIT_REACHED' : 'COMPLETED',
  };
}

function replaceAtPath(scenario, path, value) {
  const candidate = clone(scenario);
  let parent = candidate;
  for (const part of path.slice(0, -1)) parent = parent[part];
  parent[path.at(-1)] = value;
  return candidate;
}

function removeAtPath(scenario, path) {
  const candidate = clone(scenario);
  let parent = candidate;
  for (const part of path.slice(0, -1)) parent = parent[part];
  const key = path.at(-1);
  if (Array.isArray(parent)) parent.splice(Number(key), 1);
  else delete parent[key];
  return candidate;
}


  return {};
}
