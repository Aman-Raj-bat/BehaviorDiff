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

    if (method === 'POST' && parsedUrl.pathname === '/reset') {
      carts.clear();
      cartCount = 0;
      requestCount = 0;
      return sendJson(response, 200, { ok: true }, fixture);
    }

    if (method === 'POST' && parsedUrl.pathname === '/carts') {
      await delayFor('create-cart');
      let body;
      try {
        body = await readJson(request);
      } catch {
        return badRequest(response, 'body must be JSON', fixture);
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        return badRequest(response, 'body must be an object', fixture);
      }
      cartCount += 1;
      const id = `${fixture}-cart-${cartCount}`;
      const cart = { id, items: [], subtotal: 0, total: 0 };
      carts.set(id, cart);
      return sendJson(response, 201, { cartId: id, meta: { requestId: requestId() } }, fixture);
    }

    if (parts.length === 3 && parts[0] === 'carts' && parts[2] === 'items' && method === 'POST') {
      const cart = carts.get(parts[1]);
      if (!cart) return sendJson(response, 404, { error: 'cart not found' }, fixture);
      let body;
      try {
        body = await readJson(request);
      } catch {
        return badRequest(response, 'body must be JSON', fixture);
      }
      if (typeof body?.sku !== 'string' || !Number.isInteger(body.quantity) || body.quantity <= 0 || typeof body.unitPrice !== 'number') {
        return badRequest(response, 'sku, positive quantity, and numeric unitPrice are required', fixture);
      }
      if (variant === 'candidate' && crashOnQuantity !== undefined && body.quantity === crashOnQuantity) process.exit(1);
      await delayFor('add-item', body);
      const alternateMismatch = variant === 'candidate' && alternateMismatchSku !== undefined && body.sku === alternateMismatchSku;
      const lineTotal = variant === 'candidate' && !alternateMismatch ? body.unitPrice : body.quantity * body.unitPrice;
      const item = {
        sku: body.sku,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        lineTotal,
      };
      cart.items.push(item);
      cart.subtotal += lineTotal + (alternateMismatch ? 1 : 0);
      cart.total = cart.subtotal;
      return sendJson(response, 200, cartRepresentation(cart), fixture);
    }

    if (parts.length === 2 && parts[0] === 'carts' && method === 'GET') {
      await delayFor('read-cart');
      const cart = carts.get(parts[1]);
      if (!cart) return sendJson(response, 404, { error: 'cart not found' }, fixture);
      return sendJson(response, 200, cartRepresentation(cart), fixture);
    }

    sendJson(response, 404, { error: 'not found' }, fixture);
  }

  async function start(port = 0) {
    if (process.env.BEHAVIOR_DIFF_FAIL_STARTUP === '1') {
      throw new Error('fixture startup failure requested by the test harness');
    }
    if (startupDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, startupDelayMs));
    server = http.createServer((request, response) => {
      handle(request, response).catch(() => {
        if (!response.headersSent) sendJson(response, 500, { error: 'fixture failure' }, fixture);
        else response.destroy();
      });
    });
    await new Promise((resolve, reject) => {

  });
}
