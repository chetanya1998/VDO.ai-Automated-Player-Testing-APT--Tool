import express from 'express';
import config from './config/index.js';
import routes from './routes/index.js';
import { SCREENSHOTS_URL_PATH } from './services/results.service.js';
import logger from './utils/logger.js';

const app = express();

app.use(express.json({ limit: '5mb' }));
app.use('/api', routes);
app.use(SCREENSHOTS_URL_PATH, express.static(config.storage.screenshotsDir, { fallthrough: false }));

if (config.clientDistDir) {
  app.use(express.static(config.clientDistDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile('index.html', { root: config.clientDistDir }));
}

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) logger.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

export default app;
