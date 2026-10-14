import { assertJsonPointer } from './compare-json.mjs';

const METHODS = new Set(['GET', 'POST']);
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const FIXTURES = new Set(['old-cart', 'candidate-cart', 'candidate-fixed-cart']);

export class ScenarioConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ScenarioConfigError';
  }
}

function config(condition, message) {
  if (!condition) throw new ScenarioConfigError(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validatePath(path, label) {
  config(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('://') && !path.includes('\\'), `${label} must be a relative HTTP path`);
}


  return scenario;
}
