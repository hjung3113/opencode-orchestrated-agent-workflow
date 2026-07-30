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
import { routeV2 } from '../src/v2/route.js';
import { V2RouteRefusal } from '../src/v2/declaration.js';

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
  const routeOptions = {
    stateRoot,
    checkoutRoot,
    homeDir: process.env.HOME,
  };
  const isV2 = Object.hasOwn(manifest, 'schema_version');
  try {
    result = isV2 ? routeV2(manifest, routeOptions) : route(manifest, routeOptions);
  } catch (err) {
    if (isV2 && err instanceof V2RouteRefusal) {
      process.stderr.write(`${JSON.stringify({ refusal: err.refusal })}\n`);
      process.exit(1);
    }
    process.stderr.write(`${err.name}: ${err.message}\n`);
    process.exit(1);
  }

  if (isV2) {
    process.stdout.write(`${JSON.stringify({
      status: result.status,
      run_id: result.runId,
      run_dir: result.runDir,
      graph_revision: result.graph.revision,
      run_state: result.graph.run_state,
      prepared_task_ids: result.preparedTaskIds,
      attempt_one_packet_paths: result.attemptOnePacketPaths,
    })}\n`);
    return;
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
