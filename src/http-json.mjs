export class HttpJsonError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'HttpJsonError';
    this.code = code;
    Object.assign(this, details);
  }
}

const MAX_REQUEST_BODY_BYTES = 1_000_000;
const MAX_ERROR_BODY_BYTES = 4_096;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]']);

export async function requestJson({ baseUrl, request, timeoutMs, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortRequest = () => controller.abort();
  signal?.addEventListener('abort', abortRequest, { once: true });
  if (signal?.aborted) controller.abort();
  const startedAt = performance.now();

  try {
    let base;
    try {
      base = new URL(baseUrl);
    } catch (error) {
      throw new HttpJsonError('CONFIG_ERROR', `Invalid service base URL: ${error.message}`);
    }
    if (base.protocol !== 'http:' || !LOOPBACK_HOSTS.has(base.hostname)) {
      throw new HttpJsonError('CONFIG_ERROR', 'Service base URL must use HTTP on loopback');
    }

    const headers = { accept: 'application/json' };
    const init = {
      method: request.method,
      headers,
      signal: controller.signal,
      redirect: 'error',
    };
    if (request.body !== undefined) {
      headers['content-type'] = 'application/json';
      const serializedBody = JSON.stringify(request.body);
      if (Buffer.byteLength(serializedBody, 'utf8') > MAX_REQUEST_BODY_BYTES) {
        throw new HttpJsonError('CONFIG_ERROR', `Request body exceeds ${MAX_REQUEST_BODY_BYTES} bytes`, {
          maxBytes: MAX_REQUEST_BODY_BYTES,
        });
      }
      init.body = serializedBody;

  });
}
