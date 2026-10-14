export class ScenarioConfigError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ScenarioConfigError';
    this.details = details;
  }
}
