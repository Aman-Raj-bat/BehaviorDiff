#!/usr/bin/env node

import path from 'node:path';
import { runScenario } from '../src/run-scenario.mjs';
import { ScenarioConfigError } from '../src/scenario.mjs';

function usage() {
  return [
    'Usage: behavior-diff <run|shrink> <scenario.json> --out <directory> [options]',
    '',
    'Options:',
    '  --startup-timeout-ms <n>  bounded service startup timeout (default: 2000)',
    '  --request-timeout-ms <n>  bounded request timeout (default: 1000)',
    '  --max-attempts <n>        shrink replay budget including the baseline (default: 100)',
  ].join('\n');
}

function parseInteger(value, name) {
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be an integer`);
  return Number(value);
}

function parseArguments(argv) {
  if (!['run', 'shrink'].includes(argv[0]) || !argv[1]) throw new Error(usage());
  const command = argv[0];
  const scenarioPath = path.resolve(argv[1]);
  let outputDirectory;
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--out' && value) {
      outputDirectory = path.resolve(value);
      index += 1;
    } else if (flag === '--startup-timeout-ms' && value) {
      options.startupTimeoutMs = parseInteger(value, flag);
      index += 1;
    } else if (flag === '--request-timeout-ms' && value) {
      options.requestTimeoutMs = parseInteger(value, flag);
      index += 1;

}
