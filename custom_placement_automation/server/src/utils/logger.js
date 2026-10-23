const log = (level, ...args) => console[level](`[${new Date().toISOString()}] [${level.toUpperCase()}]`, ...args);

const logger = {
  info: (...args) => log('info', ...args),
  warn: (...args) => log('warn', ...args),
  error: (...args) => log('error', ...args),
};

export default logger;
