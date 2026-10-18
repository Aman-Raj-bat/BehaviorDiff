import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

export async function writeReplayArtifacts(outputDirectory, scenario, evidence, { originalScenario } = {}) {
  await mkdir(outputDirectory, { recursive: true });
  if (originalScenario) {
    await writeFile(
      path.join(outputDirectory, 'scenario.original.json'),
      `${JSON.stringify(originalScenario, null, 2)}\n`,
      'utf8',
    );
  } else {
    await unlink(path.join(outputDirectory, 'scenario.original.json')).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  const replayJson = `${JSON.stringify(scenario, null, 2)}\n`;
  evidence.replay.sha256 = createHash('sha256').update(replayJson).digest('hex');
  await writeFile(
    path.join(outputDirectory, 'scenario.replay.json'),
    replayJson,
    'utf8',
  );
  await writeFile(
    path.join(outputDirectory, 'evidence.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
    'utf8',
  );
}
