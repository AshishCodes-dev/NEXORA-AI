#!/usr/bin/env node
/**
 * scripts/dev.js
 * Cross-platform concurrent development runner for NEXORA AI.
 * Spawns both backend Express server and Vite frontend dev server with clean signal handling.
 */

const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('\x1b[35m[NEXORA DEV]\x1b[0m Starting backend (Port 5000) and frontend (Port 5173)...');

const backend = spawn(process.execPath, [path.join(rootDir, 'backend', 'server.js')], {
  cwd: path.join(rootDir, 'backend'),
  stdio: 'inherit',
  env: { ...process.env, PORT: process.env.PORT || '5000' },
});

const frontend = spawn(npmCmd, ['run', 'dev'], {
  cwd: path.join(rootDir, 'frontend', 'nexora'),
  stdio: 'inherit',
  env: process.env,
  shell: isWin,
});

let isShuttingDown = false;
function cleanup(code = 0) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n\x1b[35m[NEXORA DEV]\x1b[0m Shutting down all active services...');
  if (backend && !backend.killed) {
    try {
      backend.kill('SIGINT');
    } catch {}
  }
  if (frontend && !frontend.killed) {
    try {
      frontend.kill('SIGINT');
    } catch {}
  }
  process.exit(code);
}

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

backend.on('error', (err) => {
  console.error('\x1b[31m[NEXORA DEV]\x1b[0m Backend process error:', err.message);
});

frontend.on('error', (err) => {
  console.error('\x1b[31m[NEXORA DEV]\x1b[0m Frontend process error:', err.message);
});

backend.on('exit', (code) => {
  if (!isShuttingDown && code !== 0 && code !== null) {
    console.error(`\x1b[31m[NEXORA DEV]\x1b[0m Backend exited with code ${code}`);
    cleanup(code);
  }
});

frontend.on('exit', (code) => {
  if (!isShuttingDown && code !== 0 && code !== null) {
    console.error(`\x1b[31m[NEXORA DEV]\x1b[0m Frontend exited with code ${code}`);
    cleanup(code);
  }
});
