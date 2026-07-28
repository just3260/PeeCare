import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.js';

describe('ingestion configuration', () => {
  it('uses Application Default Credentials when no Firestore Emulator is configured', () => {
    expect(readConfig({ EMQX_WEBHOOK_SECRET_CURRENT: 'secret' })).toMatchObject({
      currentSecret: 'secret',
      firestore: { projectId: 'demo-peecare' },
    });
  });

  it('uses a valid Firestore Emulator endpoint through the same configuration path', () => {
    expect(readConfig({ EMQX_WEBHOOK_SECRET_CURRENT: 'secret', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' })).toMatchObject({
      firestore: { projectId: 'demo-peecare', emulatorHost: '127.0.0.1:8085' },
    });
  });

  it.each(['127.0.0.1', 'http://127.0.0.1:8085', 'remote.example:8085', '127.0.0.1:0'])('fails fast for unsafe Firestore Emulator configuration: %s', (host) => {
    expect(() => readConfig({ EMQX_WEBHOOK_SECRET_CURRENT: 'secret', FIRESTORE_EMULATOR_HOST: host })).toThrow(/FIRESTORE_EMULATOR_HOST/);
  });
});
