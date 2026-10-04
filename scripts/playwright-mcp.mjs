#!/usr/bin/env node
/**
 * Launcher cross-platform para @playwright/mcp (stdio MCP).
 * Uso: node scripts/playwright-mcp.mjs [--browser=chromium] ...
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'e2e', 'node_modules', '@playwright', 'mcp', 'cli.js');

if (!fs.existsSync(cli)) {
  console.error(
    '[playwright-mcp] Pacote ausente. Execute:\n  cd e2e && npm ci && npm run install:browsers',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, [cli, ...args], {
  stdio: 'inherit',
  cwd: root,
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
