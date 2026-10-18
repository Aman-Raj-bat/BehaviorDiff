import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { runScenario } from '../src/run-scenario.mjs';
import { mismatchSignature } from '../src/shrink.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scenarioPath = path.join(root, 'scenarios', 'cart-noisy.json');
const outputDirectory = path.join(root, 'artifacts', 'demo-shrink');
const evidence = await runScenario(scenarioPath, outputDirectory, {
  shrink: { maxAttempts: 100 },
});
const reduction = evidence.reduction;
const addItem = evidence.steps?.find((step) => step.id === 'add-item');
const json = (value) => JSON.stringify(value) ?? 'unavailable';

console.log(`outcome=${evidence.outcome}`);
if (evidence.reason) console.log(`reason=${evidence.reason.code}`);
console.log(`reductionStatus=${reduction?.status ?? 'unavailable'}`);
console.log(`originalSteps=${reduction?.originalScenario?.steps?.length ?? 'unavailable'}`);
for (const attempt of reduction?.attempts ?? []) {
  console.log(`attempt=${attempt.attempt} operation=${attempt.operation} result=${attempt.result} reason=${attempt.reason}`);
}
console.log(`finalSteps=${reduction?.finalScenario?.steps?.length ?? 'unavailable'}`);
console.log(`finalStepIds=${reduction?.finalScenario?.steps?.map((step) => step.id).join(',') ?? 'unavailable'}`);
console.log(`reference response=${json(addItem?.reference?.response?.body)}`);
console.log(`candidate response=${json(addItem?.candidate?.response?.body)}`);
console.log(`business mismatch=${json(addItem?.comparison?.differences?.[0])}`);
console.log(`signature=${json(reduction?.finalMismatchSignature)}`);
console.log(`actualReplays=${reduction?.actualReplays ?? 'unavailable'}`);
console.log(`minimalUnderOperations=${reduction?.minimalUnderOperations ?? 'unavailable'}`);
console.log(`replay=${evidence.replay?.command ?? 'unavailable'}`);
console.log(`evidence=${path.relative(root, path.join(outputDirectory, 'evidence.json'))}`);

const target = reduction?.originalMismatchSignature;
const verified = evidence.outcome === 'REGRESSION'
  && ['COMPLETED', 'LIMIT_REACHED'].includes(reduction?.status)
  && reduction.actualReplays > 0
  && target != null
  && isDeepStrictEqual(reduction.finalMismatchSignature, target)
  && isDeepStrictEqual(mismatchSignature(evidence.steps ?? []), target);
if (!verified) process.exitCode = 1;
