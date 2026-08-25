import type { FirestoreConfig } from './firestore/firestore-client.js';

export const MEMBER_API_DEPLOYMENT_CONTRACT = {
  billing: 'request-based',
  minimumInstances: 0,
  requiresDedicatedServiceAccount: true,
  locationPolicy: 'firestore-compatible',
} as const;

export interface MemberApiConfig {
  readonly environment: 'production' | 'local';
  readonly projectId: string;
  readonly allowedOrigin: string;
  readonly port: number;
  readonly firestore: FirestoreConfig;
  readonly claim: MemberApiClaimConfig;
}

export interface MemberApiClaimConfig {
  readonly webhookSecret: string;
  readonly pairCodeHmacKey: string;
  readonly pairCodeHmacKeyVersion: string;
  readonly sharedMqttUsername: string;
}

function requireValue(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function parseAllowedWebOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('A valid allowed Web origin is required.');
  }
  if (
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
    parsed.origin !== value ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== '/' ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error('A valid allowed Web origin is required.');
  }
  return value;
}

function parseProjectId(value: string | undefined): string {
  const projectId = requireValue(value, 'GOOGLE_CLOUD_PROJECT');
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error('GOOGLE_CLOUD_PROJECT is invalid.');
  }
  return projectId;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8087;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  return port;
}

function parseEnvironment(value: string | undefined): 'production' | 'local' {
  if (value === 'production') return 'production';
  if (value === undefined || value === 'development' || value === 'test') return 'local';
  throw new Error('NODE_ENV must be production, development, or test.');
}

function parseClaimConfig(env: NodeJS.ProcessEnv): MemberApiClaimConfig {
  const webhookSecret = requireValue(
    env.PEECARE_CLAIM_WEBHOOK_SECRET,
    'PEECARE_CLAIM_WEBHOOK_SECRET',
  );
  if (!/^[^\s]+$/.test(webhookSecret)) {
    throw new Error('PEECARE_CLAIM_WEBHOOK_SECRET must be a non-empty token.');
  }

  const pairCodeHmacKey = requireValue(
    env.PEECARE_PAIR_CODE_HMAC_KEY,
    'PEECARE_PAIR_CODE_HMAC_KEY',
  );
  if (Buffer.byteLength(pairCodeHmacKey, 'utf8') < 32) {
    throw new Error('PEECARE_PAIR_CODE_HMAC_KEY must contain at least 32 bytes.');
  }

  const pairCodeHmacKeyVersion = requireValue(
    env.PEECARE_PAIR_CODE_HMAC_KEY_VERSION,
    'PEECARE_PAIR_CODE_HMAC_KEY_VERSION',
  );
  if (!/^[1-9][0-9]*$/.test(pairCodeHmacKeyVersion)) {
    throw new Error(
      'PEECARE_PAIR_CODE_HMAC_KEY_VERSION must be a positive numeric secret version.',
    );
  }

  const sharedMqttUsername = requireValue(
    env.PEECARE_CLAIM_SHARED_MQTT_USERNAME,
    'PEECARE_CLAIM_SHARED_MQTT_USERNAME',
  );
  if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/.test(sharedMqttUsername)) {
    throw new Error(
      'PEECARE_CLAIM_SHARED_MQTT_USERNAME must be a bounded legacy identity.',
    );
  }

  if (webhookSecret === pairCodeHmacKey) {
    throw new Error('Claim webhook and Pair Code HMAC credentials must be independent.');
  }

  return {
    webhookSecret,
    pairCodeHmacKey,
    pairCodeHmacKeyVersion,
    sharedMqttUsername,
  };
}

function validateEmulatorHost(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const match = value.match(/^127\.0\.0\.1:([1-9]\d{0,4})$/);
  const port = match ? Number(match[1]) : 0;
  if (!match || port > 65535) {
    throw new Error(`${name} must use a loopback host and valid port.`);
  }
  return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): MemberApiConfig {
  if (env.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
    throw new Error(
      'Member API must use Application Default Credentials without a service-account key file.',
    );
  }
  if (Object.keys(env).some((key) => key.startsWith('EMQX_WEBHOOK_SECRET'))) {
    throw new Error('Member API must not accept ingestion secret configuration.');
  }

  const environment = parseEnvironment(env.NODE_ENV);
  const projectId = parseProjectId(env.GOOGLE_CLOUD_PROJECT);
  const allowedOrigin = parseAllowedWebOrigin(
    requireValue(env.PEECARE_WEB_ORIGIN, 'PEECARE_WEB_ORIGIN'),
  );
  const claim = parseClaimConfig(env);
  const firestoreEmulatorHost = validateEmulatorHost(
    env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST',
  );
  validateEmulatorHost(env.FIREBASE_AUTH_EMULATOR_HOST, 'FIREBASE_AUTH_EMULATOR_HOST');

  if (
    environment === 'production' &&
    (firestoreEmulatorHost !== undefined || env.FIREBASE_AUTH_EMULATOR_HOST !== undefined)
  ) {
    throw new Error('Emulator configuration is forbidden in production.');
  }

  return {
    environment,
    projectId,
    allowedOrigin,
    port: parsePort(env.PORT),
    firestore: {
      projectId,
      ...(firestoreEmulatorHost ? { emulatorHost: firestoreEmulatorHost } : {}),
    },
    claim,
  };
}

/** Parse the deployed Cloud Run contract without local-mode fallbacks. */
export function readProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): MemberApiConfig & { readonly environment: 'production' } {
  if (env.NODE_ENV !== 'production') {
    throw new Error('Deployed Member API requires NODE_ENV=production.');
  }
  const config = readConfig(env);
  if (config.environment !== 'production') {
    throw new Error('Deployed Member API requires NODE_ENV=production.');
  }
  return config as MemberApiConfig & { readonly environment: 'production' };
}
