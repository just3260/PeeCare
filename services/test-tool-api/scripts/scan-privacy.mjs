import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findPrivacyLeaks } from '../dist/security/privacy-scan.js';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const scanRoots = [join(packageRoot, 'src'), join(packageRoot, 'dist'), join(packageRoot, 'scripts')];
const scanFiles = ['Dockerfile', 'cloudbuild.json', 'package.json', 'package-lock.json'];
const excludedNames = new Set(['privacy-scan.ts', 'privacy-scan.js']);
const allowedExtensions = new Set(['.ts', '.js', '.mjs', '.json']);
const findings = [];

function visit(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      visit(target);
    } else if (allowedExtensions.has(extname(entry.name)) && !excludedNames.has(entry.name)) {
      const rules = findPrivacyLeaks(readFileSync(target, 'utf8'));
      if (rules.length > 0) findings.push({ file: relative(packageRoot, target), rules });
    }
  }
}

for (const root of scanRoots) visit(root);
for (const file of scanFiles) {
  const target = join(packageRoot, file);
  const rules = findPrivacyLeaks(readFileSync(target, 'utf8'));
  if (rules.length > 0) findings.push({ file, rules });
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`Privacy scan failed: ${finding.file} (${finding.rules.join(', ')})`);
  }
  process.exitCode = 1;
} else {
  console.log('Test Tool API source and bundle privacy scan passed.');
}
