#!/usr/bin/env node

import { createWorkbenchServer } from '../src/workbench-server.mjs';

function usage() {
  return [
    'Usage: behavior-diff-workbench [--port <n>]',
    '',
    'Starts the local loopback investigation workbench for the checked-in fixtures.',
    'The server never accepts remote URLs, executable paths, or arbitrary scenario paths.',
  ].join('\n');
}

function parsePort(value) {
  if (!/^\d+$/.test(value)) throw new Error('port must be an integer');
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error('port must be between 0 and 65535');
  return port;
}

function parseArguments(argv) {
  let port = 4173;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--port' && argv[index + 1]) {
      port = parsePort(argv[index + 1]);
      index += 1;
    } else if (argv[index] === '--help' || argv[index] === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option ${argv[index]}\n\n${usage()}`);
    }
  }
  return { port };
}

const { port } = parseArguments(process.argv.slice(2));
const workbench = createWorkbenchServer();
const address = await workbench.listen({ port, host: '127.0.0.1' });
console.log(`BehaviorDiff workbench listening at ${address.url}`);
console.log('Trusted scenarios: cart-total, cart-total-pass, cart-noisy');

let closing;
async function shutdown() {
  if (closing) return closing;
  closing = workbench.close();
  await closing;
}

process.once('SIGINT', () => { shutdown().finally(() => process.exit(0)); });
process.once('SIGTERM', () => { shutdown().finally(() => process.exit(0)); });
