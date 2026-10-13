export class HttpJsonError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'HttpJsonError';
    this.code = code;
    this.cause = options.cause;
    this.status = options.status;
    this.timeoutMs = options.timeoutMs;
    this.diagnostics = options.diagnostics;
  }
}
