import {
  MountedIngestionSecretError,
  readMountedIngestionSecret,
} from './security/mounted-ingestion-secret.js';

export const APPROVED_PROJECT_ID = 'petcare-c7483';
export const APPROVED_WEB_ORIGIN = 'https://petcare-c7483.web.app';
export const APPROVED_INGESTION_ORIGIN =
  'https://peecare-ingestion-development-348528459946.asia-east1.run.app';

export interface TestToolApiConfig {
  readonly environment: 'production';
  readonly projectId: typeof APPROVED_PROJECT_ID;
  readonly allowedOrigin: typeof APPROVED_WEB_ORIGIN;
  readonly ingestionOrigin: typeof APPROVED_INGESTION_ORIGIN;
  readonly ingestionSecretFile: string;
  readonly enabled: boolean;
  readonly port: number;
}

function requireValue(value: string | undefined, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function requireApprovedValue<const T extends string>(
  value: string | undefined,
  approvedValue: T,
  name: string,
): T {
  if (value !== approvedValue) {
    throw new Error(`${name} is not approved.`);
  }
  return approvedValue;
}

function parsePort(value: string | undefined): number {
  if (value === undefined) return 8080;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  return port;
}

function validateSecretFile(pathValue: string | undefined): string {
  const path = requireValue(pathValue, 'PEECARE_INGESTION_SECRET_FILE');
  try {
    readMountedIngestionSecret(path);
  } catch (error) {
    if (error instanceof MountedIngestionSecretError && error.reason === 'mode') {
      throw new Error('The ingestion secret file must have exact mode 0400.');
    }
    throw new Error('The ingestion secret file is unavailable or invalid.');
  }
  return path;
}

function rejectUnsafeEnvironmentCoupling(env: NodeJS.ProcessEnv): void {
  if (env.GOOGLE_APPLICATION_CREDENTIALS !== undefined) {
    throw new Error('Service-account key files are forbidden.');
  }
  if (
    env.FIRESTORE_EMULATOR_HOST !== undefined ||
    env.FIREBASE_AUTH_EMULATOR_HOST !== undefined
  ) {
    throw new Error('Emulator configuration is forbidden.');
  }
  if (Object.keys(env).some((key) => key.startsWith('EMQX_WEBHOOK_SECRET'))) {
    throw new Error('Direct ingestion secret environment variables are forbidden.');
  }
}

export function readProductionConfig(
  env: NodeJS.ProcessEnv = process.env,
): TestToolApiConfig {
  if (env.NODE_ENV !== 'production') {
    throw new Error('Test Tool API requires NODE_ENV=production.');
  }
  rejectUnsafeEnvironmentCoupling(env);

  return {
    environment: 'production',
    projectId: requireApprovedValue(
      env.GOOGLE_CLOUD_PROJECT,
      APPROVED_PROJECT_ID,
      'GOOGLE_CLOUD_PROJECT',
    ),
    allowedOrigin: requireApprovedValue(
      env.PEECARE_WEB_ORIGIN,
      APPROVED_WEB_ORIGIN,
      'PEECARE_WEB_ORIGIN',
    ),
    ingestionOrigin: requireApprovedValue(
      env.PEECARE_INGESTION_ORIGIN,
      APPROVED_INGESTION_ORIGIN,
      'PEECARE_INGESTION_ORIGIN',
    ),
    ingestionSecretFile: validateSecretFile(env.PEECARE_INGESTION_SECRET_FILE),
    enabled: env.PEECARE_TEST_TOOL_ENABLED === 'true',
    port: parsePort(env.PORT),
  };
}
