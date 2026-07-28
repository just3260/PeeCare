import { readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Discover every JSON fixture below a root directory.
 *
 * Symbolic links and non-JSON files are intentionally ignored. Returned paths
 * are root-relative, use forward slashes on every platform, and are sorted so
 * fixture reports remain deterministic.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function discoverFixtureFiles(root) {
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && entry.name.endsWith('.json')) {
        files.push(relative(root, absolutePath).split(sep).join('/'));
      }
    }
  }

  visit(root);
  return files.sort();
}
