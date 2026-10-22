import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import config from '../config/index.js';
import { httpError } from '../utils/httpError.js';

const { scriptsDir } = config.storage;
const SCRIPT_ID_PATTERN = /^[a-f0-9]{64}$/;

const scriptPath = (id) => path.join(scriptsDir, `${id}.js`);

export async function storeScript(script) {
  const id = crypto.createHash('sha256').update(script).digest('hex');
  await fs.mkdir(scriptsDir, { recursive: true });
  await fs.writeFile(scriptPath(id), script, { flag: 'wx' }).catch((err) => {
    if (err.code !== 'EEXIST') throw err;
  });
  return id;
}

export async function loadScript(id) {
  if (!SCRIPT_ID_PATTERN.test(String(id))) throw httpError(400, 'Invalid script id');
  try {
    return await fs.readFile(scriptPath(id), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw httpError(404, 'The vdo.ai.js from that run is no longer stored. Upload the file again.');
    throw err;
  }
}

export const clearScripts = () => fs.rm(scriptsDir, { recursive: true, force: true });
