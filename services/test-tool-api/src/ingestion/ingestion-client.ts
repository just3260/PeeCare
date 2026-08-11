import { APPROVED_INGESTION_ORIGIN } from '../config.js';
import type {
  CanonicalEmqxEnvelope,
  IngestionEventClient,
} from '../events/test-event-service.js';
import { readMountedIngestionSecret } from '../security/mounted-ingestion-secret.js';

const EVENT_URL = `${APPROVED_INGESTION_ORIGIN}/v1/emqx/events`;

class SanitizedIngestionError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class IngestionConfigurationError extends SanitizedIngestionError {
  readonly code = 'ingestion_configuration_error' as const;
  constructor() {
    super('IngestionConfigurationError', 'The Ingestion client configuration is invalid.');
  }
}

export class IngestionRejectedError extends SanitizedIngestionError {
  readonly code = 'ingestion_rejected' as const;
  constructor() {
    super('IngestionRejectedError', 'The canonical event was rejected by Ingestion.');
  }
}

export class IngestionUnavailableError extends SanitizedIngestionError {
  readonly code = 'ingestion_unavailable' as const;
  constructor() {
    super('IngestionUnavailableError', 'The Ingestion service is unavailable.');
  }
}

export class IngestionUpstreamError extends SanitizedIngestionError {
  readonly code = 'ingestion_upstream_error' as const;
  constructor() {
    super('IngestionUpstreamError', 'The Ingestion service returned an unexpected response.');
  }
}

function loadMountedSecret(path: string): string {
  try {
    return readMountedIngestionSecret(path);
  } catch {
    throw new IngestionConfigurationError();
  }
}

export function createIngestionClient({
  ingestionOrigin,
  ingestionSecretFile,
  fetchImpl = fetch,
}: {
  readonly ingestionOrigin: string;
  readonly ingestionSecretFile: string;
  readonly fetchImpl?: typeof fetch;
}): IngestionEventClient {
  if (ingestionOrigin !== APPROVED_INGESTION_ORIGIN) {
    throw new IngestionConfigurationError();
  }
  const secret = loadMountedSecret(ingestionSecretFile);

  return Object.freeze({
    async submit(envelope: CanonicalEmqxEnvelope): Promise<'stored' | 'duplicate'> {
      let response: Pick<Response, 'status'>;
      try {
        response = await fetchImpl(EVENT_URL, {
          method: 'POST',
          redirect: 'error',
          headers: {
            authorization: `Bearer ${secret}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify(envelope),
        });
      } catch {
        throw new IngestionUnavailableError();
      }

      if (response.status === 201) return 'stored';
      if (response.status === 200) return 'duplicate';
      if (response.status === 401 || response.status === 403) {
        throw new IngestionConfigurationError();
      }
      if (response.status === 422) throw new IngestionRejectedError();
      if (response.status === 503) throw new IngestionUnavailableError();
      throw new IngestionUpstreamError();
    },
  });
}
