#!/usr/bin/env node
// Human-invoked `/route` entry point for Slice A0.
//
// Usage: node bin/route.js <manifest-path.json>
// Reads ORCHESTRATOR_RUN_STATE_DIR from the environment. Never launches a
// worker; prints the run directory and gate path it wrote (or reused).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { route } from '../src/route.js';

const checkoutRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function main() {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    process.stderr.write('usage: route.js <manifest-path.json>\n');
    process.exit(2);
  }

  const stateRoot = process.env.ORCHESTRATOR_RUN_STATE_DIR;
  if (!stateRoot) {
    process.stderr.write('ORCHESTRATOR_RUN_STATE_DIR is not set\n');
    process.exit(2);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  let result;
  try {
    result = route(manifest, {
      stateRoot,
      checkoutRoot,
      homeDir: process.env.HOME,
    });
  } catch (err) {
    process.stderr.write(`${err.name}: ${err.message}\n`);
    process.exit(1);
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        runId: result.runId,
        runDir: result.runDir,
        created: result.created,
        graphRevision: result.graph.revision,
        status: result.graph.status,
        selectedTask: result.graph.selected_task,
        gatePath: result.gatePath,
        packetPath: result.packetPath ?? null,
        manualHandoff: result.manualHandoff ?? null,
      },
      null,
      2,
    )}\n`,
  );
}

main();
