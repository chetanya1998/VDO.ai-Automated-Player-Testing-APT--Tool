import app from './src/app.js';
import config from './src/config/index.js';
import logger from './src/utils/logger.js';
import { closeBrowser } from './src/services/browser.service.js';
import { closePdfBrowser } from './src/services/pdfReport.service.js';
import { initializeDatabase } from './src/services/database.service.js';
import { initializeQueue, stopQueue, drainQueue } from './src/services/jobQueue.service.js';

const database = await initializeDatabase(config);

const server = app.listen(config.port, config.host);

server.on('error', (err) => {
  logger.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : err.message);
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  const deadline = setTimeout(() => process.exit(1), 15000);
  deadline.unref();
  stopQueue();
  server.close();
  await Promise.all([closeBrowser(), closePdfBrowser()]);
  await drainQueue();
  await database.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
await new Promise(resolve => server.once('listening', resolve));
await initializeQueue();
logger.info(`Server running on http://${config.host}:${config.port} (${config.env})`);
