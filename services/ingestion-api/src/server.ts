import { buildApp } from './app.js';
import { readConfig } from './config.js';
const app = buildApp(readConfig());
const port = Number(process.env.PORT ?? 8080);
await app.listen({ host: '0.0.0.0', port });
process.once('SIGTERM', () => void app.close());
