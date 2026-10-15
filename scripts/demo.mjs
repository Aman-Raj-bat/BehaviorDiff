import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenario } from '../src/run-scenario.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const scenarioPath = path.join(root, 'scenarios', 'cart-noisy.json');
const outputDirectory = path.join(root, 'artifacts', 'demo-shrink');
const evidence = await runScenario(scenarioPath, outputDirectory, {
  shrink: { maxAttempts: 100 },
});
const addItem = evidence.steps.find((step) => step.id === 'add-item');

console.log(`outcome=${evidence.outcome}`);
console.log(`originalSteps=${evidence.reduction.originalScenario.steps.length}`);
for (const attempt of evidence.reduction.attempts) {
  console.log(`attempt=${attempt.attempt} operation=${attempt.operation} result=${attempt.result} reason=${attempt.reason}`);
}
console.log(`finalSteps=${evidence.reduction.finalScenario.steps.length}`);
console.log(`finalStepIds=${evidence.reduction.finalScenario.steps.map((step) => step.id).join(',')}`);
console.log(`reference response=${JSON.stringify(addItem.reference.response.body)}`);
console.log(`candidate response=${JSON.stringify(addItem.candidate.response.body)}`);
console.log(`business mismatch=${JSON.stringify(addItem.comparison.differences[0])}`);
console.log(`signature=${JSON.stringify(evidence.reduction.finalMismatchSignature)}`);
console.log(`actualReplays=${evidence.reduction.actualReplays}`);
console.log(`minimalUnderOperations=${evidence.reduction.minimalUnderOperations}`);
console.log(`replay=${evidence.replay.command}`);
console.log(`evidence=${path.relative(root, path.join(outputDirectory, 'evidence.json'))}`);

if (evidence.outcome !== 'REGRESSION' || evidence.reduction.status === 'BASELINE_NOT_REPRODUCING') process.exitCode = 1;
