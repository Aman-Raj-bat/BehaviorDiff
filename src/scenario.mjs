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

  if (!isRecord(value)) return;
  if (Object.hasOwn(value, '$var')) {
    config(Object.keys(value).length === 1, `${label} $var object cannot have additional keys`);
    validateVariableName(value.$var, `${label}.$var`);
    config(knownVariables.has(value.$var), `${label} references unknown variable ${value.$var}`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    validateTemplateValue(child, knownVariables, `${label}.${key}`);
  }
}

function validateSteps(steps, staticVariables) {
  config(Array.isArray(steps) && steps.length > 0, 'steps must be a non-empty array');
  const captureNames = new Set();
  const knownVariables = new Set(Object.keys(staticVariables));

  for (const [index, step] of steps.entries()) {
    const label = `steps[${index}]`;
    config(isRecord(step), `${label} must be an object`);
    config(typeof step.id === 'string' && step.id.length > 0, `${label}.id is required`);
    config(!steps.slice(0, index).some((prior) => prior.id === step.id), `duplicate step id ${step.id}`);
    config(isRecord(step.request), `${label}.request must be an object`);
    config(typeof step.request.method === 'string' && METHODS.has(step.request.method), `${label}.request.method is unsupported`);
    config(step.request.method !== 'GET' || !Object.hasOwn(step.request, 'body'), `${label}.request.body is not allowed for GET`);
    validatePath(step.request.path, `${label}.request.path`);
    validateTemplateValue(step.request.path, knownVariables, `${label}.request.path`);
    if (Object.hasOwn(step.request, 'body')) {
      validateTemplateValue(step.request.body, knownVariables, `${label}.request.body`);
    }

  return scenario;
}
