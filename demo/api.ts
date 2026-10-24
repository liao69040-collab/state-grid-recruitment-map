import { createDemoApp, DEMO_ADMIN_USERNAME, DEMO_PASSWORD, DEMO_USER_PHONE } from './app.ts';

const { app, config } = await createDemoApp();
await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`Grid Atlas synthetic demo API: http://127.0.0.1:${config.port}`);
console.log(`Demo member: ${DEMO_USER_PHONE} / ${DEMO_PASSWORD}`);
console.log(`Demo administrator: ${DEMO_ADMIN_USERNAME} / ${DEMO_PASSWORD}`);
console.log('These are public, fictional demo credentials. State is in memory and resets on restart.');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await app.close(); process.exit(0); });
