import http from 'node:http';

function integerEnv(name, fallback = 0) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let text = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (settled) return;
      text += chunk;
      if (text.length > 1_000_000) {
        fail(new Error('request body too large'));
        request.resume();
      }
    });
    request.on('end', () => {
      if (settled) return;
      if (text.length === 0) {
        settled = true;
        return resolve({});
      }
      try {
        const parsed = JSON.parse(text);
        settled = true;
        resolve(parsed);
      } catch {
        fail(new Error('request body is not JSON'));
      }
    });
    request.on('error', fail);
  });
}

function sendJson(response, status, body, fixture) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
    'x-behavior-diff-fixture': fixture,
  });
  response.end(text);
}

function badRequest(response, message, fixture) {
  sendJson(response, 400, { error: message }, fixture);
}

export function createCartService({ fixture, variant }) {
  const carts = new Map();
  const startupDelayMs = integerEnv('BEHAVIOR_DIFF_STARTUP_DELAY_MS');
  const responseDelayMs = integerEnv('BEHAVIOR_DIFF_RESPONSE_DELAY_MS');
  const responseDelayStep = process.env.BEHAVIOR_DIFF_RESPONSE_DELAY_STEP ?? '';
  const crashOnQuantity = process.env.BEHAVIOR_DIFF_CRASH_ON_QUANTITY === undefined
    ? undefined
    : integerEnv('BEHAVIOR_DIFF_CRASH_ON_QUANTITY');
  const timeoutOnQuantity = process.env.BEHAVIOR_DIFF_TIMEOUT_ON_QUANTITY === undefined
    ? undefined
    : integerEnv('BEHAVIOR_DIFF_TIMEOUT_ON_QUANTITY');
  const alternateMismatchSku = process.env.BEHAVIOR_DIFF_ALTERNATE_MISMATCH_SKU;
  let requestCount = 0;
  let cartCount = 0;
  let server;

  async function delayFor(stepName, body) {
    const quantitySpecific = stepName === 'add-item' && timeoutOnQuantity !== undefined;
    if (responseDelayMs > 0 && (!responseDelayStep || responseDelayStep === stepName) && (!quantitySpecific || body?.quantity === timeoutOnQuantity)) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }
    if (stepName === 'add-item' && timeoutOnQuantity !== undefined && body?.quantity === timeoutOnQuantity) {
      await new Promise((resolve) => setTimeout(resolve, responseDelayMs));
    }
  }

  function requestId() {
    requestCount += 1;
    return `${fixture}-${requestCount}`;
  }

  function cartRepresentation(cart) {
    const meta = { requestId: requestId() };
    if (variant === 'candidate-fixed') {
      return {
        meta,
        total: cart.total,
        subtotal: cart.subtotal,
        items: cart.items,
        cartId: cart.id,
      };
    }
    return {
      cartId: cart.id,
      items: cart.items,
      subtotal: cart.subtotal,
      total: cart.total,
      meta,
    };
  }

  async function handle(request, response) {
    const parsedUrl = new URL(request.url, 'http://127.0.0.1');
    const parts = parsedUrl.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const method = request.method;

    if (method === 'GET' && parsedUrl.pathname === '/health') {
      await delayFor('health');
      return sendJson(response, 200, { ok: true, variant: fixture }, fixture);
    }


  });
}
