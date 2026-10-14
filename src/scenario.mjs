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

function validateVariableName(name, label) {
  config(typeof name === 'string' && VARIABLE_NAME.test(name), `${label} is not a valid variable name`);
}

function validateTemplateValue(value, knownVariables, label) {
  if (typeof value === 'string') {
    const matches = [...value.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)];
    const stripped = value.replace(/\{\{[A-Za-z_][A-Za-z0-9_]*\}\}/g, '');
    config(!stripped.includes('{{') && !stripped.includes('}}'), `${label} contains malformed variable template`);
    for (const match of matches) {
      config(knownVariables.has(match[1]), `${label} references unknown variable ${match[1]}`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateTemplateValue(item, knownVariables, `${label}[${index}]`));
    return;
  }


  return scenario;
}
