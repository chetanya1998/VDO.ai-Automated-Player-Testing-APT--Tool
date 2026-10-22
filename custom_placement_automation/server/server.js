import app from './src/app.js';
import config from './src/config/index.js';
import logger from './src/utils/logger.js';
import { closeBrowser } from './src/services/browser.service.js';
import { closePdfBrowser } from './src/services/pdfReport.service.js';

const server = app.listen(config.port, config.host, () => {
  logger.info(`Server running on http://${config.host ?? 'localhost'}:${config.port} (${config.env})`);
});

server.on('error', (err) => {
  logger.error(err.code === 'EADDRINUSE' ? `Port ${config.port} is already in use` : err.message);
  process.exit(1);
});

async function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close();
  await Promise.all([closeBrowser(), closePdfBrowser()]);
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
