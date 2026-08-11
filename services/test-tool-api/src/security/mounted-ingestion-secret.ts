import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readFileSync,
} from 'node:fs';
import { isAbsolute } from 'node:path';

const VISIBLE_ASCII_SECRET = /^[\x21-\x7e]+$/;

export class MountedIngestionSecretError extends Error {
  constructor(readonly reason: 'file' | 'mode' | 'value') {
    super('The mounted ingestion secret is invalid.');
    this.name = 'MountedIngestionSecretError';
    Object.setPrototypeOf(this, MountedIngestionSecretError.prototype);
  }
}

/** Open without following symlinks, validate the opened descriptor, then read it once. */
export function readMountedIngestionSecret(path: string): string {
  if (!isAbsolute(path)) throw new MountedIngestionSecretError('file');

  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile()) throw new MountedIngestionSecretError('file');
    if ((metadata.mode & 0o777) !== 0o600) {
      throw new MountedIngestionSecretError('mode');
    }
    const raw = readFileSync(descriptor, 'utf8');
    const secret = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    if (!VISIBLE_ASCII_SECRET.test(secret)) {
      throw new MountedIngestionSecretError('value');
    }
    return secret;
  } catch (error) {
    if (error instanceof MountedIngestionSecretError) throw error;
    throw new MountedIngestionSecretError('file');
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
