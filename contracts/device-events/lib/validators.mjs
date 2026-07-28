import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';

const here = dirname(fileURLToPath(import.meta.url));
const schemaDir = join(here, '..', 'schemas');

const SCHEMA_FILES = {
  common: 'common-event.v1.schema.json',
  urination: 'urination-event.v1.schema.json',
  battery: 'battery-event.v1.schema.json',
};

function readSchema(fileName) {
  return JSON.parse(readFileSync(join(schemaDir, fileName), 'utf8'));
}

/**
 * Load the version 1 event schemas into a single AJV 2020 strict-mode instance
 * and return compiled validators keyed by schema key.
 *
 * Strict mode is intentional: it fails fast on unknown keywords, ignored
 * keywords, and unresolved `$ref`s, which is how the contract guarantees the
 * schemas stay well-formed as they evolve.
 *
 * @returns {{ urination: import('ajv').ValidateFunction, battery: import('ajv').ValidateFunction }}
 */
export function loadValidators() {
  const ajv = new Ajv2020({ strict: true, allErrors: true });

  // Common must be registered before the event schemas that $ref it so the
  // reference resolves without a network fetch.
  ajv.addSchema(readSchema(SCHEMA_FILES.common));

  const urinationSchema = readSchema(SCHEMA_FILES.urination);
  const batterySchema = readSchema(SCHEMA_FILES.battery);

  return {
    urination: ajv.compile(urinationSchema),
    battery: ajv.compile(batterySchema),
  };
}

/**
 * Compact an AJV error array into a single-line human summary for stderr.
 * @param {import('ajv').ErrorObject[] | null | undefined} errors
 * @returns {string}
 */
export function summarizeAjvErrors(errors) {
  if (!errors || errors.length === 0) return 'unknown schema validation error';
  return errors
    .map((error) => {
      const path = error.instancePath || '(root)';
      return `${path} ${error.message}`;
    })
    .join('; ');
}
