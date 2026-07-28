export interface FirestoreConfig {
  projectId: string;
  emulatorHost?: string;
}

export interface AppConfig { currentSecret: string; previousSecret?: string; firestore: FirestoreConfig; }

function readFirestoreConfig(env: NodeJS.ProcessEnv): FirestoreConfig {
  const projectId = env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? 'demo-peecare';
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(projectId)) throw new Error('Firestore project ID is invalid');
  const emulatorHost = env.FIRESTORE_EMULATOR_HOST;
  if (!emulatorHost) return { projectId };
  if (!/^127\.0\.0\.1:[1-9]\d{0,4}$/.test(emulatorHost)) throw new Error('FIRESTORE_EMULATOR_HOST must be a loopback host and valid port');
  const port = Number(emulatorHost.split(':')[1]);
  if (port > 65535) throw new Error('FIRESTORE_EMULATOR_HOST must be a loopback host and valid port');
  return { projectId, emulatorHost };
}

export function readConfig(env = process.env): AppConfig {
  const currentSecret = env.EMQX_WEBHOOK_SECRET_CURRENT;
  const previousSecret = env.EMQX_WEBHOOK_SECRET_PREVIOUS;
  if (!currentSecret) throw new Error('EMQX_WEBHOOK_SECRET_CURRENT is required');
  if (previousSecret === currentSecret) throw new Error('webhook rotation secrets must differ');
  return { currentSecret, ...(previousSecret ? { previousSecret } : {}), firestore: readFirestoreConfig(env) };
}
