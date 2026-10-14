import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function writeReplayArtifacts(outputDirectory, scenario, evidence, { originalScenario } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  if (originalScenario) {
    await writeFile(
      path.join(outputDirectory, 'scenario.original.json'),
      `${JSON.stringify(originalScenario, null, 2)}\n`,
      'utf8',
