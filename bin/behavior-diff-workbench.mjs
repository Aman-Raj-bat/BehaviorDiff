#!/usr/bin/env node

import { createWorkbenchServer, parseWorkbenchArguments } from '../src/workbench-server.mjs';

function usage() {
  return [
    'Usage: behavior-diff-workbench [--port <n>] [--host <ip>] [--auth-token <token>]',
    '',
    'Starts the investigation workbench for the checked-in fixtures.',
    'The server never accepts remote URLs, executable paths, or arbitrary scenario paths.',
    '',
    'Options:',
    '  --port <n>            Port to listen on (default: 4173 or PORT env)',
    '  --host <ip>           Host address to bind to (default: 127.0.0.1 or HOST env)',
    '  --auth-token <token>  Secret token required for run, replay, and shrink APIs',
    '  --help, -h            Show this help message',
    '',
    'Environment variables:',
    '  PORT                  Port assigned by hosting platform (e.g. Render)',
    '  HOST                  Host to bind to (e.g. 0.0.0.0 for Render deployments)',
    '  RENDER                If "true", defaults host to 0.0.0.0 for Render',
    '  WORKBENCH_AUTH_TOKEN  Secret token to protect execution APIs from public access',
  ].join('\n');
}

let args;
try {
  args = parseWorkbenchArguments(process.argv.slice(2), process.env);
} catch (error) {
  console.error(`Error: ${error.message}\n\n${usage()}`);
  process.exit(1);
}

if (args.help) {
  console.log(usage());
  process.exit(0);
}

const { port, host, authToken } = args;
const workbench = createWorkbenchServer({ authToken });
const address = await workbench.listen({ port, host });
console.log(`BehaviorDiff workbench listening at ${address.url}`);
console.log('Trusted scenarios: cart-total, cart-total-pass, cart-noisy');

if (address.host !== '127.0.0.1' && address.host !== '::1') {
  if (authToken) {
    console.log('Remote host binding enabled with authentication token protection.');
  } else {
    console.warn('WARNING: Remote host binding enabled without authentication token; execution endpoints are disabled.');
  }
}

let closing;
async function shutdown() {
  if (closing) return closing;
  closing = workbench.close();
  await closing;
}

process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });
