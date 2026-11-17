// Development launcher for the Electron app.
//
// Starts Electron and restarts it whenever a file in electron/ changes, so
// edits to the main process or preload take effect without rerunning
// `npm run dev`. Screen code (src/) is reloaded by Vite, not by this script.
//
// Closing the app window ends the dev session (concurrently -k then stops
// Vite). If the app crashes, the script keeps watching: fix the file and save.

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
/** In Node, the electron package exports the path to the Electron binary. */
const electronBin = require('electron');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watchDir = path.join(root, 'electron');

let child = null;
let restarting = false;
let timer;

const log = (msg) => console.log(`[electron] ${msg}`);

function start() {
  child = spawn(electronBin, ['.'], { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    child = null;
    if (restarting) {
      restarting = false;
      start();
      return;
    }
    if (code === 0) process.exit(0); // window closed normally
    log(`exited (${signal ?? `code ${code}`}). Waiting for a change in electron/ to restart…`);
  });
}

function scheduleRestart(file) {
  clearTimeout(timer);
  // Editors often write a file in several steps; wait for them to settle.
  timer = setTimeout(() => {
    log(`${file} changed, restarting`);
    if (!child) {
      start();
      return;
    }
    restarting = true;
    child.kill();
  }, 250);
}

watch(watchDir, { recursive: true }, (_event, file) => {
  if (file && /\.(c?js|mjs|json)$/i.test(file)) scheduleRestart(file);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    restarting = false;
    child?.kill();
    process.exit(0);
  });
}

log(`watching ${path.relative(root, watchDir)}${path.sep} for changes`);
start();
