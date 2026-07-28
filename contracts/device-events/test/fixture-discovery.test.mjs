import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { discoverFixtureFiles } from '../lib/fixture-files.mjs';

const root = mkdtempSync(join(tmpdir(), 'peecare-device-events-'));
after(() => rmSync(root, { recursive: true, force: true }));

test('discovers every JSON fixture recursively in deterministic order', () => {
  mkdirSync(join(root, 'valid', 'nested'), { recursive: true });
  mkdirSync(join(root, 'invalid'), { recursive: true });
  writeFileSync(join(root, 'valid', 'z.json'), '{}');
  writeFileSync(join(root, 'valid', 'nested', 'a.json'), '{}');
  writeFileSync(join(root, 'invalid', 'cases.json'), '[]');
  writeFileSync(join(root, 'valid', 'notes.txt'), 'not a fixture');

  assert.deepEqual(discoverFixtureFiles(root), [
    'invalid/cases.json',
    'valid/nested/a.json',
    'valid/z.json',
  ]);
});
