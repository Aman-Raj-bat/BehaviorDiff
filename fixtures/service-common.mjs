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

}
