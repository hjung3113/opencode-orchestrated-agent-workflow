import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const designDir = path.join(root, 'docs', 'design');

const sections = [
  ['## Status', 'status.md'],
  ['## 1. Purpose', 'purpose.md'],
  ['## 2. Core principles', 'core-principles.md'],
  ['## 3. System boundary', 'system-boundary.md'],
  ['## 4. Workflow lifecycle', 'lifecycle.md'],
  ['## 5. Workflows', 'workflows.md'],
  ['## 6. Orchestrator responsibilities', 'routing.md'],
  ['## 7. File protocol', 'file-protocol.md'],
  ['## 8. Safety, quality, and recovery features', 'safety-and-recovery.md'],
  ['## 9. OpenCode organization and commands', 'opencode-organization.md'],
  ['## 10. Matt Pocock skill composition', 'skill-composition.md'],
  ['## 11. Delivery phases', 'delivery-phases.md'],
  ['## 12. Decisions resolved for Phase 1', 'phase-1-decisions.md'],
  ['## 13. Success criteria for this design', 'success-criteria.md'],
];

test('every former design section has one canonical document', () => {
  const index = fs.readFileSync(path.join(designDir, 'README.md'), 'utf8');
  assert.match(index, /canonical location/);

  for (const [heading, file] of sections) {
    assert.ok(index.includes(`](${file})`));
    const document = fs.readFileSync(path.join(designDir, file), 'utf8');
    assert.match(document, new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm'));
  }
});
