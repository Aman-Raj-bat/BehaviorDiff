import { createCartService } from './service-common.mjs';

const service = createCartService({ fixture: 'candidate-fixed-cart', variant: 'candidate-fixed' });
await service.start(0);

async function shutdown() {
  await service.stop();
  process.exit(0);
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
