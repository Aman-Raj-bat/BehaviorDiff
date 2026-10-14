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

}
